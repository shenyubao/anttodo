import { addDays, addMonths, addYears, getDaysInMonth } from "date-fns";
import {
  isValidTimeZone,
  toDateInput,
  toTimeInput,
  fromZonedDateTime,
  zonedDate,
} from "./dateTimePreferences";
import type { RecurrenceFreq, Task, TaskRecurrence } from "../types";

export const RECURRENCE_PRESETS: Array<{
  freq: RecurrenceFreq | null;
  label: string;
}> = [
  { freq: null, label: "不重复" },
  { freq: "daily", label: "每天" },
  { freq: "weekdays", label: "工作日" },
  { freq: "weekly", label: "每周" },
  { freq: "monthly", label: "每月" },
  { freq: "yearly", label: "每年" },
];

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

export function recurrenceRule(freq: RecurrenceFreq): TaskRecurrence {
  return { freq, interval: 1, mode: "due" };
}

export function normalizeRecurrence(value: TaskRecurrence | null | undefined) {
  if (!value) return null;
  if (
    !["daily", "weekdays", "weekly", "monthly", "yearly"].includes(value.freq)
    || value.interval !== 1
    || value.mode !== "due"
  ) {
    throw new Error("重复规则无效");
  }
  return recurrenceRule(value.freq);
}

export function recurrenceSummary(
  rule: TaskRecurrence | null | undefined,
  dueAt: string | Date | null | undefined,
  timeZone?: string | null,
) {
  if (!rule) return "重复";
  if (rule.freq === "daily") return "每天";
  if (rule.freq === "weekdays") return "工作日";
  if (!dueAt) {
    if (rule.freq === "weekly") return "每周";
    if (rule.freq === "monthly") return "每月";
    return "每年";
  }
  const zoned = zonedDate(dueAt, timeZone);
  if (rule.freq === "weekly") {
    return `每周${WEEKDAY_NAMES[zoned.getDay()]}`;
  }
  if (rule.freq === "monthly") {
    return `每月${zoned.getDate()}日`;
  }
  return `每年${zoned.getMonth() + 1}月${zoned.getDate()}日`;
}

function advanceLocalDate(
  dueAt: Date,
  timeZone: string | null | undefined,
  advance: (year: number, month: number, day: number) => {
    year: number;
    month: number;
    day: number;
  },
) {
  const zone = timeZone && isValidTimeZone(timeZone) ? timeZone : null;
  const dateValue = toDateInput(dueAt, zone);
  const timeValue = toTimeInput(dueAt, zone);
  const [year, month, day] = dateValue.split("-").map(Number);
  const next = advance(year, month, day);
  const clampedDay = Math.min(next.day, getDaysInMonth(new Date(next.year, next.month - 1, 1)));
  const advanced = fromZonedDateTime(
    `${String(next.year).padStart(4, "0")}-${String(next.month).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`,
    timeValue,
    zone,
  );
  return new Date(advanced.getTime());
}

export function nextRecurrenceInstant(
  dueAt: Date | string,
  rule: TaskRecurrence,
  timeZone?: string | null,
) {
  const due = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  if (Number.isNaN(due.getTime())) {
    throw new Error("到期时间无效");
  }
  const normalized = normalizeRecurrence(rule);
  if (!normalized) {
    throw new Error("重复规则无效");
  }

  if (normalized.freq === "daily") {
    return advanceLocalDate(due, timeZone, (year, month, day) => {
      const next = addDays(new Date(year, month - 1, day), 1);
      return { year: next.getFullYear(), month: next.getMonth() + 1, day: next.getDate() };
    });
  }

  if (normalized.freq === "weekly") {
    return advanceLocalDate(due, timeZone, (year, month, day) => {
      const next = addDays(new Date(year, month - 1, day), 7);
      return { year: next.getFullYear(), month: next.getMonth() + 1, day: next.getDate() };
    });
  }

  if (normalized.freq === "weekdays") {
    let cursor = due;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      cursor = advanceLocalDate(cursor, timeZone, (year, month, day) => {
        const next = addDays(new Date(year, month - 1, day), 1);
        return { year: next.getFullYear(), month: next.getMonth() + 1, day: next.getDate() };
      });
      const weekday = zonedDate(cursor, timeZone).getDay();
      if (weekday >= 1 && weekday <= 5) return cursor;
    }
    throw new Error("无法计算下一工作日");
  }

  if (normalized.freq === "monthly") {
    return advanceLocalDate(due, timeZone, (year, month, day) => {
      const next = addMonths(new Date(year, month - 1, 1), 1);
      return { year: next.getFullYear(), month: next.getMonth() + 1, day };
    });
  }

  return advanceLocalDate(due, timeZone, (year, month, day) => {
    const next = addYears(new Date(year, month - 1, 1), 1);
    return { year: next.getFullYear(), month: next.getMonth() + 1, day };
  });
}

export function nextOccurrenceFields(
  task: Pick<Task, "due_at" | "due_start_at" | "due_timezone" | "recurrence">,
) {
  if (!task.recurrence || !task.due_at) return null;
  const nextDue = nextRecurrenceInstant(task.due_at, task.recurrence, task.due_timezone);
  const deltaMs = nextDue.getTime() - new Date(task.due_at).getTime();
  if (deltaMs <= 0) return null;
  return {
    due_at: nextDue.toISOString(),
    due_start_at: task.due_start_at
      ? new Date(new Date(task.due_start_at).getTime() + deltaMs).toISOString()
      : null,
  };
}
