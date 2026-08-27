import type {
  AiCliTool,
  Task,
  TaskDependency,
  TaskKind,
  TaskPlacement,
  TaskPriority,
  TaskReminder,
  TaskSection,
  WorkspaceBundle,
} from "../types";
import {
  applyLiveLabelCountDelta,
  adjustLabelTaskCounts,
  countLiveTasksByLabel,
} from "./labelTaskLimits";
import { descendantIds, isLiveTask } from "./taskTree";
import {
  orderedTaskSections,
  positionsFromGroupKeys,
  taskSectionOrderAfterInsert,
} from "./taskList";

export const OPTIMISTIC_TASK_ID_PREFIX = "optimistic-task:";
export const OPTIMISTIC_SECTION_ID_PREFIX = "optimistic-section:";

export type OptimisticTaskInput = {
  workspaceId: string;
  userId: string;
  title: string;
  labelIds: string[];
  description?: string;
  dueAt?: string | null;
  dueTimezone?: string | null;
  estimateHours?: number | null;
  priority?: TaskPriority;
  kind?: TaskKind;
  assigneeId?: string | null;
  parentTaskId?: string | null;
  position?: number;
  optimisticId?: string;
  now?: string;
};

export function isOptimisticTaskId(taskId: string) {
  return taskId.startsWith(OPTIMISTIC_TASK_ID_PREFIX);
}

export function persistableListOrderTaskIds<T extends { id: string }>(
  tasks: T[],
  canPersist: (task: T) => boolean = () => true,
) {
  return tasks
    .filter((task) => !isOptimisticTaskId(task.id) && canPersist(task))
    .map((task) => task.id);
}

/** Fill fields added after older persisted query caches were written. */
export function normalizeWorkspaceBundle(bundle: WorkspaceBundle): WorkspaceBundle {
  const flattened: Task[] = [];
  const flatInputIds = new Set((bundle.tasks ?? []).map((task) => task.id));
  const hasFlatTreeRows = (bundle.tasks ?? []).some((task) => Boolean(task.parent_task_id));
  const visit = (task: Task, inheritedParentId: string | null) => {
    const children = Array.isArray(task.children) ? task.children : [];
    const normalized = {
      ...task,
      parent_task_id: task.parent_task_id ?? inheritedParentId,
      position: task.position ?? 0,
      external_id: task.external_id ?? null,
      connector_id: task.connector_id ?? null,
      connector_platform: task.connector_platform ?? null,
      children: [] as Task[],
    };
    flattened.push(normalized);
    for (const child of hasFlatTreeRows ? [] : children) {
      if (!flatInputIds.has(child.id)) visit(child, task.id);
    }
  };
  for (const task of bundle.tasks ?? []) {
    if (!flattened.some((item) => item.id === task.id)) visit(task, null);
  }
  const byParent = new Map<string, Task[]>();
  for (const task of flattened) {
    if (!task.parent_task_id || task.deleted_at) continue;
    byParent.set(task.parent_task_id, [...(byParent.get(task.parent_task_id) ?? []), task]);
  }
  const tasks = flattened.map((task) => ({
    ...task,
    children: (byParent.get(task.id) ?? []).sort((a, b) => a.position - b.position),
  }));
  return {
    ...bundle,
    tasks,
    connectors: (bundle.connectors ?? []).map((connector) => ({
      ...connector,
      target_label_id: connector.target_label_id ?? null,
    })),
    customTaskViews: bundle.customTaskViews ?? [],
    taskSystemViewPreferences: bundle.taskSystemViewPreferences ?? [],
    labelTaskCounts: bundle.labelTaskCounts ?? countLiveTasksByLabel(tasks),
  };
}

/** Creator auto-watches unless self-assigned (mirrors create_task_with_labels). */
export function defaultCreatorParticipantIds(
  creatorId: string,
  assigneeId?: string | null,
): string[] {
  return assigneeId === creatorId ? [] : [creatorId];
}

