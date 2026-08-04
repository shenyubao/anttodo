import { describe, expect, it } from "vitest";
import { formatAppVersionLabel, normalizeAppVersion } from "./appVersion";

describe("appVersion", () => {
  it("normalizes and labels app versions", () => {
    expect(normalizeAppVersion("1.0.202608031243")).toBe("1.0.202608031243");
    expect(normalizeAppVersion("v1.0.202608031243")).toBe("1.0.202608031243");
    expect(formatAppVersionLabel("1.0.202608031243")).toBe("v1.0.202608031243");
    expect(formatAppVersionLabel("v0.1.0")).toBe("v0.1.0");
    expect(formatAppVersionLabel(null)).toBe("未知");
  });
});
