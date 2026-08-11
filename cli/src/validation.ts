import { CliError } from "./errors.js";
import type {
  LabelAccessScope,
  LabelKind,
  RecurrenceRule,
  ReminderRule,
  TaskPriority,
  TaskStatus,
} from "./types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/;

export function assertUuid(value: string, name: string) {
  if (!UUID_PATTERN.test(value)) {
    throw new CliError({
      type: "validation",
      code: "invalid_uuid",
      message: `${name} must be a UUID`,
      details: { name, value },
    });
  }
  return value;
}

export function parseDueTime(value: string | undefined, clear: boolean | undefined) {
  if (clear) return null;
  const match = value?.match(RFC3339_PATTERN);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const hour = Number(match?.[4]);
  const minute = Number(match?.[5]);
  const second = Number(match?.[6]);
  const offsetHour = Number(match?.[8] ?? 0);
  const offsetMinute = Number(match?.[9] ?? 0);
  const calendarProbe = new Date(Date.UTC(year, month - 1, day));
  const validCalendarDate = calendarProbe.getUTCFullYear() === year
    && calendarProbe.getUTCMonth() === month - 1
    && calendarProbe.getUTCDate() === day;
  if (!value || !match || !validCalendarDate || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59 || Number.isNaN(Date.parse(value))) {
    throw new CliError({
      type: "validation",
      code: "invalid_due_time",
      message: "Due time must be RFC3339 with an explicit timezone",
      hint: "Example: 2026-08-04T09:30:00+08:00, or pass --clear",
    });
  }
  return new Date(value).toISOString();
}

export function parseFocusSessionInterval(startedAt: string, endedAt: string) {
  const started = parseDueTime(startedAt, false)!;
  const ended = parseDueTime(endedAt, false)!;
  const elapsedSeconds = Math.floor((Date.parse(ended) - Date.parse(started)) / 1000);
  if (elapsedSeconds <= 0) {
    throw new CliError({
      type: "validation",
      code: "invalid_focus_session_interval",
      message: "Focus session ended_at must be later than started_at",
    });
  }
  if (elapsedSeconds < 60) {
    throw new CliError({
      type: "validation",
      code: "focus_session_too_short",
      message: "Focus session must last at least 60 seconds",
    });
  }
  return { startedAt: started, endedAt: ended, elapsedSeconds };
}

export function parsePriority(value: string): TaskPriority {
  if (["none", "low", "medium", "high"].includes(value)) return value as TaskPriority;
  throw new CliError({ type: "validation", code: "invalid_priority", message: `Invalid priority: ${value}` });
}

export function parseStatus(value: string): TaskStatus | "all" {
  if (["open", "completed", "cancelled", "all"].includes(value)) return value as TaskStatus | "all";
  throw new CliError({ type: "validation", code: "invalid_status", message: `Invalid status: ${value}` });
}

export function parseLabelKind(value: string): LabelKind {
  if (value === "private" || value === "team") return value;
  throw new CliError({ type: "validation", code: "invalid_label_kind", message: `Invalid tag kind: ${value}` });
}

export function parseAccessScope(value: string): LabelAccessScope {
  if (["inherit", "all", "users", "groups"].includes(value)) return value as LabelAccessScope;
  throw new CliError({ type: "validation", code: "invalid_access_scope", message: `Invalid access scope: ${value}` });
}

export function parseExplicitAccessScope(value: string): Exclude<LabelAccessScope, "inherit"> {
  const scope = parseAccessScope(value);
  if (scope === "inherit") {
    throw new CliError({
      type: "validation",
      code: "invalid_access_scope",
      message: "Root tag access scope must be all, users, or groups",
    });
  }
  return scope;
}

export function positiveInteger(value: string, name: string, maximum = 1000, minimum = 0) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new CliError({
      type: "validation",
      code: "invalid_integer",
      message: `${name} must be an integer between ${minimum} and ${maximum}`,
    });
  }
  return parsed;
}

export function nonEmpty(value: string, name: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new CliError({
      type: "validation",
      code: "empty_value",
      message: `${name} must not be empty`,
    });
  }
  return normalized;
}

export function validateTimeZone(value: string | undefined) {
  const timeZone = value ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
  } catch {
    throw new CliError({ type: "validation", code: "invalid_timezone", message: `Invalid IANA timezone: ${timeZone}` });
  }
  return timeZone;
}

export function parseReminder(value: string): ReminderRule {
  const match = value.trim().match(/^(start|end):(\d+):(minute|hour|day|week)(?:@([01]\d|2[0-3]):([0-5]\d))?$/);
  if (!match) {
    throw new CliError({
      type: "validation",
      code: "invalid_reminder",
      message: `Invalid reminder rule: ${value}`,
      hint: "Use start:15:minute, end:1:day, or start:1:day@09:00",
    });
  }
  const offset = Number(match[2]);
  if (offset > 525600) throw new CliError({ type: "validation", code: "invalid_reminder", message: "Reminder offset is too large" });
  return {
    anchor: match[1] as ReminderRule["anchor"],
    offset_value: offset,
    offset_unit: match[3] as ReminderRule["offset_unit"],
    local_time: match[4] ? `${match[4]}:${match[5]}` : null,
  };
}

export function parseRecurrence(value: string | undefined): RecurrenceRule | null {
  if (!value || value === "none") return null;
  if (!["daily", "weekdays", "weekly", "monthly", "yearly"].includes(value)) {
    throw new CliError({ type: "validation", code: "invalid_recurrence", message: `Invalid recurrence: ${value}` });
  }
  return { freq: value as RecurrenceRule["freq"], interval: 1, mode: "due" };
}
