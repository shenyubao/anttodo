import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { Task, TaskOkrLink, WorkspaceBundle, OkrLinkedTaskSummary } from "../types";
import type { createTask } from "./api";
import { assertCanAssociateTaskLabels } from "./labelTaskLimits";
import { okrLinkedTasksKey, taskOkrLinkKey } from "./okrApi";
import {
  appendTaskToBundle, applyTaskListOrderToBundle, createOptimisticTask,
  isOptimisticTaskId, removeTaskFromBundle, replaceOptimisticTask,
} from "./taskCache";
import { nextSiblingPosition } from "./taskTree";

export type TaskCreationOkrTarget = {
  keyResultId: string;
  objectiveId: string;
  title: string;
  position: number;
};

export type TaskCreationInput = Omit<Parameters<typeof createTask>[1], "workspaceId" | "position"> & {
  optimisticOrder?: { listKey: string; sectionId: string | null; taskIds: string[] };
  okrTarget?: TaskCreationOkrTarget;
};

export type TaskCreationResult = { id: string; okrLinkError?: string };

type Dependencies = {
  queryClient: QueryClient;
  workspaceId: string;
  userId: string;
  isOnline: () => boolean;
  create: (input: Parameters<typeof createTask>[1]) => Promise<Task>;
  link: (taskId: string, keyResultId: string) => Promise<TaskOkrLink | null>;
  rememberLocalChange?: (table: string, ids: Iterable<string>) => void;
};

type PendingCreation = {
  workspaceId: string;
  optimisticId: string;
  target?: TaskCreationOkrTarget;
  countKeys: Set<string>;
};

type CreationState = {
  revision: number;
  pending: Set<PendingCreation>;
  listeners: Set<() => void>;
};

// Request coordination only; never persisted or replayed after reconnecting.
const states = new WeakMap<QueryClient, CreationState>();
function stateFor(client: QueryClient) {
  let state = states.get(client);
  if (!state) {
    state = { revision: 0, pending: new Set(), listeners: new Set() };
    states.set(client, state);
  }
  return state;
}

export function hasPendingTaskCreations(client: QueryClient, workspaceId: string) {
  return [...stateFor(client).pending].some((item) => item.workspaceId === workspaceId);
}

function cancellationReason(signal?: AbortSignal) {
  return signal?.reason ?? new Error("查询已取消");
}

function checkCancellation(signal?: AbortSignal) {
  // The shared client also runs on iOS 15, where throwIfAborted is unavailable.
  if (signal?.aborted) throw cancellationReason(signal);
}

/** Do not let a focus/Realtime refetch replace a newer optimistic write. */
export async function readAfterTaskCreations<T>(
  client: QueryClient, workspaceId: string, read: () => Promise<T>, signal?: AbortSignal,
): Promise<T> {
  const state = stateFor(client);
  for (;;) {
    checkCancellation(signal);
    if (hasPendingTaskCreations(client, workspaceId)) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          state.listeners.delete(check);
          signal?.removeEventListener("abort", abort);
        };
        const check = () => {
          if (!hasPendingTaskCreations(client, workspaceId)) { cleanup(); resolve(); }
        };
        const abort = () => { cleanup(); reject(cancellationReason(signal)); };
        state.listeners.add(check);
        signal?.addEventListener("abort", abort, { once: true });
        check();
      });
    }
    checkCancellation(signal);
    const revision = state.revision;
    const data = await read();
    checkCancellation(signal);
    if (revision === state.revision) return data;
  }
}

function assertOnline(deps: Dependencies) {
  if (!deps.isOnline()) throw new Error("离线时无法创建或关联任务");
}

function summary(task: Task, target: TaskCreationOkrTarget, taskId = task.id): OkrLinkedTaskSummary {
  return {
    task_id: taskId, workspace_id: task.workspace_id, parent_task_id: task.parent_task_id,
    title: task.title, kind: task.kind, status: task.status, due_at: task.due_at,
    assignee_id: task.assignee_id, updated_at: task.updated_at,
    key_result_id: target.keyResultId, key_result_title: target.title,
    key_result_position: target.position,
  };
}

