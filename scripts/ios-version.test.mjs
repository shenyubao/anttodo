import { describe, expect, it } from "vitest";
import { applyIosVersionsToPbxproj, resolveIosVersions } from "./ios-version.mjs";

describe("ios version helpers", () => {
  it("maps package version to marketing + build numbers", () => {
    expect(resolveIosVersions("1.0.202608031604")).toEqual({
      marketingVersion: "1.0.202608031604",
      buildNumber: "202608031604",
    });
    expect(resolveIosVersions("v1.0.202608031604")).toEqual({
      marketingVersion: "1.0.202608031604",
      buildNumber: "202608031604",
    });
  });

  it("rejects invalid package versions", () => {
    expect(() => resolveIosVersions("1.0")).toThrow(/无效的应用版本/);
    expect(() => resolveIosVersions("")).toThrow(/无效的应用版本/);
  });

  it("rewrites MARKETING_VERSION and CURRENT_PROJECT_VERSION in pbxproj", () => {
    const source = `
				MARKETING_VERSION = 1.0;
				CURRENT_PROJECT_VERSION = 1;
				MARKETING_VERSION = 1.0;
				CURRENT_PROJECT_VERSION = 1;
`;
    const next = applyIosVersionsToPbxproj(source, {
      marketingVersion: "1.0.202608031604",
      buildNumber: "202608031604",
    });
    expect(next).toContain("MARKETING_VERSION = 1.0.202608031604;");
    expect(next).toContain("CURRENT_PROJECT_VERSION = 202608031604;");
    expect(next).not.toContain("MARKETING_VERSION = 1.0;");
    expect(next).not.toContain("CURRENT_PROJECT_VERSION = 1;");
  });
});
