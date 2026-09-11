import type { Task } from "../types";
import { visibleFlattenedTasks } from "./taskTree";

export type TaskPointerModifiers = {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
};

export type TaskSelectionState = {
  selectedIds: string[];
  anchorId: string | null;
};

export function modifiersFromMouseEvent(event: {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): TaskPointerModifiers {
  return {
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
  };
}

export function isModifiedTaskSelect(modifiers: TaskPointerModifiers) {
  return modifiers.shiftKey || modifiers.metaKey || modifiers.ctrlKey;
}

export function uniqueTaskIds(ids: readonly string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export function tasksForIds(pool: readonly Task[], ids: readonly string[]) {
  const byId = new Map<string, Task>();
  for (const task of pool) {
    byId.set(task.id, task);
    for (const child of task.children) byId.set(child.id, child);
  }
  return ids.flatMap((id) => {
    const task = byId.get(id);
    return task ? [task] : [];
  });
}

export function contextMenuActionTasks(
  focus: Pick<Task, "id">,
  selectedTasks: readonly Task[] = [],
) {
  if (selectedTasks.length >= 2 && selectedTasks.some((task) => task.id === focus.id)) {
    return [...selectedTasks];
  }
  return null;
}

export function applyTaskPointerSelect(input: {
  taskId: string;
  modifiers: TaskPointerModifiers;
  orderedIds: readonly string[];
  selectedIds: readonly string[];
  anchorId: string | null;
}): TaskSelectionState {
  const { taskId, modifiers, orderedIds } = input;
  const selectedIds = uniqueTaskIds(input.selectedIds);

  if (modifiers.shiftKey) {
    const anchor = input.anchorId && orderedIds.includes(input.anchorId)
      ? input.anchorId
      : taskId;
    const from = orderedIds.indexOf(anchor);
    const to = orderedIds.indexOf(taskId);
    if (from === -1 || to === -1) {
      return {
        selectedIds: uniqueTaskIds([...selectedIds, taskId]),
        anchorId: taskId,
      };
    }
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    return {
      selectedIds: uniqueTaskIds([...selectedIds, ...orderedIds.slice(start, end + 1)]),
      anchorId: taskId,
    };
  }

  if (modifiers.metaKey || modifiers.ctrlKey) {
    const next = selectedIds.includes(taskId)
      ? selectedIds.filter((id) => id !== taskId)
      : [...selectedIds, taskId];
    return { selectedIds: next, anchorId: taskId };
  }

  return { selectedIds: [taskId], anchorId: taskId };
}

export function visibleListTaskIds(input: {
  groups: ReadonlyArray<{ tasks: readonly Task[] }>;
  treeTasks: readonly Task[];
  collapsedChildIds: ReadonlySet<string>;
}) {
  const ids: string[] = [];
  for (const group of input.groups) {
    for (const task of group.tasks) {
      ids.push(task.id);
      if (input.collapsedChildIds.has(task.id)) continue;
      for (const row of visibleFlattenedTasks(
        input.treeTasks,
        task.id,
        input.collapsedChildIds,
      )) {
        ids.push(row.task.id);
      }
    }
  }
  return ids;
}

export function visibleTaskIdsFromElement(root: Element | null) {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>("[data-task-id]"))
    .map((element) => element.dataset.taskId)
    .filter((id): id is string => Boolean(id));
}

export function labelSelectionState(
  tasks: readonly Pick<Task, "label_ids">[],
  labelId: string,
): "all" | "some" | "none" {
  if (tasks.length === 0) return "none";
  const count = tasks.filter((task) => task.label_ids.includes(labelId)).length;
  if (count === 0) return "none";
  if (count === tasks.length) return "all";
  return "some";
}

export function sharedDueFields(tasks: readonly Task[]) {
  if (tasks.length === 0) return null;
  const first = tasks[0]!;
  const same = tasks.every((task) =>
    task.due_at === first.due_at
    && task.due_start_at === first.due_start_at
    && task.due_is_all_day === first.due_is_all_day
    && task.due_timezone === first.due_timezone);
  return same
    ? {
      due_at: first.due_at,
      due_start_at: first.due_start_at,
      due_is_all_day: first.due_is_all_day,
      due_timezone: first.due_timezone,
    }
    : null;
}

export function intersectLabelIds(tasks: readonly Pick<Task, "label_ids">[]) {
  if (tasks.length === 0) return [];
  return tasks[0]!.label_ids.filter((id) =>
    tasks.every((task) => task.label_ids.includes(id)));
}

export function allTasksUnlabeled(tasks: readonly Pick<Task, "label_ids">[]) {
  return tasks.length > 0 && tasks.every((task) => task.label_ids.length === 0);
}

export async function runBulkTaskUpdates<T>(
  items: readonly T[],
  action: (item: T) => Promise<void>,
) {
  let ok = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await action(item);
      ok += 1;
    } catch {
      failed += 1;
    }
  }
  return { ok, failed };
}

export function formatBulkNotice(input: {
  ok: number;
  failed: number;
  skipped: number;
  action: string;
}) {
  if (input.ok === 0 && input.failed === 0) {
    return input.skipped > 0 ? `没有可${input.action}的任务` : null;
  }
  if (input.failed === 0) {
    return input.skipped > 0 ? `${input.ok} 项已${input.action}` : null;
  }
  return `${input.ok} 项已${input.action}，${input.failed} 项失败`;
}
