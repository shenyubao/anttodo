import { describe, expect, it } from "vitest";
import {
  DEFAULT_DATE_TIME_PREFERENCES,
  chineseCalendarDetail,
  formatDueWithPreferences,
  formatPreferenceDate,
  formatPreferenceTime,
  fromZonedDateTime,
  preferenceWeekNumber,
  toDateInput,
  toTimeInput,
  weekdayLabels,
} from "./dateTimePreferences";

describe("date and time preferences", () => {
  const value = new Date("2026-12-31T13:05:00+08:00");

  it("formats all supported date orders", () => {
    expect(formatPreferenceDate(value, {
      ...DEFAULT_DATE_TIME_PREFERENCES,
      dateFormat: "mdy",
    }, "Asia/Shanghai")).toBe("12/31/2026");
    expect(formatPreferenceDate(value, {
      ...DEFAULT_DATE_TIME_PREFERENCES,
      dateFormat: "dmy",
    }, "Asia/Shanghai")).toBe("31/12/2026");
    expect(formatPreferenceDate(value, DEFAULT_DATE_TIME_PREFERENCES, "Asia/Shanghai"))
      .toBe("2026/12/31");
  });

  it("formats 12 and 24 hour time", () => {
    expect(formatPreferenceTime(value, DEFAULT_DATE_TIME_PREFERENCES, "Asia/Shanghai"))
      .toBe("13:05");
    expect(formatPreferenceTime(value, {
      ...DEFAULT_DATE_TIME_PREFERENCES,
      timeFormat: "12h",
    }, "Asia/Shanghai")).toMatch(/下午1:05|1:05\s*PM/i);
  });

  it("rotates weekday labels for all seven start days", () => {
    for (let start = 0; start < 7; start += 1) {
      const labels = weekdayLabels(start as 0 | 1 | 2 | 3 | 4 | 5 | 6);
      expect(labels).toHaveLength(7);
      expect(new Set(labels).size).toBe(7);
    }
    expect(weekdayLabels(1)).toEqual(["一", "二", "三", "四", "五", "六", "日"]);
  });

  it("uses the configured week start at year boundaries", () => {
    expect(preferenceWeekNumber(new Date(2026, 11, 31), 1)).toBe(53);
    expect(preferenceWeekNumber(new Date(2027, 0, 4), 1)).toBe(1);
  });

  it("round-trips wall time through an IANA zone including DST", () => {
    const summer = fromZonedDateTime("2026-07-01", "09:30", "America/New_York");
    const winter = fromZonedDateTime("2026-12-01", "09:30", "America/New_York");
    expect(new Date(summer.getTime()).toISOString()).toBe("2026-07-01T13:30:00.000Z");
    expect(new Date(winter.getTime()).toISOString()).toBe("2026-12-01T14:30:00.000Z");
    expect(toDateInput(summer, "America/New_York")).toBe("2026-07-01");
    expect(toTimeInput(summer, "America/New_York")).toBe("09:30");
    expect(formatDueWithPreferences({
      due_at: summer.toJSON(),
      due_start_at: null,
      due_is_all_day: false,
      due_timezone: "America/New_York",
    }, DEFAULT_DATE_TIME_PREFERENCES)).toContain("09:30");
  });

  it("returns lunar and official adjustment metadata without network access", () => {
    expect(chineseCalendarDetail(new Date(2026, 9, 1)).lunarLabel).toBeTruthy();
  });
});
