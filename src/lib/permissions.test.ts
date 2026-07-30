import { describe, expect, it } from "vitest";
import { canAccessAllLabels, intersectPermissionLevels } from "./permissions";

describe("strict multi-label permission intersection", () => {
  it("uses the least permissive attached label", () => {
    expect(intersectPermissionLevels([2, 1, 2])).toBe(1);
    expect(canAccessAllLabels([2, 1, 2], 1)).toBe(true);
    expect(canAccessAllLabels([2, 1, 2], 2)).toBe(false);
  });

  it("denies access when any label is hidden or when no label is attached", () => {
    expect(canAccessAllLabels([2, 0], 1)).toBe(false);
    expect(canAccessAllLabels([], 1)).toBe(false);
  });
});
