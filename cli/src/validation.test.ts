import { describe, expect, it } from "vitest";
import { nonEmpty, parseDueTime, positiveInteger } from "./validation.js";

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
});
