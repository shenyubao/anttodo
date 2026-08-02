import { describe, expect, it } from "vitest";
import {
  PERSISTENT_REMINDER_REPEAT_COUNT,
  desktopReminderOccurrences,
  normalizeReminderRules,
  reminderRuleLabel,
  reminderTriggerAt,
} from "./reminders";

describe("reminder rules", () => {
  it("deduplicates rules and enforces the one-year boundary", () => {
    const rule = { anchor: "start" as const, offset_value: 30, offset_unit: "minute" as const, local_time: null };
    expect(normalizeReminderRules([rule, rule])).toEqual([rule]);
    expect(() => normalizeReminderRules([{ ...rule, offset_value: 525_601 }])).toThrow("365 天");
  });

  it("computes timed reminders relative to start or end", () => {
    const task = {
      due_start_at: "2026-08-02T01:00:00.000Z",
      due_at: "2026-08-02T03:00:00.000Z",
      due_timezone: "Asia/Shanghai",
    };
    expect(reminderTriggerAt(task, {
      anchor: "start", offset_value: 30, offset_unit: "minute", local_time: null,
    })).toBe("2026-08-02T00:30:00.000Z");
    expect(reminderTriggerAt(task, {
      anchor: "end", offset_value: 0, offset_unit: "minute", local_time: null,
    })).toBe("2026-08-02T03:00:00.000Z");
  });

  it("computes all-day local reminders across DST", () => {
    const trigger = reminderTriggerAt({
      due_start_at: "2026-11-01T04:00:00.000Z",
      due_at: "2026-11-02T04:59:59.999Z",
      due_timezone: "America/New_York",
    }, {
      anchor: "start", offset_value: 1, offset_unit: "day", local_time: "09:00",
    });
    expect(trigger).toBe("2026-10-31T13:00:00.000Z");
    expect(reminderRuleLabel({
      anchor: "start", offset_value: 1, offset_unit: "week", local_time: "09:00",
    }, true)).toBe("提前1周 (09:00)");
  });

  it("creates a bounded persistent reminder sequence", () => {
    const occurrences = desktopReminderOccurrences({
      id: "reminder-1",
      trigger_at: "2026-08-02T00:00:00.000Z",
    }, true);
    expect(occurrences).toHaveLength(PERSISTENT_REMINDER_REPEAT_COUNT + 1);
    expect(occurrences.at(-1)?.triggerAt).toBe("2026-08-02T00:30:00.000Z");
  });
});
