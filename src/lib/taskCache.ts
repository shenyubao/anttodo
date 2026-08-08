import type {
  AiCliTool,
  Subtask,
  Task,
  TaskKind,
  TaskPlacement,
  TaskPriority,
  TaskReminder,
  TaskSection,
  WorkspaceBundle,
} from "../types";
import { orderedTaskSections, taskSectionOrderAfterInsert } from "./taskList";

export const OPTIMISTIC_TASK_ID_PREFIX = "optimistic-task:";
export const OPTIMISTIC_SECTION_ID_PREFIX = "optimistic-section:";
export const OPTIMISTIC_SUBTASK_ID_PREFIX = "optimistic-subtask:";

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
  optimisticId?: string;
  now?: string;
};

export function isOptimisticTaskId(taskId: string) {
  return taskId.startsWith(OPTIMISTIC_TASK_ID_PREFIX);
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
    assignee_id: input.assigneeId ?? null,
    cli_assignee: null,
    created_by: input.userId,
    completed_at: null,
    deleted_at: null,
    version: 1,
    created_at: timestamp,
    updated_at: timestamp,
    label_ids: input.labelIds,
    participant_ids: defaultCreatorParticipantIds(input.userId, input.assigneeId),
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
    estimate_hours: created.estimate_hours ?? null,
    actual_hours: created.actual_hours ?? null,
    assignee_id: created.assignee_id ?? null,
    cli_assignee: created.cli_assignee ?? null,
    created_by: created.created_by,
    completed_at: created.completed_at ?? null,
    deleted_at: created.deleted_at ?? null,
    version: created.version ?? 1,
    created_at: created.created_at,
    updated_at: created.updated_at,
    label_ids: labelIds,
    participant_ids: defaultCreatorParticipantIds(
      created.created_by,
      created.assignee_id ?? null,
    ),
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
  const position = Math.max(0, Math.min(input.index ?? ordered.length, ordered.length));
  const nextIds = taskSectionOrderAfterInsert(ordered, input.section.id, position);
  const positionById = new Map(nextIds.map((id, nextPosition) => [id, nextPosition]));
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

export type OptimisticSubtaskInput = {
  taskId: string;
  userId: string;
  title: string;
  position: number;
  dueAt?: string | null;
  assigneeId?: string | null;
  cliAssignee?: AiCliTool | null;
  optimisticId?: string;
};

export function isOptimisticSubtaskId(subtaskId: string) {
  return subtaskId.startsWith(OPTIMISTIC_SUBTASK_ID_PREFIX);
}

export function createOptimisticSubtask(input: OptimisticSubtaskInput): Subtask {
  return {
    id: input.optimisticId ?? `${OPTIMISTIC_SUBTASK_ID_PREFIX}${crypto.randomUUID()}`,
    task_id: input.taskId,
    title: input.title,
    description: "",
    completed: false,
    position: input.position,
    due_at: input.dueAt ?? null,
    estimate_hours: null,
    actual_hours: null,
    assignee_id: input.assigneeId ?? null,
    cli_assignee: input.cliAssignee ?? null,
    created_by: input.userId,
  };
}

export function replaceOptimisticSubtask(
  bundle: WorkspaceBundle,
  taskId: string,
  optimisticId: string,
  created: Subtask,
): WorkspaceBundle {
  return patchTaskInBundle(bundle, taskId, (task) => {
    const withoutCreated = task.subtasks.filter((item) => item.id !== created.id);
    const optimisticIndex = withoutCreated.findIndex((item) => item.id === optimisticId);
    const subtasks = optimisticIndex >= 0
      ? withoutCreated.map((item, index) => index === optimisticIndex ? created : item)
      : [...withoutCreated, created];
    return { ...task, subtasks };
  });
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
