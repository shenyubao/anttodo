import { describe, expect, it } from "vitest";
import {
  nextOccurrenceFields,
  nextRecurrenceInstant,
  normalizeRecurrence,
  recurrenceRule,
  recurrenceSummary,
} from "./recurrence";

describe("recurrence", () => {
  it("normalizes supported presets and rejects invalid rules", () => {
    expect(normalizeRecurrence(recurrenceRule("daily"))).toEqual({
      freq: "daily",
      interval: 1,
      mode: "due",
    });
    expect(normalizeRecurrence(null)).toBeNull();
    expect(() => normalizeRecurrence({
      freq: "daily",
      interval: 2 as 1,
      mode: "due",
    })).toThrow("重复规则无效");
  });

  it("summarizes rules with due-date anchors", () => {
    expect(recurrenceSummary(null, null)).toBe("重复");
    expect(recurrenceSummary(recurrenceRule("daily"), "2026-08-03T10:00:00.000Z")).toBe("每天");
    expect(recurrenceSummary(recurrenceRule("weekdays"), "2026-08-03T10:00:00.000Z")).toBe("工作日");
    expect(recurrenceSummary(
      recurrenceRule("weekly"),
      "2026-08-03T10:00:00.000Z",
      "UTC",
    )).toBe("每周一");
    expect(recurrenceSummary(
      recurrenceRule("monthly"),
      "2026-08-03T10:00:00.000Z",
      "UTC",
    )).toBe("每月3日");
    expect(recurrenceSummary(
      recurrenceRule("yearly"),
      "2026-03-02T10:00:00.000Z",
      "UTC",
    )).toBe("每年3月2日");
  });

  it("advances daily, weekly, and weekday occurrences", () => {
    expect(nextRecurrenceInstant(
      "2026-08-03T10:00:00.000Z",
      recurrenceRule("daily"),
      "UTC",
    ).toISOString()).toBe("2026-08-04T10:00:00.000Z");
    expect(nextRecurrenceInstant(
      "2026-08-03T10:00:00.000Z",
      recurrenceRule("weekly"),
      "UTC",
    ).toISOString()).toBe("2026-08-10T10:00:00.000Z");
    expect(nextRecurrenceInstant(
      "2026-08-07T10:00:00.000Z",
      recurrenceRule("weekdays"),
      "UTC",
    ).toISOString()).toBe("2026-08-10T10:00:00.000Z");
  });

  it("clamps monthly and yearly anchors to month length", () => {
    expect(nextRecurrenceInstant(
      "2026-01-31T15:00:00.000Z",
      recurrenceRule("monthly"),
      "UTC",
    ).toISOString()).toBe("2026-02-28T15:00:00.000Z");
    expect(nextRecurrenceInstant(
      "2024-02-29T12:00:00.000Z",
      recurrenceRule("yearly"),
      "UTC",
    ).toISOString()).toBe("2025-02-28T12:00:00.000Z");
  });

  it("advances range start by the same delta as due_at", () => {
    expect(nextOccurrenceFields({
      due_at: "2026-01-31T15:00:00.000Z",
      due_start_at: "2026-01-30T15:00:00.000Z",
      due_timezone: "UTC",
      recurrence: recurrenceRule("monthly"),
    })).toEqual({
      due_at: "2026-02-28T15:00:00.000Z",
      due_start_at: "2026-02-27T15:00:00.000Z",
    });
  });
});
