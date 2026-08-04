import { describe, expect, it } from "vitest";
import {
  formatAppVersionLabel,
  formatDeployAppVersion,
  normalizeAppVersion,
} from "./app-version.mjs";

describe("app version helpers", () => {
  it("formats deploy versions as 1.0.YYYYMMDDHHmm in local time", () => {
    expect(formatDeployAppVersion(new Date(2026, 7, 3, 12, 43, 59))).toBe("1.0.202608031243");
    expect(formatDeployAppVersion(new Date(2026, 0, 5, 9, 8, 0))).toBe("1.0.202601050908");
  });

  it("normalizes and labels versions with a single v prefix", () => {
    expect(normalizeAppVersion("1.0.202608031243")).toBe("1.0.202608031243");
    expect(normalizeAppVersion("v1.0.202608031243")).toBe("1.0.202608031243");
    expect(normalizeAppVersion("V0.1.0")).toBe("0.1.0");
    expect(normalizeAppVersion("1.0")).toBeNull();
    expect(formatAppVersionLabel("1.0.202608031243")).toBe("v1.0.202608031243");
    expect(formatAppVersionLabel("v1.0.202608031243")).toBe("v1.0.202608031243");
    expect(formatAppVersionLabel("")).toBe("未知");
  });
});