function updateOkrLists(client: QueryClient, pending: PendingCreation, task?: Task) {
  if (!pending.target) return;
  const target = pending.target;
  for (const key of [
    okrLinkedTasksKey(pending.workspaceId, { kind: "key_result", id: target.keyResultId }),
    okrLinkedTasksKey(pending.workspaceId, { kind: "objective", id: target.objectiveId }),
  ]) {
    client.setQueryData<OkrLinkedTaskSummary[]>(key, (current = []) => {
      const remaining = current.filter((row) => row.task_id !== pending.optimisticId && row.task_id !== task?.id);
      return task ? [summary(task, target), ...remaining] : remaining;
    });
  }
}

function adjustCounts(client: QueryClient, pending: PendingCreation, delta: 1 | -1) {
  if (!pending.target) return;
  const krId = pending.target.keyResultId;
  for (const query of client.getQueryCache().findAll({ queryKey: ["okr-linked-task-counts", pending.workspaceId] })) {
    const key = JSON.stringify(query.queryKey);
    const counts = query.state.data as Record<string, number> | undefined;
    if (delta === 1 ? !counts || !(krId in counts) : !pending.countKeys.has(key)) continue;
    if (delta === 1) pending.countKeys.add(key);
    client.setQueryData<Record<string, number>>(query.queryKey, (current) => current
      ? { ...current, [krId]: Math.max(0, (current[krId] ?? 0) + delta) }
      : current);
  }
  if (delta === -1) pending.countKeys.clear();
}

async function begin(deps: Dependencies, task: Task, target?: TaskCreationOkrTarget, existingTaskId?: string) {
  assertOnline(deps);
  const pending: PendingCreation = {
    workspaceId: deps.workspaceId, optimisticId: task.id, target, countKeys: new Set(),
  };
  const state = stateFor(deps.queryClient);
  state.pending.add(pending);
  state.revision++;
  try {
    await Promise.all([
      deps.queryClient.cancelQueries({ queryKey: ["workspace-bundle", deps.workspaceId] }),
      deps.queryClient.cancelQueries({ queryKey: ["okr-linked-tasks", deps.workspaceId] }),
      deps.queryClient.cancelQueries({ queryKey: ["okr-linked-task-counts", deps.workspaceId] }),
    ]);
    assertOnline(deps);
    const alreadyLinked = target && existingTaskId && deps.queryClient
      .getQueryData<OkrLinkedTaskSummary[]>(okrLinkedTasksKey(deps.workspaceId, { kind: "key_result", id: target.keyResultId }))
      ?.some((row) => row.task_id === existingTaskId);
    if (target && !alreadyLinked) {
      updateOkrLists(deps.queryClient, pending, task);
      adjustCounts(deps.queryClient, pending, 1);
    }
    return pending;
  } catch (error) {
    finish(deps, pending);
    throw error;
  }
}

function finish(deps: Dependencies, pending: PendingCreation) {
  const state = stateFor(deps.queryClient);
  state.pending.delete(pending);
  state.revision++;
  for (const check of [...state.listeners]) check();
}

function refreshOkr(deps: Dependencies) {
  // Refresh is a background verification. Its failure cannot undo a committed write.
  for (const prefix of ["okr-linked-tasks", "okr-linked-task-counts"]) {
    void deps.queryClient.invalidateQueries({ queryKey: [prefix, deps.workspaceId] }).catch(() => undefined);
  }
  void deps.queryClient.invalidateQueries({ queryKey: ["task-okr-link-ids"] }).catch(() => undefined);
}

async function confirmLink(deps: Dependencies, pending: PendingCreation, task: Task) {
  if (!pending.target) return;
  assertOnline(deps);
  const link = await deps.link(task.id, pending.target.keyResultId);
  pending.countKeys.clear();
  deps.rememberLocalChange?.("task_okr_links", [task.id]);
  deps.queryClient.setQueryDefaults(taskOkrLinkKey(task.id), { meta: { workspaceId: deps.workspaceId } });
  deps.queryClient.setQueryData(taskOkrLinkKey(task.id), link);
  updateOkrLists(deps.queryClient, pending, task);
}

