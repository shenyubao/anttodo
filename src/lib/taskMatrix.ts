import type {
  Label,
  MatrixDueBucket,
  MatrixGrouping,
  MatrixQuadrantKey,
  MatrixQuadrantPreference,
  MatrixRuleDefinition,
  MatrixSort,
  SortDirection,
  Task,
  TaskKind,
  TaskPriority,
} from "../types";
import { toDateInput } from "./timeZoneCore";

export const MATRIX_QUADRANT_KEYS: readonly MatrixQuadrantKey[] = [
  "important_urgent",
  "important_not_urgent",
  "not_important_urgent",
  "not_important_not_urgent",
];

export const MATRIX_QUADRANT_COLORS: Record<MatrixQuadrantKey, string> = {
  important_urgent: "#ff5f68",
  important_not_urgent: "#ffb000",
  not_important_urgent: "#4772fa",
  not_important_not_urgent: "#0cce9c",
};

const IMPORTANT: TaskPriority[] = ["high", "medium"];
const NOT_IMPORTANT: TaskPriority[] = ["low", "none"];
const URGENT: MatrixDueBucket[] = ["overdue", "today", "tomorrow"];
const NOT_URGENT: MatrixDueBucket[] = ["later", "none"];

const DEFAULTS: Record<MatrixQuadrantKey, {
  name: string;
  definition: MatrixRuleDefinition;
}> = {
  important_urgent: {
    name: "重要且紧急",
    definition: { labels: "all", due: URGENT, priorities: IMPORTANT, kinds: "all", assignee: "all" },
  },
  important_not_urgent: {
    name: "重要不紧急",
    definition: { labels: "all", due: NOT_URGENT, priorities: IMPORTANT, kinds: "all", assignee: "all" },
  },
  not_important_urgent: {
    name: "不重要但紧急",
    definition: { labels: "all", due: URGENT, priorities: NOT_IMPORTANT, kinds: "all", assignee: "all" },
  },
  not_important_not_urgent: {
    name: "不重要不紧急",
    definition: { labels: "all", due: NOT_URGENT, priorities: NOT_IMPORTANT, kinds: "all", assignee: "all" },
  },
};

function cloneDefinition(
  definition: MatrixRuleDefinition,
  fallbackAssigneeId: string,
): MatrixRuleDefinition {
  return {
    labels: definition.labels === "all" ? "all" : [...definition.labels],
    due: definition.due === "all" ? "all" : [...definition.due],
    priorities: definition.priorities === "all" ? "all" : [...definition.priorities],
    kinds: definition.kinds === "all" ? "all" : [...definition.kinds],
    assignee: typeof definition.assignee === "string"
      ? definition.assignee
      : fallbackAssigneeId,
  };
}

export function defaultMatrixPreference(
  quadrantKey: MatrixQuadrantKey,
  userId: string,
  workspaceId: string,
): MatrixQuadrantPreference {
  const value = DEFAULTS[quadrantKey];
  return {
    user_id: userId,
    workspace_id: workspaceId,
    quadrant_key: quadrantKey,
    name: value.name,
    definition: {
      ...cloneDefinition(value.definition, userId),
      assignee: userId,
    },
    grouping: "due",
    sort: "due",
    direction: "asc",
  };
}

export function resolveMatrixPreferences(
  preferences: readonly MatrixQuadrantPreference[] | undefined,
  userId: string,
  workspaceId: string,
) {
  const byKey = new Map((preferences ?? []).map((item) => [item.quadrant_key, item]));
  return MATRIX_QUADRANT_KEYS.map((key) => {
    const saved = byKey.get(key);
    return saved ? { ...saved, definition: cloneDefinition(saved.definition, userId) }
      : defaultMatrixPreference(key, userId, workspaceId);
  });
}

