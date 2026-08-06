import { describe, expect, it } from "vitest";
import {
  formatHoursDetail,
  formatHoursList,
  formatHoursValue,
  normalizeHoursInput,
  parseEstimateHoursText,
} from "./taskHours";

describe("normalizeHoursInput", () => {
  it("returns null for empty input", () => {
    expect(normalizeHoursInput("")).toBeNull();
    expect(normalizeHoursInput("  ")).toBeNull();
  });

  it("accepts non-negative values with at most one decimal", () => {
    expect(normalizeHoursInput("5")).toBe(5);
    expect(normalizeHoursInput("0.2")).toBe(0.2);
    expect(normalizeHoursInput("0")).toBe(0);
  });

  it("rejects negatives and excess precision", () => {
    expect(() => normalizeHoursInput("-1")).toThrow();
    expect(() => normalizeHoursInput("0.25")).toThrow();
  });
});

describe("formatHours", () => {
  it("formats detail and list labels", () => {
    expect(formatHoursValue(5)).toBe("5");
    expect(formatHoursValue(0.2)).toBe("0.2");
    expect(formatHoursDetail(5, 3)).toBe("预计：5小时，实际：3小时");
    expect(formatHoursDetail(5, null)).toBe("预计：5小时");
    expect(formatHoursDetail(null, 3)).toBe("实际：3小时");
    expect(formatHoursDetail(null, null)).toBeNull();
    expect(formatHoursList(45, 43)).toBe("预:45小时 耗:43小时");
    expect(formatHoursList(0.2, null)).toBe("预:0.2小时");
    expect(formatHoursList(null, null)).toBeNull();
  });
});

describe("parseEstimateHoursText", () => {
  it("parses ~5h and ~0.2 h tokens", () => {
    expect(parseEstimateHoursText("写报告 ~5h")).toEqual({
      estimateHours: 5,
      title: "写报告",
      match: { start: 4, end: 7, text: "~5h" },
    });
    expect(parseEstimateHoursText("~0.2 h 修 bug")).toEqual({
      estimateHours: 0.2,
      title: "修 bug",
      match: { start: 0, end: 6, text: "~0.2 h" },
    });
  });

  it("rejects invalid patterns", () => {
    expect(parseEstimateHoursText("写报告")).toBeNull();
    expect(parseEstimateHoursText("~0.25h 写报告")).toBeNull();
    expect(parseEstimateHoursText("~-5h")).toBeNull();
  });
});
