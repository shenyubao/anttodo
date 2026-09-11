import { describe, expect, it } from "vitest";
import {
  assertWeeklyReportCanPublish,
  canCreateWeeklyReportForWeek,
  nonEmpty,
  parseDueTime,
  parseFocusSessionInterval,
  parseRecurrence,
  parseReminder,
  parseWeekStart,
  parseWeeklyReportStatus,
  parseWeeklyReportVisibility,
  positiveInteger,
  shiftWeeklyReportWeek,
  weeklyReportWeekStart,
} from "./validation.js";

describe("CLI validation", () => {
  it("requires an explicit RFC3339 timezone", () => {
    expect(parseDueTime("2026-08-04T09:30:00+08:00", false)).toBe("2026-08-04T01:30:00.000Z");
    expect(() => parseDueTime("2026-08-04T09:30:00", false)).toThrow(/RFC3339/);
    expect(() => parseDueTime("2026-08-04T09:30+08:00", false)).toThrow(/RFC3339/);
    expect(() => parseDueTime("2026-02-30T09:30:00+08:00", false)).toThrow(/RFC3339/);
    expect(parseDueTime(undefined, true)).toBeNull();
  });

  it("bounds pagination integers", () => {
    expect(positiveInteger("100", "limit")).toBe(100);
    expect(() => positiveInteger("-1", "limit")).toThrow(/between/);
    expect(() => positiveInteger("0", "limit", 1000, 1)).toThrow(/between/);
    expect(nonEmpty("  task  ", "title")).toBe("task");
    expect(() => nonEmpty("  ", "title")).toThrow(/empty/);
  });

  it("parses reminder and recurrence rules", () => {
    expect(parseReminder("start:15:minute")).toEqual({ anchor: "start", offset_value: 15, offset_unit: "minute", local_time: null });
    expect(parseReminder("end:1:day@09:30")).toEqual({ anchor: "end", offset_value: 1, offset_unit: "day", local_time: "09:30" });
    expect(parseRecurrence("weekly")).toEqual({ freq: "weekly", interval: 1, mode: "due" });
    expect(parseRecurrence("none")).toBeNull();
    expect(() => parseReminder("start:1:month")).toThrow(/Invalid reminder/);
  });

  it("derives a completed focus session interval", () => {
    expect(parseFocusSessionInterval(
      "2026-08-04T09:00:00+08:00",
      "2026-08-04T09:25:01+08:00",
    )).toEqual({
      startedAt: "2026-08-04T01:00:00.000Z",
      endedAt: "2026-08-04T01:25:01.000Z",
      elapsedSeconds: 1501,
    });
    expect(() => parseFocusSessionInterval(
      "2026-08-04T09:00:00+08:00",
      "2026-08-04T09:00:59+08:00",
    )).toThrow(/at least 60 seconds/);
    expect(() => parseFocusSessionInterval(
      "2026-08-04T09:01:00+08:00",
      "2026-08-04T09:00:00+08:00",
    )).toThrow(/ended_at must be later/);
  });

  it("parses ISO Monday week starts and limits creation to this or last week", () => {
    expect(weeklyReportWeekStart(new Date(2026, 0, 1, 12))).toBe("2025-12-29");
    expect(shiftWeeklyReportWeek("2025-12-29", 1)).toBe("2026-01-05");
    const now = new Date(2026, 8, 4, 12);
    expect(parseWeekStart(undefined, now)).toBe("2026-08-31");
    expect(parseWeekStart("current", now)).toBe("2026-08-31");
    expect(parseWeekStart("last", now)).toBe("2026-08-24");
    expect(parseWeekStart("2026-08-31", now)).toBe("2026-08-31");
    expect(() => parseWeekStart("2026-09-01", now)).toThrow(/Monday/);
    expect(() => parseWeekStart("2026-02-30", now)).toThrow(/yyyy-MM-dd/);
    expect(canCreateWeeklyReportForWeek("2026-08-31", now)).toBe(true);
    expect(canCreateWeeklyReportForWeek("2026-08-24", now)).toBe(true);
    expect(canCreateWeeklyReportForWeek("2026-08-17", now)).toBe(false);
    expect(canCreateWeeklyReportForWeek("2026-09-07", now)).toBe(false);
  });

  it("validates weekly report visibility, status, and publish requirements", () => {
    expect(parseWeeklyReportVisibility("users")).toBe("users");
    expect(() => parseWeeklyReportVisibility("all")).toThrow(/workspace, users, or groups/);
    expect(parseWeeklyReportStatus("draft")).toBe("draft");
    expect(parseWeeklyReportStatus("all")).toBe("all");
    expect(() => parseWeeklyReportStatus("open")).toThrow(/draft, published, or all/);
    expect(() => assertWeeklyReportCanPublish({
      completedText: " ",
      nextPlanText: "",
      reflectionText: "",
      visibility: "workspace",
      userIds: [],
      groupIds: [],
    })).toThrow(/at least one weekly report section/);
    expect(() => assertWeeklyReportCanPublish({
      completedText: "done",
      nextPlanText: "",
      reflectionText: "",
      visibility: "users",
      userIds: [],
      groupIds: [],
    })).toThrow(/--user/);
    expect(() => assertWeeklyReportCanPublish({
      completedText: "done",
      nextPlanText: "",
      reflectionText: "",
      visibility: "groups",
      userIds: [],
      groupIds: [],
    })).toThrow(/--group/);
  });
});
