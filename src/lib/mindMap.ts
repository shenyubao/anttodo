import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  type Day,
} from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  fromZonedDateTime,
  preferenceWeekNumber,
  toDateInput,
  toTimeInput,
  zonedDate,
} from "./dateTimePreferences";
import type { DateTimePreferences, Label, Task, UserLabelOrder } from "../types";
import { compareSiblingLabels, userLabelOrderMap } from "./labels";

export type MindMapNodeKind =
  | "root"
  | "month"
  | "week"
  | "day"
  | "inbox"
  | "unscheduled"
  | "label"
  | "task";

export type MindMapLabelDisplayMode = "full" | "merged" | "leaf" | "hidden";

export const MIND_MAP_LABEL_DISPLAY_OPTIONS: Array<{
  value: MindMapLabelDisplayMode;
  label: string;
}> = [
  { value: "full", label: "展示完整路径" },
  { value: "merged", label: "合并路径展示" },
  { value: "leaf", label: "展示叶子标签" },
  { value: "hidden", label: "不展示标签" },
];

export const DEFAULT_MIND_MAP_LABEL_DISPLAY_MODE: MindMapLabelDisplayMode = "merged";

export type MindMapScheduleLevel = "day" | "week" | "month";

export type MindMapScheduleTarget =
  | { level: "none" }
  | { level: "day"; dateKey: string }
  | { level: "week"; startKey: string; endKey: string }
  | { level: "month"; startKey: string; endKey: string };

export type MindMapTreeNode = {
  id: string;
  kind: MindMapNodeKind;
  label: string;
  dateKey?: string;
  dateEndKey?: string;
  scheduleLevel?: MindMapScheduleLevel;
  contextKey?: string;
  labelId?: string;
  labelColor?: string;
  task?: Task;
  children: MindMapTreeNode[];
};

type WeekBucket = {
  label: string;
  endKey: string;
  days: string[];
};

function dateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function taskDateKey(task: Task) {
  return task.due_at ? toDateInput(task.due_at, task.due_timezone) : null;
}

function weekBounds(date: Date, weekStartsOn: DateTimePreferences["weekStartsOn"]) {
  const weekStart = startOfWeek(date, { weekStartsOn: weekStartsOn as Day });
  const weekEnd = endOfWeek(date, { weekStartsOn: weekStartsOn as Day });
  return {
    startKey: format(weekStart, "yyyy-MM-dd"),
    endKey: format(weekEnd, "yyyy-MM-dd"),
    label: `第${preferenceWeekNumber(date, weekStartsOn)}周 · ${format(weekStart, "M/d")}–${format(weekEnd, "M/d")}`,
    weekStart,
    weekEnd,
  };
}

function monthBounds(monthKey: string) {
  const start = startOfMonth(dateFromKey(`${monthKey}-01`));
  const end = endOfMonth(start);
  return {
    startKey: format(start, "yyyy-MM-dd"),
    endKey: format(end, "yyyy-MM-dd"),
  };
}

export function classifyTaskSchedule(
  task: Task,
  preferences: DateTimePreferences,
): MindMapScheduleTarget {
  if (!task.due_at) return { level: "none" };
  const endKey = toDateInput(task.due_at, task.due_timezone);
  if (!task.due_start_at || !task.due_is_all_day) {
    return { level: "day", dateKey: endKey };
  }
  const startKey = toDateInput(task.due_start_at, task.due_timezone);
  const month = monthBounds(startKey.slice(0, 7));
  if (startKey === month.startKey && endKey === month.endKey) {
    return { level: "month", startKey, endKey };
  }
  const week = weekBounds(dateFromKey(startKey), preferences.weekStartsOn);
  if (startKey === week.startKey && endKey === week.endKey) {
    return { level: "week", startKey, endKey };
  }
  if (startKey === endKey) return { level: "day", dateKey: startKey };
  return { level: "day", dateKey: endKey };
}

