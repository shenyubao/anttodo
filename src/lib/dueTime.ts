import { addDays, addMonths, format, isSameDay } from "date-fns";
import { zhCN } from "date-fns/locale";

export type DueFields = {
  due_at: string | null;
  due_start_at: string | null;
  due_is_all_day: boolean;
};

export type DuePreset = "today" | "tomorrow" | "next-week" | "next-month";

export const DEFAULT_RANGE_START_TIME = "00:00";
export const DEFAULT_RANGE_END_TIME = "23:59";

export function createDefaultRangeDraft(dateValue: string) {
  return {
    startDate: dateValue,
    startTime: DEFAULT_RANGE_START_TIME,
    endDate: dateValue,
    endTime: DEFAULT_RANGE_END_TIME,
  };
}

export type DueStatus = {
  label: string;
  overdue: boolean;
};

export function roundUpToHalfHour(value: Date) {
  return new Date(Math.ceil(value.getTime() / 1_800_000) * 1_800_000);
}

export function getPresetDate(preset: DuePreset, now = new Date()) {
  const rounded = roundUpToHalfHour(now);
  if (preset === "tomorrow") return addDays(rounded, 1);
  if (preset === "next-week") return addDays(rounded, 7);
  if (preset === "next-month") return addMonths(rounded, 1);
  return rounded;
}

export function toLocalDateInput(value: Date) {
  return format(value, "yyyy-MM-dd");
}

export function toLocalTimeInput(value: Date) {
  return format(value, "HH:mm");
}

export function fromLocalDateTime(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = timeValue.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

export function createAllDayRange(startDate: string, endDate: string): DueFields {
  const start = fromLocalDateTime(startDate, "00:00");
  const end = fromLocalDateTime(endDate, "00:00");
  end.setHours(23, 59, 59, 999);
  return {
    due_start_at: start.toISOString(),
    due_at: end.toISOString(),
    due_is_all_day: true,
  };
}

export function isValidDueRange(start: Date, end: Date) {
  return !Number.isNaN(start.getTime())
    && !Number.isNaN(end.getTime())
    && start.getTime() <= end.getTime();
}

export function formatDueExact(fields: DueFields) {
  if (!fields.due_at) return "无日期";
  const end = new Date(fields.due_at);
  const start = fields.due_start_at ? new Date(fields.due_start_at) : null;

  if (!start) {
    return format(end, "EEE · M月d日 HH:mm", { locale: zhCN });
  }

  if (fields.due_is_all_day) {
    if (isSameDay(start, end)) return format(end, "M月d日 · 全天", { locale: zhCN });
    return `${format(start, "M月d日", { locale: zhCN })}–${format(end, "M月d日", { locale: zhCN })} · 全天`;
  }

  if (isSameDay(start, end)) {
    return `${format(start, "M月d日 HH:mm", { locale: zhCN })}–${format(end, "HH:mm", { locale: zhCN })}`;
  }
  return `${format(start, "M月d日", { locale: zhCN })}–${format(end, "M月d日", { locale: zhCN })}`;
}

export function getDueStatus(dueAt: string | null, now = new Date()): DueStatus | null {
  if (!dueAt) return null;
  const difference = new Date(dueAt).getTime() - now.getTime();
  if (Number.isNaN(difference)) return null;
  const overdue = difference < 0;
  const absolute = Math.abs(difference);

  let label: string;
  if (absolute < 60_000) label = "<1分钟";
  else if (absolute < 3_600_000) label = `${Math.floor(absolute / 60_000)}分钟`;
  else if (absolute < 86_400_000) label = `${Math.floor(absolute / 3_600_000)}小时`;
  else label = `${Math.floor(absolute / 86_400_000)}天`;

  return {
    label: overdue ? `超期${label}` : label,
    overdue,
  };
}

export const HALF_HOUR_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hours = Math.floor(index / 2);
  const minutes = index % 2 === 0 ? "00" : "30";
  return `${String(hours).padStart(2, "0")}:${minutes}`;
});

export const RANGE_END_TIME_OPTIONS = [
  ...HALF_HOUR_OPTIONS,
  DEFAULT_RANGE_END_TIME,
];
