import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import type { Label, Task, WorkspaceBundle } from "../types";
import { fromZonedDateTime, toDateInput } from "./dateTimePreferences";
import { compareSiblingLabels, userLabelOrderMap } from "./labels";
import { currentTaskPermissionLevel } from "./permissions";

export type ScheduleTaskGroup = {
  id: "inbox" | string;
  label: Label | null;
  depth: number;
  tasks: Task[];
};

export function isSchedulableTask(
  bundle: WorkspaceBundle,
  task: Task,
  currentUserId: string,
) {
  return canRescheduleTask(bundle, task, currentUserId)
    && !task.due_at;
}

export function canRescheduleTask(
  bundle: WorkspaceBundle,
  task: Task,
  currentUserId: string,
) {
  return task.kind === "todo"
    && task.status === "open"
    && !task.deleted_at
    && currentTaskPermissionLevel(bundle, task, currentUserId) >= 2;
}

function orderedLabels(
  labels: Label[],
  userLabelOrder: WorkspaceBundle["userLabelOrder"],
) {
  const result: Array<{ label: Label; depth: number }> = [];
  const visited = new Set<string>();
  const labelIds = new Set(labels.map((label) => label.id));
  const byParent = new Map<string | null, Label[]>();
  const orderMap = userLabelOrderMap(userLabelOrder);

  for (const label of labels) {
    const parentId = label.parent_id && labelIds.has(label.parent_id)
      ? label.parent_id
      : null;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(label);
    byParent.set(parentId, siblings);
  }
  for (const [parentId, siblings] of byParent.entries()) {
    siblings.sort((a, b) => compareSiblingLabels(a, b, parentId, orderMap));
  }

  const visit = (parentId: string | null, depth: number) => {
    for (const label of byParent.get(parentId) ?? []) {
      if (visited.has(label.id)) continue;
      visited.add(label.id);
      result.push({ label, depth });
      visit(label.id, depth + 1);
    }
  };
  visit(null, 0);
  for (const label of labels) {
    if (!visited.has(label.id)) result.push({ label, depth: 0 });
  }
  return result;
}

export function buildScheduleTaskGroups(
  bundle: WorkspaceBundle,
  currentUserId: string,
  excludedTaskIds: ReadonlySet<string> = new Set(),
): ScheduleTaskGroup[] {
  const tasks = bundle.tasks.filter((task) =>
    !excludedTaskIds.has(task.id) && isSchedulableTask(bundle, task, currentUserId));
  const groups: ScheduleTaskGroup[] = [];
  const inboxTasks = tasks.filter((task) => task.label_ids.length === 0);
  if (inboxTasks.length > 0) {
    groups.push({ id: "inbox", label: null, depth: 0, tasks: inboxTasks });
  }
  for (const { label, depth } of orderedLabels(bundle.labels, bundle.userLabelOrder)) {
    const labelTasks = tasks.filter((task) => task.label_ids.includes(label.id));
    if (labelTasks.length > 0) groups.push({ id: label.id, label, depth, tasks: labelTasks });
  }
  return groups;
}

export function schedulePatchFromDrop(
  date: Date,
  allDay: boolean,
  timeZone: string | null,
): Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone"> {
  if (!allDay) {
    return {
      due_at: date.toISOString(),
      due_start_at: null,
      due_is_all_day: false,
      due_timezone: timeZone,
    };
  }

  const dateValue = timeZone ? toDateInput(date, timeZone) : format(date, "yyyy-MM-dd");
  const start = fromZonedDateTime(dateValue, "00:00", timeZone);
  const end = fromZonedDateTime(dateValue, "23:59", timeZone);
  end.setSeconds(59, 999);
  return {
    due_at: new Date(end.getTime()).toISOString(),
    due_start_at: new Date(start.getTime()).toISOString(),
    due_is_all_day: true,
    due_timezone: timeZone,
  };
}

export function schedulePatchForCalendarMove(
  task: Task,
  date: Date,
  allDay: boolean,
  timeZone: string | null,
): Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone"> {
  if (!task.due_start_at || task.due_is_all_day !== allDay) {
    return schedulePatchFromDrop(date, allDay, timeZone);
  }

  if (!allDay) {
    const duration = Math.max(
      0,
      new Date(task.due_at!).getTime() - new Date(task.due_start_at).getTime(),
    );
    return {
      due_start_at: date.toISOString(),
      due_at: new Date(date.getTime() + duration).toISOString(),
      due_is_all_day: false,
      due_timezone: timeZone,
    };
  }

  const originalStartDate = toDateInput(task.due_start_at, task.due_timezone);
  const originalEndDate = toDateInput(task.due_at!, task.due_timezone);
  const calendarDaySpan = Math.max(
    0,
    differenceInCalendarDays(parseISO(originalEndDate), parseISO(originalStartDate)),
  );
  const targetStartDate = timeZone ? toDateInput(date, timeZone) : format(date, "yyyy-MM-dd");
  const targetEndDate = format(addDays(parseISO(targetStartDate), calendarDaySpan), "yyyy-MM-dd");
  const start = fromZonedDateTime(targetStartDate, "00:00", timeZone);
  const end = fromZonedDateTime(targetEndDate, "23:59", timeZone);
  end.setSeconds(59, 999);
  return {
    due_start_at: new Date(start.getTime()).toISOString(),
    due_at: new Date(end.getTime()).toISOString(),
    due_is_all_day: true,
    due_timezone: timeZone,
  };
}

export function clearSchedulePatch(): Pick<
  Task,
  "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone"
> {
  return {
    due_at: null,
    due_start_at: null,
    due_is_all_day: false,
    due_timezone: null,
  };
}
