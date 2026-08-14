import { describe, expect, it } from "vitest";
import {
  adjacentDateSegment,
  applyDateSegmentBackspace,
  applyDateSegmentDigit,
  clampDateParts,
  dateSegmentOrder,
  formatDateParts,
  formatDateSegment,
  incrementDateSegment,
  parseDateInput,
} from "./dateSegmentField";

describe("date segment field", () => {
  it("parses and formats ISO date inputs", () => {
    expect(parseDateInput("2026-08-15")).toEqual({ year: 2026, month: 8, day: 15 });
    expect(parseDateInput("not-a-date")).toBeNull();
    expect(formatDateParts({ year: 2026, month: 8, day: 15 })).toBe("2026-08-15");
  });

  it("orders segments from the date format preference", () => {
    expect(dateSegmentOrder("ymd")).toEqual(["year", "month", "day"]);
    expect(dateSegmentOrder("mdy")).toEqual(["month", "day", "year"]);
    expect(dateSegmentOrder("dmy")).toEqual(["day", "month", "year"]);
    expect(adjacentDateSegment("ymd", "year", 1)).toBe("month");
    expect(adjacentDateSegment("mdy", "year", 1)).toBe("month");
    expect(adjacentDateSegment("dmy", "day", -1)).toBe("year");
  });

  it("clamps overflow days to the end of the month", () => {
    expect(clampDateParts({ year: 2026, month: 2, day: 31 })).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(clampDateParts({ year: 2024, month: 2, day: 31 })).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
    expect(formatDateParts({ year: 2026, month: 4, day: 31 })).toBe("2026-04-30");
  });

  it("increments year, month, and day across calendar boundaries", () => {
    expect(incrementDateSegment({ year: 2026, month: 1, day: 31 }, "month", 1)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(incrementDateSegment({ year: 2026, month: 12, day: 15 }, "month", 1)).toEqual({
      year: 2027,
      month: 1,
      day: 15,
    });
    expect(incrementDateSegment({ year: 2024, month: 2, day: 29 }, "year", 1)).toEqual({
      year: 2025,
      month: 2,
      day: 28,
    });
    expect(incrementDateSegment({ year: 2026, month: 8, day: 31 }, "day", 1)).toEqual({
      year: 2026,
      month: 9,
      day: 1,
    });
  });

  it("commits typed digits and advances when a segment cannot grow", () => {
    expect(applyDateSegmentDigit({ year: 2026, month: 8, day: 15 }, "month", "", "4")).toEqual({
      parts: { year: 2026, month: 4, day: 15 },
      buffer: "",
      advance: true,
    });
    expect(applyDateSegmentDigit({ year: 2026, month: 8, day: 15 }, "month", "", "1")).toEqual({
      parts: { year: 2026, month: 1, day: 15 },
      buffer: "1",
      advance: false,
    });
    expect(applyDateSegmentDigit({ year: 2026, month: 1, day: 15 }, "month", "1", "2")).toEqual({
      parts: { year: 2026, month: 12, day: 15 },
      buffer: "",
      advance: true,
    });
    expect(applyDateSegmentDigit({ year: 2026, month: 1, day: 15 }, "month", "1", "5")).toEqual({
      parts: { year: 2026, month: 12, day: 15 },
      buffer: "",
      advance: true,
    });
    expect(applyDateSegmentDigit({ year: 2026, month: 2, day: 15 }, "day", "", "3")).toEqual({
      parts: { year: 2026, month: 2, day: 3 },
      buffer: "",
      advance: true,
    });
    expect(applyDateSegmentDigit({ year: 2026, month: 8, day: 15 }, "year", "", "2")).toEqual({
      parts: { year: 2, month: 8, day: 15 },
      buffer: "2",
      advance: false,
    });
    expect(
      applyDateSegmentDigit({ year: 2, month: 8, day: 15 }, "year", "202", "6"),
    ).toEqual({
      parts: { year: 2026, month: 8, day: 15 },
      buffer: "",
      advance: true,
    });
  });

  it("keeps a leading zero in the buffer until a real month or day is typed", () => {
    expect(applyDateSegmentDigit({ year: 2026, month: 8, day: 15 }, "month", "", "0")).toEqual({
      parts: { year: 2026, month: 1, day: 15 },
      buffer: "0",
      advance: false,
    });
    expect(applyDateSegmentDigit({ year: 2026, month: 1, day: 15 }, "month", "0", "3")).toEqual({
      parts: { year: 2026, month: 3, day: 15 },
      buffer: "",
      advance: true,
    });
  });

  it("formats the active buffer and supports backspace", () => {
    expect(formatDateSegment({ year: 2026, month: 8, day: 15 }, "month")).toBe("08");
    expect(formatDateSegment({ year: 2026, month: 1, day: 15 }, "month", "1")).toBe("01");
    expect(applyDateSegmentBackspace({ year: 2026, month: 12, day: 15 }, "month", "1")).toEqual({
      parts: { year: 2026, month: 1, day: 15 },
      buffer: "",
    });
    expect(applyDateSegmentBackspace({ year: 2026, month: 8, day: 15 }, "month", "")).toEqual({
      parts: { year: 2026, month: 1, day: 15 },
      buffer: "",
    });
  });
});
