import { subDays, subMinutes } from "date-fns";
import { fromZonedDateTime, toDateInput } from "./dateTimePreferences";
import type {
  ReminderAnchor,
  ReminderRule,
  ReminderSchedule,
  ReminderUnit,
  Task,
} from "../types";

export const MAX_TASK_REMINDERS = 10;
export const MAX_REMINDER_OFFSET_MINUTES = 365 * 24 * 60;
export const PERSISTENT_REMINDER_INTERVAL_MS = 2 * 60 * 1000;
export const PERSISTENT_REMINDER_DURATION_MS = 30 * 60 * 1000;
export const PERSISTENT_REMINDER_REPEAT_COUNT =
  PERSISTENT_REMINDER_DURATION_MS / PERSISTENT_REMINDER_INTERVAL_MS;

export const TIMED_REMINDER_PRESETS: ReminderRule[] = [
  { anchor: "start", offset_value: 0, offset_unit: "minute", local_time: null },
  { anchor: "start", offset_value: 5, offset_unit: "minute", local_time: null },
  { anchor: "start", offset_value: 30, offset_unit: "minute", local_time: null },
  { anchor: "start", offset_value: 1, offset_unit: "hour", local_time: null },
  { anchor: "start", offset_value: 1, offset_unit: "day", local_time: null },
];

export const ALL_DAY_REMINDER_PRESETS: ReminderRule[] = [
  { anchor: "start", offset_value: 0, offset_unit: "day", local_time: "09:00" },
  { anchor: "start", offset_value: 1, offset_unit: "day", local_time: "09:00" },
  { anchor: "start", offset_value: 2, offset_unit: "day", local_time: "09:00" },
  { anchor: "start", offset_value: 3, offset_unit: "day", local_time: "09:00" },
  { anchor: "start", offset_value: 1, offset_unit: "week", local_time: "09:00" },
];

const UNIT_MINUTES: Record<ReminderUnit, number> = {
  minute: 1,
  hour: 60,
  day: 24 * 60,
  week: 7 * 24 * 60,
};

export function reminderOffsetMinutes(rule: ReminderRule) {
  return rule.offset_value * UNIT_MINUTES[rule.offset_unit];
}

export function reminderRuleKey(rule: ReminderRule) {
  return [rule.anchor, rule.offset_value, rule.offset_unit, rule.local_time ?? ""].join(":");
}

export function normalizeReminderRules(rules: ReminderRule[]) {
  const unique = new Map<string, ReminderRule>();
  for (const rule of rules) {
    if (!Number.isInteger(rule.offset_value) || rule.offset_value < 0) {
      throw new Error("提醒提前量必须是非负整数");
    }
    if (reminderOffsetMinutes(rule) > MAX_REMINDER_OFFSET_MINUTES) {
      throw new Error("提醒最多可提前 365 天");
    }
    if (rule.local_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.local_time)) {
      throw new Error("提醒时间格式无效");
    }
    unique.set(reminderRuleKey(rule), { ...rule });
  }
  const normalized = [...unique.values()];
  if (normalized.length > MAX_TASK_REMINDERS) {
    throw new Error(`每个任务最多设置 ${MAX_TASK_REMINDERS} 个提醒`);
  }
  return normalized;
}

function unitLabel(value: number, unit: ReminderUnit) {
  const labels: Record<ReminderUnit, string> = {
    minute: "分钟",
    hour: "小时",
    day: "天",
    week: "周",
  };
  return `${value}${labels[unit]}`;
}

export function reminderRuleLabel(rule: ReminderRule, allDay: boolean) {
  if (allDay) {
    const time = rule.local_time ?? "09:00";
    if (rule.offset_value === 0) return `当天 (${time})`;
    return `提前${unitLabel(rule.offset_value, rule.offset_unit)} (${time})`;
  }
  if (rule.anchor === "end" && rule.offset_value === 0) return "结束时";
  if (rule.offset_value === 0) return "准时";
  return `提前${unitLabel(rule.offset_value, rule.offset_unit)}`;
}

export function reminderSummary(schedule: ReminderSchedule, allDay: boolean) {
  if (schedule.reminders.length === 0) return "提醒";
  if (schedule.reminders.length === 1) {
    return reminderRuleLabel(schedule.reminders[0]!, allDay);
  }
  return `${schedule.reminders.length} 个提醒`;
}

export function reminderTriggerAt(
  task: Pick<Task, "due_at" | "due_start_at" | "due_timezone">,
  rule: ReminderRule,
) {
  const anchorValue = rule.anchor === "end"
    ? task.due_at
    : task.due_start_at ?? task.due_at;
  if (!anchorValue) return null;
  const anchor = new Date(anchorValue);
  if (Number.isNaN(anchor.getTime())) return null;
  if (rule.local_time) {
    const zone = task.due_timezone ?? "UTC";
    const days = rule.offset_value * (rule.offset_unit === "week" ? 7 : 1);
    const localDate = subDays(new Date(`${toDateInput(anchor, zone)}T12:00:00`), days);
    const zoned = fromZonedDateTime(toDateInput(localDate), rule.local_time, zone);
    return new Date(zoned.getTime()).toISOString();
  }
  return subMinutes(anchor, reminderOffsetMinutes(rule)).toISOString();
}

export function desktopReminderOccurrences(
  reminder: { id: string; trigger_at: string },
  persistent: boolean,
) {
  const first = new Date(reminder.trigger_at).getTime();
  if (!Number.isFinite(first)) return [];
  const count = persistent ? PERSISTENT_REMINDER_REPEAT_COUNT + 1 : 1;
  return Array.from({ length: count }, (_, index) => ({
    id: `${reminder.id}:${index}`,
    reminderId: reminder.id,
    repeatIndex: index,
    triggerAt: new Date(first + index * PERSISTENT_REMINDER_INTERVAL_MS).toISOString(),
  }));
}

export function endReminderRule(anchor: ReminderAnchor = "end"): ReminderRule {
  return { anchor, offset_value: 0, offset_unit: "minute", local_time: null };
}
