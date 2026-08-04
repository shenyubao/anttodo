import type {
  Subtask,
  Task,
  TaskKind,
  TaskPlacement,
  TaskPriority,
  TaskReminder,
  WorkspaceBundle,
} from "../types";

export const OPTIMISTIC_TASK_ID_PREFIX = "optimistic-task:";

export type OptimisticTaskInput = {
  workspaceId: string;
  userId: string;
  title: string;
  labelIds: string[];
  description?: string;
  dueAt?: string | null;
  dueTimezone?: string | null;
  priority?: TaskPriority;
  kind?: TaskKind;
  assigneeId?: string | null;
  optimisticId?: string;
  now?: string;
};

export function isOptimisticTaskId(taskId: string) {
  return taskId.startsWith(OPTIMISTIC_TASK_ID_PREFIX);
}

export function createOptimisticTask(input: OptimisticTaskInput): Task {
  const timestamp = input.now ?? new Date().toISOString();
  const kind = input.kind ?? "todo";
  return {
    id: input.optimisticId ?? `${OPTIMISTIC_TASK_ID_PREFIX}${crypto.randomUUID()}`,
    workspace_id: input.workspaceId,
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
    assignee_id: input.assigneeId ?? null,
    cli_assignee: null,
    created_by: input.userId,
    completed_at: null,
    deleted_at: null,
    version: 1,
    created_at: timestamp,
    updated_at: timestamp,
    label_ids: input.labelIds,
    participant_ids: [],
    subtasks: [],
    reminders: [],
    reminder_persistent: false,
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
    assignee_id: created.assignee_id ?? null,
    cli_assignee: created.cli_assignee ?? null,
    created_by: created.created_by,
    completed_at: created.completed_at ?? null,
    deleted_at: created.deleted_at ?? null,
    version: created.version ?? 1,
    created_at: created.created_at,
    updated_at: created.updated_at,
    label_ids: labelIds,
    participant_ids: [],
    subtasks: [],
    reminders: [],
    reminder_persistent: false,
  };
}

export function appendTaskToBundle(bundle: WorkspaceBundle, task: Task): WorkspaceBundle {
  if (bundle.tasks.some((item) => item.id === task.id)) return bundle;
  return { ...bundle, tasks: [task, ...bundle.tasks] };
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

  return {
    ...bundle,
    tasks,
    taskPlacements: deduplicatePlacements(placements),
  };
}

export function removeTaskFromBundle(bundle: WorkspaceBundle, taskId: string): WorkspaceBundle {
  return {
    ...bundle,
    tasks: bundle.tasks.filter((task) => task.id !== taskId),
    taskPlacements: bundle.taskPlacements.filter((placement) => placement.task_id !== taskId),
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
  const positionById = new Map(
    input.sectionIds.map((sectionId, position) => [sectionId, position]),
  );
  return {
    ...bundle,
    taskSections: bundle.taskSections.map((section) =>
      section.list_key === input.listKey && positionById.has(section.id)
        ? { ...section, position: positionById.get(section.id)! }
        : section),
  };
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
  return {
    ...bundle,
    tasks: bundle.tasks.map((task) => {
      if (task.id !== taskId) return task;
      return typeof patch === "function" ? patch(task) : { ...task, ...patch };
    }),
  };
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

export function findTaskIdForSubtask(
  bundle: WorkspaceBundle,
  subtaskId: string,
): string | null {
  return bundle.tasks.find((task) =>
    task.subtasks.some((subtask) => subtask.id === subtaskId),
  )?.id ?? null;
}

export function appendSubtaskInBundle(
  bundle: WorkspaceBundle,
  taskId: string,
  subtask: Subtask,
): WorkspaceBundle {
  return patchTaskInBundle(bundle, taskId, (task) => {
    if (task.subtasks.some((item) => item.id === subtask.id)) return task;
    return { ...task, subtasks: [...task.subtasks, subtask] };
  });
}

export function patchSubtaskInBundle(
  bundle: WorkspaceBundle,
  subtaskId: string,
  patch: Partial<Subtask>,
): WorkspaceBundle {
  return {
    ...bundle,
    tasks: bundle.tasks.map((task) => {
      if (!task.subtasks.some((item) => item.id === subtaskId)) return task;
      return {
        ...task,
        subtasks: task.subtasks.map((item) =>
          item.id === subtaskId ? { ...item, ...patch } : item
        ),
      };
    }),
  };
}

export function removeSubtaskFromBundle(
  bundle: WorkspaceBundle,
  subtaskId: string,
): WorkspaceBundle {
  return {
    ...bundle,
    tasks: bundle.tasks.map((task) => {
      if (!task.subtasks.some((item) => item.id === subtaskId)) return task;
      return {
        ...task,
        subtasks: task.subtasks.filter((item) => item.id !== subtaskId),
      };
    }),
  };
}
