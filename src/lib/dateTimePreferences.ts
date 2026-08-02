import { TZDate } from "@date-fns/tz";
import {
  format,
  getWeek,
  isSameDay,
  type Day,
} from "date-fns";
import {
  getDayDetail,
  getLunarDate,
  getSolarTerms,
  isHoliday,
  isWorkday,
} from "chinese-days";
import type {
  DateFormat,
  DateTimePreferences,
  TimeFormat,
} from "../types";

export const DEFAULT_DATE_TIME_PREFERENCES: DateTimePreferences = {
  timeFormat: "24h",
  dateFormat: "ymd",
  weekStartsOn: 1,
  showLunar: false,
  showWeekNumbers: true,
  showHolidayAdjustments: true,
  timeZoneEnabled: false,
};

export const TIME_FORMAT_OPTIONS: Array<{ value: TimeFormat; label: string }> = [
  { value: "12h", label: "12小时制 (1:00 PM)" },
  { value: "24h", label: "24小时制 (13:00)" },
];

export const DATE_FORMAT_OPTIONS: Array<{ value: DateFormat; label: string }> = [
  { value: "mdy", label: "12/31/2026" },
  { value: "dmy", label: "31/12/2026" },
  { value: "ymd", label: "2026/12/31" },
];

export const WEEK_START_OPTIONS: Array<{
  value: DateTimePreferences["weekStartsOn"];
  label: string;
}> = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"].map(
  (label, value) => ({
    label,
    value: value as DateTimePreferences["weekStartsOn"],
  }),
);

export function systemTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function zonedDate(value: Date | string, timeZone?: string | null) {
  const date = typeof value === "string" ? new Date(value) : value;
  return timeZone && isValidTimeZone(timeZone) ? TZDate.tz(timeZone, date) : date;
}

export function fromZonedDateTime(
  dateValue: string,
  timeValue: string,
  timeZone?: string | null,
) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = timeValue.split(":").map(Number);
  if (!timeZone || !isValidTimeZone(timeZone)) {
    return new Date(year, month - 1, day, hours, minutes, 0, 0);
  }
  return TZDate.tz(timeZone, year, month - 1, day, hours, minutes, 0, 0);
}

export function toDateInput(value: Date | string, timeZone?: string | null) {
  return format(zonedDate(value, timeZone), "yyyy-MM-dd");
}

export function toTimeInput(value: Date | string, timeZone?: string | null) {
  return format(zonedDate(value, timeZone), "HH:mm");
}

export function formatPreferenceDate(
  value: Date | string,
  preferences: DateTimePreferences,
  timeZone?: string | null,
) {
  const date = zonedDate(value, timeZone);
  const pattern =
    preferences.dateFormat === "mdy"
      ? "MM/dd/yyyy"
      : preferences.dateFormat === "dmy"
        ? "dd/MM/yyyy"
        : "yyyy/MM/dd";
  return format(date, pattern);
}

export function formatPreferenceTime(
  value: Date | string,
  preferences: DateTimePreferences,
  timeZone?: string | null,
) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: preferences.timeFormat === "24h" ? "2-digit" : "numeric",
    minute: "2-digit",
    hour12: preferences.timeFormat === "12h",
    timeZone: timeZone && isValidTimeZone(timeZone) ? timeZone : undefined,
  }).format(typeof value === "string" ? new Date(value) : value);
}

export function formatPreferenceDateTime(
  value: Date | string,
  preferences: DateTimePreferences,
  timeZone?: string | null,
) {
  return `${formatPreferenceDate(value, preferences, timeZone)} ${formatPreferenceTime(
    value,
    preferences,
    timeZone,
  )}`;
}