export function scheduleTargetKey(target: MindMapScheduleTarget) {
  if (target.level === "none") return null;
  if (target.level === "day") return `day:${target.dateKey}`;
  if (target.level === "week") return `week:${target.startKey}:${target.endKey}`;
  return `month:${target.startKey}:${target.endKey}`;
}

export function scheduleTargetFromNode(data: {
  kind: MindMapNodeKind;
  dateKey?: string;
  dateEndKey?: string;
  scheduleLevel?: MindMapScheduleLevel;
  contextKey?: string;
}): MindMapScheduleTarget {
  if (data.kind === "inbox" || data.contextKey === "inbox") return { level: "none" };
  if (data.kind === "unscheduled" || data.contextKey === "unscheduled") {
    return { level: "none" };
  }
  if (!data.dateKey) return { level: "none" };
  const level = data.scheduleLevel
    ?? (data.kind === "month" || data.kind === "week" || data.kind === "day"
      ? data.kind
      : "day");
  if (level === "day" || !data.dateEndKey) {
    return { level: "day", dateKey: data.dateKey };
  }
  if (level === "month") {
    return { level: "month", startKey: data.dateKey, endKey: data.dateEndKey };
  }
  return { level: "week", startKey: data.dateKey, endKey: data.dateEndKey };
}

export type MindMapDropPathNode = {
  kind: MindMapNodeKind;
  dateKey?: string;
  dateEndKey?: string;
  scheduleLevel?: MindMapScheduleLevel;
  contextKey?: string;
  labelId?: string;
};

/** Resolve schedule/label from a drop target and its ancestors (target → root). */
export function resolveMindMapDropAssignment(path: MindMapDropPathNode[]) {
  let schedule: MindMapScheduleTarget | null = null;
  let labelId: string | null = null;
  let clearLabels = false;

  const specificity = (target: MindMapScheduleTarget) => {
    if (target.level === "day") return 3;
    if (target.level === "week") return 2;
    if (target.level === "month") return 1;
    return 0;
  };

  for (const node of path) {
    if (node.kind === "inbox" || node.contextKey === "inbox") {
      clearLabels = true;
      schedule = { level: "none" };
      labelId = null;
      break;
    }
    if (labelId === null && node.labelId) {
      labelId = node.labelId;
    }
    if (node.kind === "unscheduled" || node.contextKey === "unscheduled") {
      if (schedule === null) schedule = { level: "none" };
      continue;
    }
    const nodeSchedule = scheduleTargetFromNode(node);
    if (nodeSchedule.level === "none") continue;
    // Prefer the most specific schedule on the path (day > week > month).
    if (schedule === null || specificity(nodeSchedule) > specificity(schedule)) {
      schedule = nodeSchedule;
    }
  }

  return {
    schedule: schedule ?? { level: "none" as const },
    applySchedule: schedule !== null,
    labelId,
    clearLabels,
  };
}

function compareTasks(a: Task, b: Task) {
  const dueDifference = (a.due_at ? new Date(a.due_at).getTime() : 0)
    - (b.due_at ? new Date(b.due_at).getTime() : 0);
  if (dueDifference) return dueDifference;
  const createdDifference = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  return createdDifference || a.id.localeCompare(b.id);
}

function taskNode(
  task: Task,
  contextKey: string,
  preferences: DateTimePreferences,
  labelId?: string,
): MindMapTreeNode {
  const schedule = classifyTaskSchedule(task, preferences);
  return {
    id: `task:${contextKey}:${labelId ?? "none"}:${task.id}`,
    kind: "task",
    label: task.title,
    dateKey: schedule.level === "day"
      ? schedule.dateKey
      : schedule.level === "none"
        ? undefined
        : schedule.startKey,
    dateEndKey: schedule.level === "week" || schedule.level === "month"
      ? schedule.endKey
      : undefined,
    scheduleLevel: schedule.level === "none" ? undefined : schedule.level,
    contextKey,
    labelId,
    task,
    children: [],
  };
}

function labelsById(labels: Label[]) {
  return new Map(labels.map((label) => [label.id, label]));
}