function dayNumber(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function matrixDueBucket(
  dueAt: string | null,
  now: Date,
  timeZone?: string | null,
): MatrixDueBucket {
  if (!dueAt) return "none";
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return "none";
  const delta = Math.round((
    dayNumber(toDateInput(due, timeZone)) - dayNumber(toDateInput(now, timeZone))
  ) / 86_400_000);
  if (delta < 0) return "overdue";
  if (delta === 0) return "today";
  if (delta === 1) return "tomorrow";
  return "later";
}

export function effectiveMatrixPriority(task: Pick<Task, "kind" | "priority">): TaskPriority {
  return task.kind === "note" ? "none" : task.priority;
}

function taskMatchesLabels(
  task: Pick<Task, "label_ids">,
  labels: MatrixRuleDefinition["labels"],
) {
  if (labels === "all") return true;
  if (labels.includes("inbox") && task.label_ids.length === 0) return true;
  return task.label_ids.some((id) => labels.includes(id));
}

export function taskMatchesMatrixRule(
  task: Pick<Task, "kind" | "priority" | "due_at" | "due_timezone" | "label_ids" | "assignee_id" | "deleted_at" | "parent_task_id">,
  rule: MatrixRuleDefinition,
  now: Date,
) {
  if (task.deleted_at || task.parent_task_id) return false;
  if (rule.assignee !== "all" && task.assignee_id !== rule.assignee) return false;
  if (rule.kinds !== "all" && !rule.kinds.includes(task.kind)) return false;
  if (rule.priorities !== "all" && !rule.priorities.includes(effectiveMatrixPriority(task))) return false;
  if (rule.due !== "all" && !rule.due.includes(matrixDueBucket(task.due_at, now, task.due_timezone))) return false;
  return taskMatchesLabels(task, rule.labels);
}

const priorityRank: Record<TaskPriority, number> = { high: 3, medium: 2, low: 1, none: 0 };

export function sortMatrixTasks(
  tasks: readonly Task[],
  sort: MatrixSort,
  direction: SortDirection,
) {
  const multiplier = direction === "asc" ? 1 : -1;
  return tasks.map((task, index) => ({ task, index })).sort((left, right) => {
    let value = 0;
    if (sort === "due") {
      const a = left.task.due_at ? new Date(left.task.due_at).getTime() : Number.POSITIVE_INFINITY;
      const b = right.task.due_at ? new Date(right.task.due_at).getTime() : Number.POSITIVE_INFINITY;
      value = a - b;
    } else if (sort === "title") {
      value = left.task.title.localeCompare(right.task.title, "zh-CN");
    } else if (sort === "priority") {
      value = priorityRank[effectiveMatrixPriority(left.task)] - priorityRank[effectiveMatrixPriority(right.task)];
    } else {
      value = new Date(left.task.created_at).getTime() - new Date(right.task.created_at).getTime();
    }
    return value === 0 ? left.index - right.index : value * multiplier;
  }).map(({ task }) => task);
}

export type MatrixTaskGroup = { id: string; title: string; tasks: Task[] };

const DUE_TITLES: Record<MatrixDueBucket, string> = {
  overdue: "已过期",
  today: "今天",
  tomorrow: "明天",
  later: "更远",
  none: "无日期",
};

const PRIORITY_TITLES: Record<TaskPriority, string> = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
  none: "无优先级",
};

export function groupMatrixTasks(
  tasks: readonly Task[],
  grouping: MatrixGrouping,
  sort: MatrixSort,
  direction: SortDirection,
  labels: readonly Label[],
  now: Date,
): MatrixTaskGroup[] {
  const active = tasks.filter((task) => task.status === "open");
  const closed = tasks.filter((task) => task.status !== "open");
  const groups: MatrixTaskGroup[] = [];
  const push = (id: string, title: string, items: Task[]) => {
    if (items.length) groups.push({ id, title, tasks: sortMatrixTasks(items, sort, direction) });
  };
  if (grouping === "due") {
    (["overdue", "today", "tomorrow", "later", "none"] as MatrixDueBucket[])
      .forEach((bucket) => push(`due:${bucket}`, DUE_TITLES[bucket], active.filter((task) => matrixDueBucket(task.due_at, now, task.due_timezone) === bucket)));
  } else if (grouping === "priority") {
    (["high", "medium", "low", "none"] as TaskPriority[])
      .forEach((priority) => push(`priority:${priority}`, PRIORITY_TITLES[priority], active.filter((task) => effectiveMatrixPriority(task) === priority)));
  } else if (grouping === "label") {
    const visibleLabelIds = new Set(labels.map((label) => label.id));
    labels.forEach((label) => push(`label:${label.id}`, label.name, active.filter((task) =>
      task.label_ids.find((id) => visibleLabelIds.has(id)) === label.id)));
    push("label:inbox", "收集箱", active.filter((task) =>
      task.label_ids.length === 0));
  } else {
    push("all", "", active);
  }
  push("completed", "已完成", closed);
  return groups;
}

