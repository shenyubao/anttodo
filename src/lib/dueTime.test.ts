import { describe, expect, it } from "vitest";
import {
  createAllDayRange,
  formatDueExact,
  fromLocalDateTime,
  getDueStatus,
  getPresetDate,
  isValidDueRange,
  roundUpToHalfHour,
  toLocalDateInput,
  toLocalTimeInput,
} from "./dueTime";

describe("due time helpers", () => {
  it("rounds up to the current 30 minute bucket", () => {
    expect(toLocalTimeInput(roundUpToHalfHour(new Date(2026, 6, 25, 14, 0, 30)))).toBe("14:30");
    expect(toLocalTimeInput(roundUpToHalfHour(new Date(2026, 6, 25, 14, 30, 0)))).toBe("14:30");
    expect(toLocalTimeInput(roundUpToHalfHour(new Date(2026, 6, 25, 14, 31, 0)))).toBe("15:00");
  });

  it("applies calendar presets across month and year boundaries", () => {
    const januaryEnd = new Date(2027, 0, 31, 9, 12);
    expect(toLocalDateInput(getPresetDate("next-month", januaryEnd))).toBe("2027-02-28");
    expect(toLocalDateInput(getPresetDate("next-week", new Date(2026, 11, 28, 9, 12)))).toBe("2027-01-04");
  });

  it("formats remaining and overdue time at every boundary", () => {
    const now = new Date("2026-07-25T06:00:00.000Z");
    expect(getDueStatus("2026-07-27T06:30:00.000Z", now)).toEqual({ label: "2天", overdue: false });
    expect(getDueStatus("2026-07-25T08:30:00.000Z", now)).toEqual({ label: "2小时", overdue: false });
    expect(getDueStatus("2026-07-25T06:42:00.000Z", now)).toEqual({ label: "42分钟", overdue: false });
    expect(getDueStatus("2026-07-25T06:00:30.000Z", now)).toEqual({ label: "<1分钟", overdue: false });
    expect(getDueStatus("2026-07-24T05:00:00.000Z", now)).toEqual({ label: "超期1天", overdue: true });
  });

  it("creates local all-day boundaries", () => {
    const range = createAllDayRange("2026-07-20", "2026-07-21");
    const start = new Date(range.due_start_at!);
    const end = new Date(range.due_at!);
    expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0]);
    expect([end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds()]).toEqual([23, 59, 59, 999]);
    expect(range.due_is_all_day).toBe(true);
  });

  it("validates ranges and formats point and range labels", () => {
    const start = fromLocalDateTime("2026-07-20", "14:30");
    const end = fromLocalDateTime("2026-07-20", "15:30");
    const multiDayEnd = fromLocalDateTime("2026-08-27", "10:30");
    expect(isValidDueRange(start, end)).toBe(true);
    expect(isValidDueRange(end, start)).toBe(false);
    expect(formatDueExact({
      due_start_at: start.toISOString(),
      due_at: end.toISOString(),
      due_is_all_day: false,
    })).toContain("14:30–15:30");
    expect(formatDueExact({
      due_start_at: start.toISOString(),
      due_at: multiDayEnd.toISOString(),
      due_is_all_day: false,
    })).toBe("7月20日–8月27日");
    expect(formatDueExact({
      due_start_at: null,
      due_at: end.toISOString(),
      due_is_all_day: false,
    })).toContain("15:30");
  });
});