function labelPath(label: Label, byId: Map<string, Label>) {
  const names: string[] = [];
  let current: Label | undefined = label;
  const visiting = new Set<string>();
  while (current && !visiting.has(current.id)) {
    visiting.add(current.id);
    names.unshift(current.name);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return names.join(" / ");
}

function orderedLabelsFlat(
  labels: Label[],
  userOrder?: Map<string, number>,
) {
  const labelIds = new Set(labels.map((label) => label.id));
  const byParent = new Map<string | null, Label[]>();
  for (const label of labels) {
    const parentId = label.parent_id !== null && labelIds.has(label.parent_id)
      ? label.parent_id
      : null;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(label);
    byParent.set(parentId, siblings);
  }
  for (const [parentId, siblings] of byParent.entries()) {
    siblings.sort((a, b) => compareSiblingLabels(a, b, parentId, userOrder));
  }
  const result: Label[] = [];
  const visit = (parentId: string | null, visiting: Set<string>) => {
    for (const label of byParent.get(parentId) ?? []) {
      if (visiting.has(label.id)) continue;
      result.push(label);
      visit(label.id, new Set(visiting).add(label.id));
    }
  };
  visit(null, new Set());
  return result;
}

function tasksByVisibleLabel(tasks: Task[], labelIds: Set<string>) {
  const map = new Map<string, Task[]>();
  tasks.forEach((task) => {
    task.label_ids.forEach((labelId) => {
      if (!labelIds.has(labelId)) return;
      map.set(labelId, [...(map.get(labelId) ?? []), task]);
    });
  });
  return map;
}

function taskHasVisibleLabel(task: Task, labelIds: Set<string>) {
  return task.label_ids.some((labelId) => labelIds.has(labelId));
}

function labelTreeNodes({
  tasks,
  labels,
  contextKey,
  preferences,
  dateKey,
  dateEndKey,
  scheduleLevel,
  labelDisplayMode,
  userOrder,
}: {
  tasks: Task[];
  labels: Label[];
  contextKey: string;
  preferences: DateTimePreferences;
  dateKey?: string;
  dateEndKey?: string;
  scheduleLevel?: MindMapScheduleLevel;
  labelDisplayMode: MindMapLabelDisplayMode;
  userOrder?: Map<string, number>;
}): MindMapTreeNode[] {
  if (labelDisplayMode === "hidden") return [];

  const labelIds = new Set(labels.map((label) => label.id));
  const byId = labelsById(labels);
  const tasksByLabel = tasksByVisibleLabel(tasks, labelIds);
  const hasChildLabel = new Set(
    labels
      .filter((label) => label.parent_id !== null && labelIds.has(label.parent_id))
      .map((label) => label.parent_id as string),
  );

  const makeLabelNode = (
    label: Label,
    title: string,
    children: MindMapTreeNode[],
  ): MindMapTreeNode => ({
    id: `label:${contextKey}:${label.id}`,
    kind: "label",
    label: title,
    dateKey,
    dateEndKey,
    scheduleLevel,
    contextKey,
    labelId: label.id,
    labelColor: label.color,
    children,
  });

  const directTaskNodes = (label: Label) =>
    [...(tasksByLabel.get(label.id) ?? [])]
      .sort(compareTasks)
      .map((task) => taskNode(task, contextKey, preferences, label.id));

  if (labelDisplayMode === "merged") {
    return orderedLabelsFlat(labels, userOrder).flatMap((label) => {
      const children = directTaskNodes(label);
      if (!children.length) return [];
      return [makeLabelNode(label, labelPath(label, byId), children)];
    });
  }

  if (labelDisplayMode === "leaf") {
    return orderedLabelsFlat(labels, userOrder).flatMap((label) => {
      if (hasChildLabel.has(label.id)) return [];
      const children = directTaskNodes(label);
      if (!children.length) return [];
      return [makeLabelNode(label, label.name, children)];
    });
  }

  const build = (label: Label, visiting: Set<string>): MindMapTreeNode | null => {
    if (visiting.has(label.id)) return null;
    const nextVisiting = new Set(visiting).add(label.id);
    const childLabels = labels
      .filter((candidate) => candidate.parent_id === label.id)
      .sort((a, b) => compareSiblingLabels(a, b, label.id, userOrder))
      .flatMap((candidate) => {
        const child = build(candidate, nextVisiting);
        return child ? [child] : [];
      });
    const directTasks = directTaskNodes(label);
    if (!childLabels.length && !directTasks.length) return null;
    return makeLabelNode(label, label.name, [...childLabels, ...directTasks]);
  };

  return labels
    .filter((label) => label.parent_id === null || !labelIds.has(label.parent_id))
    .sort((a, b) => compareSiblingLabels(a, b, null, userOrder))
    .flatMap((label) => {
      const node = build(label, new Set());
      return node ? [node] : [];
    });
}

function unlabeledTasksForBranch({
  tasks,
  labels,
  labelDisplayMode,
}: {
  tasks: Task[];
  labels: Label[];
  labelDisplayMode: MindMapLabelDisplayMode;
}) {
  const labelIds = new Set(labels.map((label) => label.id));
  if (labelDisplayMode === "hidden") {
    return tasks.filter((task) => (
      task.label_ids.length === 0 || taskHasVisibleLabel(task, labelIds)
    ));
  }
  if (labelDisplayMode === "leaf") {
    const hasChildLabel = new Set(
      labels
        .filter((label) => label.parent_id !== null && labelIds.has(label.parent_id))
        .map((label) => label.parent_id as string),
    );
    return tasks.filter((task) => {
      if (task.label_ids.length === 0) return true;
      const visibleIds = task.label_ids.filter((labelId) => labelIds.has(labelId));
      if (!visibleIds.length) return false;
      // Intermediate-label-only tasks fall into the unlabeled bucket.
      return visibleIds.every((labelId) => hasChildLabel.has(labelId));
    });
  }
  return tasks.filter((task) => task.label_ids.length === 0);
}

function taskBranchChildren({
  tasks,
  labels,
  contextKey,
  preferences,
  dateKey,
  dateEndKey,
  scheduleLevel,
  labelDisplayMode,
  userOrder,
}: {
  tasks: Task[];
  labels: Label[];
  contextKey: string;
  preferences: DateTimePreferences;
  dateKey?: string;
  dateEndKey?: string;
  scheduleLevel?: MindMapScheduleLevel;
  labelDisplayMode: MindMapLabelDisplayMode;
  userOrder?: Map<string, number>;
}) {
  return [
    ...labelTreeNodes({
      tasks,
      labels,
      contextKey,
      preferences,
      dateKey,
      dateEndKey,
      scheduleLevel,
      labelDisplayMode,
      userOrder,
    }),
    ...unlabeledTasksForBranch({ tasks, labels, labelDisplayMode })
      .sort(compareTasks)
      .map((task) => taskNode(task, contextKey, preferences)),
  ];
}

/** Cross-month weeks belong only to the earlier month (week start). */
function weekOwnerMonthKey(week: Pick<ReturnType<typeof weekBounds>, "startKey">) {
  return week.startKey.slice(0, 7);
}

function ensureWeek(
  months: Map<string, Map<string, WeekBucket>>,
  monthKey: string,
  week: ReturnType<typeof weekBounds>,
) {
  const weeks = months.get(monthKey) ?? new Map<string, WeekBucket>();
  const current = weeks.get(week.startKey) ?? {
    label: week.label,
    endKey: week.endKey,
    days: [],
  };
  weeks.set(week.startKey, current);
  months.set(monthKey, weeks);
}

export function buildMindMapTree({
  tasks,
  labels,
  preferences,
  focusDateKey,
  labelDisplayMode = DEFAULT_MIND_MAP_LABEL_DISPLAY_MODE,
  userLabelOrder,
}: {
  tasks: Task[];
  labels: Label[];
  preferences: DateTimePreferences;
  focusDateKey?: string | null;
  labelDisplayMode?: MindMapLabelDisplayMode;
  userLabelOrder?: Iterable<Pick<UserLabelOrder, "label_id" | "position">>;
}): MindMapTreeNode {
  const userOrder = userLabelOrderMap(userLabelOrder);
  const visibleTasks = tasks.filter((task) => !task.deleted_at);
  const dayTasks = new Map<string, Task[]>();
  const weekTasks = new Map<string, Task[]>();
  const monthTasks = new Map<string, Task[]>();
  const inbox: Task[] = [];
  const unscheduled: Task[] = [];

  visibleTasks.forEach((task) => {
    const schedule = classifyTaskSchedule(task, preferences);
    if (schedule.level === "none") {
      if (task.label_ids.length === 0) inbox.push(task);
      else unscheduled.push(task);
      return;
    }
    if (schedule.level === "month") {
      const monthKey = schedule.startKey.slice(0, 7);
      monthTasks.set(monthKey, [...(monthTasks.get(monthKey) ?? []), task]);
      return;
    }
    if (schedule.level === "week") {
      weekTasks.set(schedule.startKey, [...(weekTasks.get(schedule.startKey) ?? []), task]);
      return;
    }
    dayTasks.set(schedule.dateKey, [...(dayTasks.get(schedule.dateKey) ?? []), task]);
  });

  if (focusDateKey && !dayTasks.has(focusDateKey)) dayTasks.set(focusDateKey, []);

  const months = new Map<string, Map<string, WeekBucket>>();
  [...dayTasks.keys()].sort().forEach((dateKey) => {
    const date = dateFromKey(dateKey);
    const week = weekBounds(date, preferences.weekStartsOn);
    const monthKey = weekOwnerMonthKey(week);
    ensureWeek(months, monthKey, week);
    const bucket = months.get(monthKey)!.get(week.startKey)!;
    bucket.days.push(dateKey);
  });

  [...weekTasks.keys()].sort().forEach((weekKey) => {
    const week = weekBounds(dateFromKey(weekKey), preferences.weekStartsOn);
    ensureWeek(months, weekOwnerMonthKey(week), week);
  });

  [...monthTasks.keys()].sort().forEach((monthKey) => {
    if (!months.has(monthKey)) months.set(monthKey, new Map());
  });

  const monthNodes: MindMapTreeNode[] = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, weeks]) => {
      const month = monthBounds(monthKey);
      const monthContext = `month:${monthKey}`;
      return {
        id: monthContext,
        kind: "month" as const,
        label: monthKey,
        dateKey: month.startKey,
        dateEndKey: month.endKey,
        scheduleLevel: "month" as const,
        contextKey: monthContext,
        children: [
          ...taskBranchChildren({
            tasks: monthTasks.get(monthKey) ?? [],
            labels,
            contextKey: monthContext,
            preferences,
            dateKey: month.startKey,
            dateEndKey: month.endKey,
            scheduleLevel: "month",
            labelDisplayMode,
            userOrder,
          }),
          ...[...weeks.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([weekKey, week]) => {
              const weekContext = `week:${monthKey}:${weekKey}`;
              return {
                id: weekContext,
                kind: "week" as const,
                label: week.label,
                dateKey: weekKey,
                dateEndKey: week.endKey,
                scheduleLevel: "week" as const,
                contextKey: weekContext,
                children: [
                  ...taskBranchChildren({
                    tasks: weekTasks.get(weekKey) ?? [],
                    labels,
                    contextKey: weekContext,
                    preferences,
                    dateKey: weekKey,
                    dateEndKey: week.endKey,
                    scheduleLevel: "week",
                    labelDisplayMode,
                    userOrder,
                  }),
                  ...week.days.sort().map((dateKey) => {
                    const day = dateFromKey(dateKey);
                    return {
                      id: `day:${dateKey}`,
                      kind: "day" as const,
                      label: format(day, "M月d日 EEE", { locale: zhCN }),
                      dateKey,
                      scheduleLevel: "day" as const,
                      contextKey: dateKey,
                      children: taskBranchChildren({
                        tasks: dayTasks.get(dateKey) ?? [],
                        labels,
                        contextKey: dateKey,
                        preferences,
                        dateKey,
                        scheduleLevel: "day",
                        labelDisplayMode,
                        userOrder,
                      }),
                    };
                  }),
                ],
              };
            }),
        ],
      };
    });

  return {
    id: "root",
    kind: "root",
    label: "任务清单",
    children: [
      ...monthNodes,
      {
        id: "inbox",
        kind: "inbox",
        label: "收集箱",
        contextKey: "inbox",
        children: inbox.sort(compareTasks).map((task) => (
          taskNode(task, "inbox", preferences)
        )),
      },
      {
        id: "unscheduled",
        kind: "unscheduled",
        label: "未排期",
        contextKey: "unscheduled",
        children: taskBranchChildren({
          tasks: unscheduled,
          labels,
          contextKey: "unscheduled",
          preferences,
          labelDisplayMode,
          userOrder,
        }),
      },
    ],
  };
}