export function formatDueWithPreferences(
  fields: {
    due_at: string | null;
    due_start_at: string | null;
    due_is_all_day: boolean;
    due_timezone?: string | null;
  },
  preferences: DateTimePreferences,
) {
  if (!fields.due_at) return "无日期";
  const zone = fields.due_timezone;
  const end = zonedDate(fields.due_at, zone);
  const start = fields.due_start_at ? zonedDate(fields.due_start_at, zone) : null;
  const date = (value: Date) => formatPreferenceDate(value, preferences, zone);
  const time = (value: Date) => formatPreferenceTime(value, preferences, zone);

  if (!start) return `${date(end)} · ${time(end)}`;
  if (fields.due_is_all_day) {
    if (isSameDay(start, end)) return `${date(end)} · 全天`;
    return `${date(start)}–${date(end)} · 全天`;
  }
  if (isSameDay(start, end)) {
    return `${date(start)} ${time(start)}–${time(end)}`;
  }
  return `${date(start)}–${date(end)}`;
}

export function weekdayLabels(weekStartsOn: DateTimePreferences["weekStartsOn"]) {
  const labels = ["日", "一", "二", "三", "四", "五", "六"];
  return [...labels.slice(weekStartsOn), ...labels.slice(0, weekStartsOn)];
}

export function preferenceWeekNumber(
  date: Date,
  weekStartsOn: DateTimePreferences["weekStartsOn"],
) {
  return getWeek(date, {
    weekStartsOn: weekStartsOn as Day,
    firstWeekContainsDate: 4,
  });
}

export type ChineseCalendarDetail = {
  lunarLabel: string | null;
  holidayLabel: "休" | "班" | null;
  holidayName: string | null;
};

export function chineseCalendarDetail(date: Date): ChineseCalendarDetail {
  const key = format(date, "yyyy-MM-dd");
  let lunarLabel: string | null = null;
  let holidayLabel: "休" | "班" | null = null;
  let holidayName: string | null = null;
  try {
    const term = getSolarTerms(key)[0];
    const lunar = getLunarDate(key);
    lunarLabel = term?.name ?? (lunar.lunarDay === 1 ? lunar.lunarMonCN : lunar.lunarDayCN);
  } catch {
    lunarLabel = null;
  }
  try {
    const detail = getDayDetail(key);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const ordinaryWeekend = detail.name === "Saturday" || detail.name === "Sunday";
    if (isHoliday(key) && (!weekend || !ordinaryWeekend)) holidayLabel = "休";
    if (isWorkday(key) && weekend) holidayLabel = "班";
    holidayName = holidayLabel ? detail.name || null : null;
  } catch {
    holidayLabel = null;
    holidayName = null;
  }
  return { lunarLabel, holidayLabel, holidayName };
}

export function preferenceRowToModel(row: {
  time_format?: string;
  date_format?: string;
  week_starts_on?: number;
  show_lunar?: boolean;
  show_week_numbers?: boolean;
  show_holiday_adjustments?: boolean;
  time_zone_enabled?: boolean;
} | null): DateTimePreferences {
  if (!row) return DEFAULT_DATE_TIME_PREFERENCES;
  return {
    timeFormat: row.time_format === "12h" ? "12h" : "24h",
    dateFormat:
      row.date_format === "mdy" || row.date_format === "dmy"
        ? row.date_format
        : "ymd",
    weekStartsOn:
      Number.isInteger(row.week_starts_on) &&
      (row.week_starts_on ?? -1) >= 0 &&
      (row.week_starts_on ?? 7) <= 6
        ? row.week_starts_on as DateTimePreferences["weekStartsOn"]
        : 1,
    showLunar: row.show_lunar ?? false,
    showWeekNumbers: row.show_week_numbers ?? true,
    showHolidayAdjustments: row.show_holiday_adjustments ?? true,
    timeZoneEnabled: row.time_zone_enabled ?? false,
  };
}

export function preferenceModelToRow(preferences: DateTimePreferences) {
  return {
    time_format: preferences.timeFormat,
    date_format: preferences.dateFormat,
    week_starts_on: preferences.weekStartsOn,
    show_lunar: preferences.showLunar,
    show_week_numbers: preferences.showWeekNumbers,
    show_holiday_adjustments: preferences.showHolidayAdjustments,
    time_zone_enabled: preferences.timeZoneEnabled,
  };
}