export function createOptimisticTask(input: OptimisticTaskInput): Task {
  const timestamp = input.now ?? new Date().toISOString();
  const kind = input.kind ?? "todo";
  return {
    id: input.optimisticId ?? `${OPTIMISTIC_TASK_ID_PREFIX}${crypto.randomUUID()}`,
    workspace_id: input.workspaceId,
    parent_task_id: input.parentTaskId ?? null,
    position: input.position ?? 0,
    title: input.title,
    description: input.description ?? "",
    kind,
    status: "open",
    priority: kind === "note" ? "none" : input.priority ?? "low",
    due_at: input.dueAt ?? null,
    due_start_at: null,
    due_is_all_day: false,
    due_timezone: input.dueTimezone ?? null,
    recurrence: null,
    estimate_hours: input.estimateHours ?? null,
    actual_hours: null,
    estimate_pomodoros: null,
    actual_pomodoros: null,
    assignee_id: input.assigneeId ?? null,
    cli_assignee: null,
    created_by: input.userId,
    completed_at: null,
    deleted_at: null,
    version: 1,
    created_at: timestamp,
    updated_at: timestamp,
    external_id: null,
    connector_id: null,
    connector_platform: null,
    label_ids: input.labelIds,
    participant_ids: defaultCreatorParticipantIds(input.userId, input.assigneeId),
    description_mentions: [],
    children: [],
    reminders: [],
    reminder_persistent: false,
    dependencies: [],
  };
}

function taskFromCreatedRow(
  created: Partial<Task> & Pick<
    Task,
    "id" | "workspace_id" | "title" | "created_by" | "created_at" | "updated_at"
  >,
  labelIds: string[],
): Task {
  return {
    id: created.id,
    workspace_id: created.workspace_id,
    parent_task_id: created.parent_task_id ?? null,
    position: created.position ?? 0,
    title: created.title,
    description: created.description ?? "",
    kind: created.kind ?? "todo",
    status: created.status ?? "open",
    priority: created.priority ?? "none",
    due_at: created.due_at ?? null,
    due_start_at: created.due_start_at ?? null,
    due_is_all_day: created.due_is_all_day ?? false,
    due_timezone: created.due_timezone ?? null,
    recurrence: created.recurrence ?? null,
    estimate_hours: created.estimate_hours ?? null,
    actual_hours: created.actual_hours ?? null,
    estimate_pomodoros: created.estimate_pomodoros ?? null,
    actual_pomodoros: created.actual_pomodoros ?? null,
    assignee_id: created.assignee_id ?? null,
    cli_assignee: created.cli_assignee ?? null,
    created_by: created.created_by,
    completed_at: created.completed_at ?? null,
    deleted_at: created.deleted_at ?? null,
    version: created.version ?? 1,
    created_at: created.created_at,
    updated_at: created.updated_at,
    external_id: created.external_id ?? null,
    connector_id: created.connector_id ?? null,
    connector_platform: created.connector_platform ?? null,
    label_ids: labelIds,
    participant_ids: defaultCreatorParticipantIds(
      created.created_by,
      created.assignee_id ?? null,
    ),
    description_mentions: created.description_mentions ?? [],
    children: [],
    reminders: [],
    reminder_persistent: false,
    dependencies: created.dependencies ?? [],
  };
}

export function appendTaskToBundle(bundle: WorkspaceBundle, task: Task): WorkspaceBundle {
  if (bundle.tasks.some((item) => item.id === task.id)) return bundle;
  return normalizeWorkspaceBundle({
    ...bundle,
    tasks: [task, ...bundle.tasks],
    labelTaskCounts: isLiveTask(task)
      ? adjustLabelTaskCounts(
          bundle.labelTaskCounts ?? countLiveTasksByLabel(bundle.tasks),
          task.label_ids,
          1,
        )
      : bundle.labelTaskCounts,
  });
}

export function replaceOptimisticTask(
  bundle: WorkspaceBundle,
  optimisticId: string,
  created: Partial<Task> & Pick<
    Task,
    "id" | "workspace_id" | "title" | "created_by" | "created_at" | "updated_at"
  >,
  labelIds: string[],
): WorkspaceBundle {
  const task = taskFromCreatedRow(created, labelIds);
  const withoutCreated = bundle.tasks.filter((item) => item.id !== created.id);
  const optimisticIndex = withoutCreated.findIndex((item) => item.id === optimisticId);
  const tasks = optimisticIndex >= 0
    ? withoutCreated.map((item, index) => index === optimisticIndex ? task : item)
    : [task, ...withoutCreated];
  const placements = bundle.taskPlacements.map((placement) =>
    placement.task_id === optimisticId
      ? { ...placement, task_id: created.id }
      : placement,
  );

  return normalizeWorkspaceBundle({
    ...bundle,
    tasks,
    taskPlacements: deduplicatePlacements(placements),
  });
}