export type MatrixRuleResolution = {
  priority?: TaskPriority;
  dueBucket?: Exclude<MatrixDueBucket, "overdue">;
  addLabelId?: string;
  clearLabels?: boolean;
  assigneeId?: string;
};

const PRIORITY_SELECTION: TaskPriority[] = ["high", "medium", "low", "none"];
const DUE_SELECTION: Array<Exclude<MatrixDueBucket, "overdue">> = ["today", "tomorrow", "later", "none"];

export function resolveTaskForMatrixRule(
  task: Pick<Task, "kind" | "priority" | "due_at" | "due_timezone" | "label_ids" | "assignee_id">,
  rule: MatrixRuleDefinition,
  now: Date,
  editableLabelIds: ReadonlySet<string>,
  assignableUserIds?: ReadonlySet<string>,
): { resolution: MatrixRuleResolution } | { error: string } {
  if (rule.kinds !== "all" && !rule.kinds.includes(task.kind)) {
    return { error: "目标象限不接受当前任务类型" };
  }
  const resolution: MatrixRuleResolution = {};
  if (rule.assignee !== "all" && task.assignee_id !== rule.assignee) {
    if (assignableUserIds && !assignableUserIds.has(rule.assignee)) {
      return { error: "目标指派用户已不在当前团队空间" };
    }
    resolution.assigneeId = rule.assignee;
  }
  const currentPriority = effectiveMatrixPriority(task);
  if (rule.priorities !== "all" && !rule.priorities.includes(currentPriority)) {
    if (task.kind === "note") return { error: "笔记无法满足目标象限的优先级规则" };
    const priority = PRIORITY_SELECTION.find((value) => rule.priorities !== "all" && rule.priorities.includes(value));
    if (!priority) return { error: "目标象限没有可用优先级" };
    resolution.priority = priority;
  }
  const currentDue = matrixDueBucket(task.due_at, now, task.due_timezone);
  if (rule.due !== "all" && !rule.due.includes(currentDue)) {
    const dueBucket = DUE_SELECTION.find((value) => rule.due !== "all" && rule.due.includes(value));
    if (!dueBucket) return { error: "仅含已过期日期的象限无法安全接收此任务" };
    resolution.dueBucket = dueBucket;
  }
  if (!taskMatchesLabels(task, rule.labels)) {
    if (rule.labels === "all" || rule.labels.length === 0) return { error: "目标象限没有可用标签" };
    if (rule.labels.includes("inbox")) {
      resolution.clearLabels = true;
    } else {
      const labelId = rule.labels.find((id) => editableLabelIds.has(id));
      if (!labelId) return { error: "没有目标标签的管理权限" };
      resolution.addLabelId = labelId;
    }
  }
  return { resolution };
}

export function dueAtForMatrixBucket(
  bucket: Exclude<MatrixDueBucket, "overdue">,
  now: Date,
) {
  if (bucket === "none") return null;
  const dayOffset = bucket === "today" ? 0 : bucket === "tomorrow" ? 1 : 2;
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, 12, 0, 0, 0);
  return due.toISOString();
}

export function defaultTaskKindForMatrixRule(rule: MatrixRuleDefinition): TaskKind {
  return rule.kinds === "all" || rule.kinds.includes("todo") ? "todo" : "note";
}
