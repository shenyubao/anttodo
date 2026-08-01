import {
  addDays,
  endOfWeek,
  format,
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
import type { DateTimePreferences, Label, Task } from "../types";

export type MindMapNodeKind =
  | "root"
  | "month"
  | "week"
  | "day"
  | "inbox"
  | "unscheduled"
  | "label"
  | "task";

export type MindMapTreeNode = {
  id: string;
  kind: MindMapNodeKind;
  label: string;
  dateKey?: string;
  contextKey?: string;
  labelId?: string;
  labelColor?: string;
  task?: Task;
  children: MindMapTreeNode[];
};

function dateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function taskDateKey(task: Task) {
  return task.due_at ? toDateInput(task.due_at, task.due_timezone) : null;
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
  labelId?: string,
): MindMapTreeNode {
  return {
    id: `task:${contextKey}:${labelId ?? "none"}:${task.id}`,
    kind: "task",
    label: task.title,
    dateKey: taskDateKey(task) ?? undefined,
    contextKey,
    labelId,
    task,
    children: [],
  };
}

function labelTreeNodes({
  tasks,
  labels,
  contextKey,
  dateKey,
}: {
  tasks: Task[];
  labels: Label[];
  contextKey: string;
  dateKey?: string;
}) {
  const labelIds = new Set(labels.map((label) => label.id));
  const tasksByLabel = new Map<string, Task[]>();
  tasks.forEach((task) => {
    task.label_ids.forEach((labelId) => {
      if (!labelIds.has(labelId)) return;
      tasksByLabel.set(labelId, [...(tasksByLabel.get(labelId) ?? []), task]);
    });
  });

  const build = (label: Label, visiting: Set<string>): MindMapTreeNode | null => {
    if (visiting.has(label.id)) return null;
    const nextVisiting = new Set(visiting).add(label.id);
    const childLabels = labels
      .filter((candidate) => candidate.parent_id === label.id)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .flatMap((candidate) => {
        const child = build(candidate, nextVisiting);
        return child ? [child] : [];
      });
    const directTasks = [...(tasksByLabel.get(label.id) ?? [])]
      .sort(compareTasks)
      .map((task) => taskNode(task, contextKey, label.id));
    if (!childLabels.length && !directTasks.length) return null;
    return {
      id: `label:${contextKey}:${label.id}`,
      kind: "label",
      label: label.name,
      dateKey,
      contextKey,
      labelId: label.id,
      labelColor: label.color,
      children: [...childLabels, ...directTasks],
    };
  };

  return labels
    .filter((label) => label.parent_id === null || !labelIds.has(label.parent_id))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .flatMap((label) => {
      const node = build(label, new Set());
      return node ? [node] : [];
    });
}

export function buildMindMapTree({
  tasks,
  labels,
  preferences,
  focusDateKey,
}: {
  tasks: Task[];
  labels: Label[];
  preferences: DateTimePreferences;
  focusDateKey?: string | null;
}): MindMapTreeNode {
  const visibleTasks = tasks.filter((task) => !task.deleted_at);
  const scheduled = new Map<string, Task[]>();
  const inbox: Task[] = [];
  const unscheduled: Task[] = [];

  visibleTasks.forEach((task) => {
    const dateKey = taskDateKey(task);
    if (!dateKey) {
      if (task.label_ids.length === 0) inbox.push(task);
      else unscheduled.push(task);
      return;
    }
    scheduled.set(dateKey, [...(scheduled.get(dateKey) ?? []), task]);
  });

  if (focusDateKey && !scheduled.has(focusDateKey)) scheduled.set(focusDateKey, []);

  const months = new Map<string, Map<string, { label: string; days: string[] }>>();
  [...scheduled.keys()].sort().forEach((dateKey) => {
    const date = dateFromKey(dateKey);
    const monthKey = dateKey.slice(0, 7);
    const weekStart = startOfWeek(date, {
      weekStartsOn: preferences.weekStartsOn as Day,
    });
    const weekEnd = endOfWeek(date, {
      weekStartsOn: preferences.weekStartsOn as Day,
    });
    const weekKey = format(weekStart, "yyyy-MM-dd");
    const weeks = months.get(monthKey) ?? new Map();
    const week = weeks.get(weekKey) ?? {
      label: `第${preferenceWeekNumber(date, preferences.weekStartsOn)}周 · ${format(weekStart, "M/d")}–${format(weekEnd, "M/d")}`,
      days: [],
    };
    week.days.push(dateKey);
    weeks.set(weekKey, week);
    months.set(monthKey, weeks);
  });

  const monthNodes: MindMapTreeNode[] = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, weeks]) => ({
      id: `month:${monthKey}`,
      kind: "month",
      label: monthKey,
      children: [...weeks.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([weekKey, week]) => ({
          id: `week:${monthKey}:${weekKey}`,
          kind: "week",
          label: week.label,
          children: week.days.sort().map((dateKey) => {
            const day = dateFromKey(dateKey);
            return {
              id: `day:${dateKey}`,
              kind: "day" as const,
              label: format(day, "M月d日 EEE", { locale: zhCN }),
              dateKey,
              contextKey: dateKey,
              children: [
                ...labelTreeNodes({
                  tasks: scheduled.get(dateKey) ?? [],
                  labels,
                  contextKey: dateKey,
                  dateKey,
                }),
                ...(scheduled.get(dateKey) ?? [])
                  .filter((task) => task.label_ids.length === 0)
                  .sort(compareTasks)
                  .map((task) => taskNode(task, dateKey)),
              ],
            };
          }),
        })),
    }));

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
        children: inbox.sort(compareTasks).map((task) => taskNode(task, "inbox")),
      },
      {
        id: "unscheduled",
        kind: "unscheduled",
        label: "未排期",
        contextKey: "unscheduled",
        children: labelTreeNodes({
          tasks: unscheduled,
          labels,
          contextKey: "unscheduled",
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
    const start = fromZonedDateTime(targetDateKey, "00:00", task.due_timezone);
    const end = fromZonedDateTime(targetDateKey, "23:59", task.due_timezone);
    end.setSeconds(59, 999);
    return {
      due_at: end.toISOString(),
      due_start_at: start.toISOString(),
      due_is_all_day: true,
      due_timezone: task.due_timezone,
    };
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