export function removeTaskFromBundle(bundle: WorkspaceBundle, taskId: string): WorkspaceBundle {
  const removedIds = new Set([taskId, ...descendantIds(bundle.tasks, taskId)]);
  const removedTasks = bundle.tasks.filter((task) => removedIds.has(task.id));
  let labelTaskCounts = bundle.labelTaskCounts;
  if (labelTaskCounts) {
    for (const task of removedTasks) {
      if (!isLiveTask(task)) continue;
      labelTaskCounts = adjustLabelTaskCounts(labelTaskCounts, task.label_ids, -1);
    }
  }
  return {
    ...bundle,
    tasks: bundle.tasks
      .filter((task) => !removedIds.has(task.id))
      .map((task) => ({
        ...task,
        dependencies: (task.dependencies ?? []).filter((item) =>
          !removedIds.has(item.depends_on_task_id) && !removedIds.has(item.task_id)),
        children: task.children.filter((child) => !removedIds.has(child.id)),
      })),
    taskPlacements: bundle.taskPlacements.filter((placement) => !removedIds.has(placement.task_id)),
    labelTaskCounts: labelTaskCounts ?? bundle.labelTaskCounts,
  };
}

function deduplicatePlacements(placements: TaskPlacement[]) {
  const seen = new Set<string>();
  return placements.filter((placement) => {
    const key = `${placement.list_key}:${placement.task_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function applyTaskListOrderToBundle(
  bundle: WorkspaceBundle,
  input: {
    workspaceId: string;
    listKey: string;
    sectionId: string | null;
    taskIds: string[];
  },
): WorkspaceBundle {
  const moved = new Set(input.taskIds);
  return {
    ...bundle,
    taskPlacements: [
      ...bundle.taskPlacements.filter(
        (placement) => placement.list_key !== input.listKey || !moved.has(placement.task_id),
      ),
      ...input.taskIds.map((taskId, position) => ({
        workspace_id: input.workspaceId,
        list_key: input.listKey,
        task_id: taskId,
        section_id: input.sectionId,
        position,
      })),
    ],
  };
}

export function applyTaskSectionOrderToBundle(
  bundle: WorkspaceBundle,
  input: {
    listKey: string;
    sectionIds: string[];
  },
): WorkspaceBundle {
  const positionById = positionsFromGroupKeys(input.sectionIds);
  return {
    ...bundle,
    taskSections: bundle.taskSections.map((section) =>
      section.list_key === input.listKey && positionById.has(section.id)
        ? { ...section, position: positionById.get(section.id)! }
        : section),
  };
}

export function isOptimisticSectionId(sectionId: string) {
  return sectionId.startsWith(OPTIMISTIC_SECTION_ID_PREFIX);
}

export function createOptimisticTaskSection(input: {
  workspaceId: string;
  listKey: string;
  name: string;
  position: number;
  createdBy: string;
  sectionId?: string;
}): TaskSection {
  return {
    id: input.sectionId ?? `${OPTIMISTIC_SECTION_ID_PREFIX}${crypto.randomUUID()}`,
    workspace_id: input.workspaceId,
    list_key: input.listKey,
    name: input.name,
    position: input.position,
    created_by: input.createdBy,
  };
}

export function applyTaskSectionInsertToBundle(
  bundle: WorkspaceBundle,
  input: {
    listKey: string;
    section: TaskSection;
    index?: number;
  },
): WorkspaceBundle {
  const ordered = orderedTaskSections(
    bundle.taskSections.filter((section) => section.list_key === input.listKey),
  ).filter((section) => section.id !== input.section.id);
  const nextIds = taskSectionOrderAfterInsert(ordered, input.section.id, input.index);
  const positionById = positionsFromGroupKeys(nextIds);
  const position = positionById.get(input.section.id)
    ?? Math.max(0, Math.min(input.index ?? nextIds.length - 1, nextIds.length - 1));
  return {
    ...bundle,
    taskSections: [
      ...bundle.taskSections
        .filter((section) => section.id !== input.section.id)
        .map((section) =>
          section.list_key === input.listKey && positionById.has(section.id)
            ? { ...section, position: positionById.get(section.id)! }
            : section),
      { ...input.section, position },
    ],
  };
}

export function replaceOptimisticTaskSection(
  bundle: WorkspaceBundle,
  optimisticId: string,
  section: TaskSection,
): WorkspaceBundle {
  if (optimisticId === section.id) {
    return {
      ...bundle,
      taskSections: bundle.taskSections.map((item) =>
        item.id === optimisticId ? section : item),
    };
  }
  return {
    ...bundle,
    taskSections: bundle.taskSections.map((item) =>
      item.id === optimisticId ? section : item),
    taskPlacements: bundle.taskPlacements.map((placement) =>
      placement.section_id === optimisticId
        ? { ...placement, section_id: section.id }
        : placement),
  };
}

export function patchTaskSectionInBundle(
  bundle: WorkspaceBundle,
  sectionId: string,
  patch: Partial<Pick<TaskSection, "name" | "position">>,
): WorkspaceBundle {
  return {
    ...bundle,
    taskSections: bundle.taskSections.map((section) =>
      section.id === sectionId ? { ...section, ...patch } : section),
  };
}

export function removeTaskSectionFromBundle(
  bundle: WorkspaceBundle,
  sectionId: string,
): WorkspaceBundle {
  return {
    ...bundle,
    taskSections: bundle.taskSections.filter((section) => section.id !== sectionId),
    taskPlacements: bundle.taskPlacements.map((placement) =>
      placement.section_id === sectionId
        ? { ...placement, section_id: null }
        : placement),
  };
}

export function sectionIdFromRealtimeChange(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const change = payload as {
    new?: Record<string, unknown>;
    old?: Record<string, unknown>;
  };
  const record = change.new && Object.keys(change.new).length > 0 ? change.new : change.old;
  const value = record?.id;
  return typeof value === "string" ? value : null;
}

/** custom_task_views.id or task_system_view_preferences.view_key */
export function smartViewIdFromRealtimeChange(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const change = payload as {
    table?: unknown;
    new?: Record<string, unknown>;
    old?: Record<string, unknown>;
  };
  const record = change.new && Object.keys(change.new).length > 0 ? change.new : change.old;
  if (!record) return null;
  if (change.table === "task_system_view_preferences") {
    const viewKey = record.view_key;
    return typeof viewKey === "string" ? viewKey : null;
  }
  const id = record.id;
  return typeof id === "string" ? id : null;
}

export function taskIdFromRealtimeChange(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const change = payload as {
    table?: unknown;
    new?: Record<string, unknown>;
    old?: Record<string, unknown>;
  };
  const record = change.new && Object.keys(change.new).length > 0 ? change.new : change.old;
  if (!record) return null;
  const value = change.table === "tasks" ? record.id : record.task_id;
  return typeof value === "string" ? value : null;
}

export function patchTaskInBundle(
  bundle: WorkspaceBundle,
  taskId: string,
  patch: Partial<Task> | ((task: Task) => Task),
): WorkspaceBundle {
  const previous = bundle.tasks.find((task) => task.id === taskId);
  const tasks = bundle.tasks.map((task) => {
    if (task.id !== taskId) return task;
    return typeof patch === "function" ? patch(task) : { ...task, ...patch };
  });
  const next = tasks.find((task) => task.id === taskId);
  return normalizeWorkspaceBundle({
    ...bundle,
    tasks,
    labelTaskCounts: previous && next && bundle.labelTaskCounts
      ? applyLiveLabelCountDelta(bundle.labelTaskCounts, previous, next)
      : bundle.labelTaskCounts,
  });
}

export function applyTaskScheduleToBundle(
  bundle: WorkspaceBundle,
  taskId: string,
  patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
  input: {
    reminders: TaskReminder[];
    reminderPersistent: boolean;
    recurrence: Task["recurrence"];
  },
): WorkspaceBundle {
  return patchTaskInBundle(bundle, taskId, (task) => ({
    ...task,
    ...patch,
    reminders: input.reminders,
    reminder_persistent: input.reminderPersistent,
    recurrence: input.recurrence,
    updated_at: new Date().toISOString(),
    version: task.version + 1,
  }));
}

export function applyChildTaskScheduleToBundle(
  bundle: WorkspaceBundle,
  taskId: string,
  patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
  input: {
    reminders: TaskReminder[];
    reminderPersistent: boolean;
  },
): WorkspaceBundle {
  return patchTaskInBundle(bundle, taskId, {
    ...patch,
    reminders: input.reminders,
    reminder_persistent: input.reminderPersistent,
  });
}

export function findTaskIdForChildTask(
  bundle: WorkspaceBundle,
  taskId: string,
): string | null {
  return bundle.tasks.find((task) => task.id === taskId)?.parent_task_id ?? null;
}

export type OptimisticChildTaskInput = {
  taskId: string;
  userId: string;
  title: string;
  position: number;
  parentChildTaskId?: string | null;
  priority?: TaskPriority;
  dueAt?: string | null;
  dueStartAt?: string | null;
  dueIsAllDay?: boolean;
  dueTimezone?: string | null;
  assigneeId?: string | null;
  cliAssignee?: AiCliTool | null;
  optimisticId?: string;
};

export function isOptimisticChildTaskId(taskId: string) {
  return isOptimisticTaskId(taskId);
}

export function createOptimisticChildTask(input: OptimisticChildTaskInput): Task {
  const task = createOptimisticTask({
    workspaceId: "",
    userId: input.userId,
    title: input.title,
    labelIds: [],
    parentTaskId: input.parentChildTaskId ?? input.taskId,
    position: input.position,
    priority: input.priority,
    dueAt: input.dueAt,
    assigneeId: input.assigneeId,
    optimisticId: input.optimisticId,
  });
  return {
    ...task,
    due_start_at: input.dueStartAt ?? null,
    due_is_all_day: input.dueIsAllDay ?? false,
    due_timezone: input.dueTimezone ?? null,
    cli_assignee: input.cliAssignee ?? null,
  };
}

export function replaceOptimisticChildTask(
  bundle: WorkspaceBundle,
  taskId: string,
  optimisticId: string,
  created: Task,
): WorkspaceBundle {
  const parent = bundle.tasks.find((item) => item.id === taskId);
  const next = { ...created, workspace_id: created.workspace_id || parent?.workspace_id || "" };
  return normalizeWorkspaceBundle({
    ...bundle,
    tasks: bundle.tasks.map((item) => item.id === optimisticId ? next : item),
  });
}

export function appendChildTaskInBundle(
  bundle: WorkspaceBundle,
  taskId: string,
  childTask: Task,
): WorkspaceBundle {
  if (bundle.tasks.some((item) => item.id === childTask.id)) return bundle;
  const parent = bundle.tasks.find((item) => item.id === taskId);
  return normalizeWorkspaceBundle({
    ...bundle,
    tasks: [...bundle.tasks, {
      ...childTask,
      workspace_id: childTask.workspace_id || parent?.workspace_id || "",
      parent_task_id: childTask.parent_task_id ?? taskId,
    }],
  });
}

export function appendTaskDependenciesInBundle(
  bundle: WorkspaceBundle,
  taskId: string,
  rows: TaskDependency[],
): WorkspaceBundle {
  if (rows.length === 0) return bundle;
  return patchTaskInBundle(bundle, taskId, (task) => {
    const existing = new Set((task.dependencies ?? []).map((item) => item.id));
    return {
      ...task,
      dependencies: [...(task.dependencies ?? []), ...rows.filter((row) => !existing.has(row.id))],
    };
  });
}

export function removeTaskDependencyFromBundle(
  bundle: WorkspaceBundle,
  dependencyId: string,
): WorkspaceBundle {
  return {
    ...bundle,
    tasks: bundle.tasks.map((task) => ({
      ...task,
      dependencies: (task.dependencies ?? []).filter((item) => item.id !== dependencyId),
    })),
  };
}

export function patchChildTaskInBundle(
  bundle: WorkspaceBundle,
  taskId: string,
  patch: Partial<Task>,
): WorkspaceBundle {
  return patchTaskInBundle(bundle, taskId, patch);
}

export function removeChildTaskFromBundle(
  bundle: WorkspaceBundle,
  taskId: string,
): WorkspaceBundle {
  return removeTaskFromBundle(bundle, taskId);
}
