import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

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