function shiftZonedCalendarDays(value: string, timeZone: string | null, days: number) {
  const original = zonedDate(value, timeZone);
  const shiftedDateKey = format(addDays(dateFromKey(toDateInput(original, timeZone)), days), "yyyy-MM-dd");
  const shifted = fromZonedDateTime(shiftedDateKey, toTimeInput(original, timeZone), timeZone);
  shifted.setSeconds(original.getSeconds(), original.getMilliseconds());
  return shifted.toISOString();
}

function allDayRangePatch(
  startDateKey: string,
  endDateKey: string,
  timeZone: string | null,
): MindMapDuePatch {
  const start = fromZonedDateTime(startDateKey, "00:00", timeZone);
  const end = fromZonedDateTime(endDateKey, "23:59", timeZone);
  end.setSeconds(59, 999);
  return {
    due_at: end.toISOString(),
    due_start_at: start.toISOString(),
    due_is_all_day: true,
    due_timezone: timeZone,
  };
}

export type MindMapDuePatch = Pick<
  Task,
  "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone"
>;

export function moveTaskToDate(task: Task, targetDateKey: string | null): MindMapDuePatch {
  if (!targetDateKey) {
    return {
      due_at: null,
      due_start_at: null,
      due_is_all_day: false,
      due_timezone: null,
    };
  }

  if (!task.due_at) {
    return allDayRangePatch(targetDateKey, targetDateKey, task.due_timezone);
  }

  const currentDateKey = toDateInput(task.due_at, task.due_timezone);
  const calendarDayDelta = Math.round(
    (dateFromKey(targetDateKey).getTime() - dateFromKey(currentDateKey).getTime()) / 86_400_000,
  );
  return {
    due_at: shiftZonedCalendarDays(task.due_at, task.due_timezone, calendarDayDelta),
    due_start_at: task.due_start_at
      ? shiftZonedCalendarDays(task.due_start_at, task.due_timezone, calendarDayDelta)
      : null,
    due_is_all_day: task.due_is_all_day,
    due_timezone: task.due_timezone,
  };
}

function isMultiDayAllDaySpan(task: Task) {
  if (!task.due_is_all_day || !task.due_at || !task.due_start_at) return false;
  return toDateInput(task.due_start_at, task.due_timezone)
    !== toDateInput(task.due_at, task.due_timezone);
}

export function moveTaskToSchedule(
  task: Task,
  target: MindMapScheduleTarget,
): MindMapDuePatch {
  if (target.level === "none") return moveTaskToDate(task, null);
  if (target.level === "day") {
    // Week/month all-day spans must collapse onto the day. Shifting by due_at
    // delta would keep the range when dropping onto the span's end date.
    if (isMultiDayAllDaySpan(task)) {
      return allDayRangePatch(target.dateKey, target.dateKey, task.due_timezone);
    }
    return moveTaskToDate(task, target.dateKey);
  }
  return allDayRangePatch(target.startKey, target.endKey, task.due_timezone);
}