/** Shared by inbox, label lists and OKR. Rollback removes only this request's rows. */
export async function submitTaskCreation(deps: Dependencies, input: TaskCreationInput): Promise<Task & TaskCreationResult> {
  assertOnline(deps);
  const client = deps.queryClient;
  const queryKey = ["workspace-bundle", deps.workspaceId];
  const bundle = client.getQueryData<WorkspaceBundle>(queryKey);
  const parentTaskId = input.parentTaskId ?? null;
  if (!parentTaskId) assertCanAssociateTaskLabels(bundle?.labelTaskCounts, input.labelIds);
  const taskInput = {
    ...input, workspaceId: deps.workspaceId, parentTaskId,
    position: parentTaskId ? nextSiblingPosition(bundle?.tasks ?? [], parentTaskId) : 0,
    labelIds: parentTaskId ? [] : input.labelIds,
  };
  const optimistic = createOptimisticTask({ ...taskInput, userId: deps.userId });
  const pending = await begin(deps, optimistic, input.okrTarget);
  client.setQueryData<WorkspaceBundle>(queryKey, (current) => {
    if (!current) return current;
    const appended = appendTaskToBundle(current, optimistic);
    return input.optimisticOrder ? applyTaskListOrderToBundle(appended, {
      workspaceId: deps.workspaceId, ...input.optimisticOrder,
      taskIds: [optimistic.id, ...input.optimisticOrder.taskIds],
    }) : appended;
  });
  try {
    assertOnline(deps);
    const created = await deps.create(taskInput);
    deps.rememberLocalChange?.("tasks", [created.id]);
    deps.rememberLocalChange?.("task_labels", [created.id]);
    const saved = created;
    client.setQueryData<WorkspaceBundle>(queryKey, (current) => current
      ? replaceOptimisticTask(current, optimistic.id, saved, taskInput.labelIds) : current);
    try {
      await confirmLink(deps, pending, created);
      return created;
    } catch (error) {
      updateOkrLists(client, pending);
      adjustCounts(client, pending, -1);
      return { ...created, okrLinkError: error instanceof Error ? error.message : "关联失败，请重试" };
    }
  } catch (error) {
    client.setQueryData<WorkspaceBundle>(queryKey, (current) => current
      ? removeTaskFromBundle(current, optimistic.id) : current);
    updateOkrLists(client, pending);
    adjustCounts(client, pending, -1);
    throw error;
  } finally {
    finish(deps, pending);
    if (input.okrTarget) refreshOkr(deps);
  }
}

/** An association retry never repeats task creation. */
export async function retryTaskCreationLink(deps: Dependencies, taskId: string, target: TaskCreationOkrTarget) {
  assertOnline(deps);
  const task = deps.queryClient.getQueryData<WorkspaceBundle>(["workspace-bundle", deps.workspaceId])?.tasks.find((row) => row.id === taskId);
  if (!task) throw new Error("待办尚未加载，请刷新后重试");
  const optimistic = { ...task, id: createOptimisticTask({ workspaceId: deps.workspaceId, userId: deps.userId, title: task.title, labelIds: [] }).id };
  const pending = await begin(deps, optimistic, target, taskId);
  try {
    await confirmLink(deps, pending, task);
  } catch (error) {
    updateOkrLists(deps.queryClient, pending);
    adjustCounts(deps.queryClient, pending, -1);
    throw error;
  } finally {
    finish(deps, pending);
    refreshOkr(deps);
  }
}

/** Persist server-confirmed data only, even if the app closes during a request. */
export function confirmedTaskCreationData(client: QueryClient, key: QueryKey, data: unknown, includePendingCounts = true): unknown {
  if (key[0] === "workspace-bundle" && data) {
    let bundle = data as WorkspaceBundle;
    for (const task of bundle.tasks) {
      if (isOptimisticTaskId(task.id)) bundle = removeTaskFromBundle(bundle, task.id);
    }
    return bundle;
  }
  if (key[0] === "okr-linked-tasks" && Array.isArray(data)) {
    return (data as OkrLinkedTaskSummary[]).filter((task) => !isOptimisticTaskId(task.task_id));
  }
  if (includePendingCounts && key[0] === "okr-linked-task-counts" && data) {
    const counts = { ...data as Record<string, number> };
    for (const pending of stateFor(client).pending) {
      if (pending.target && pending.countKeys.has(JSON.stringify(key))) {
        const id = pending.target.keyResultId;
        counts[id] = Math.max(0, (counts[id] ?? 0) - 1);
      }
    }
    return counts;
  }
  return data;
}
