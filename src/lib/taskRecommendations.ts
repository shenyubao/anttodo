import { addDays, startOfDay } from "date-fns";
import type { DateTimePreferences, Task } from "../types";

export function recommendedTasks(tasks: Task[], currentUserId: string) {
  return tasks.filter((task) =>
    task.kind === "todo"
    && task.status === "open"
    && !task.deleted_at
    && task.assignee_id === currentUserId
    && !task.due_at,
  );
}

export function recommendationFridayAtSixPm(
  now = new Date(),
  weekStartsOn: DateTimePreferences["weekStartsOn"] = 1,
) {
  const today = startOfDay(now);
  const weekStartOffset = (today.getDay() - weekStartsOn + 7) % 7;
  const fridayOffset = (5 - weekStartsOn + 7) % 7;
  const friday = addDays(today, fridayOffset - weekStartOffset);
  friday.setHours(18, 0, 0, 0);
  return friday;
}

export function recommendationDuePatch(
  now: Date,
  weekStartsOn: DateTimePreferences["weekStartsOn"],
  timeZone: string,
): Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone"> {
  return {
    due_at: recommendationFridayAtSixPm(now, weekStartsOn).toISOString(),
    due_start_at: null,
    due_is_all_day: false,
    due_timezone: timeZone,
  };
}
