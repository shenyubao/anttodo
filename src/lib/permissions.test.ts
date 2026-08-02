import { describe, expect, it } from "vitest";
import { createDemoBundle } from "./demo";
import {
  canAccessAllLabels,
  currentTaskPermissionLevel,
  intersectPermissionLevels,
} from "./permissions";

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

  it("derives task editing from the strict server-provided label levels", () => {
    const bundle = createDemoBundle();
    const task = bundle.tasks.find((item) => item.id === "task-1")!;
    bundle.labelPermissionLevels.product = 2;
    bundle.labelPermissionLevels.urgent = 1;
    expect(currentTaskPermissionLevel(bundle, task, "demo-user")).toBe(1);
    bundle.labelPermissionLevels.urgent = 2;
    expect(currentTaskPermissionLevel(bundle, task, "demo-user")).toBe(2);
  });

  it("lets only the creator or workspace administrators edit inbox tasks", () => {
    const bundle = createDemoBundle();
    const task = bundle.tasks.find((item) => item.id === "task-5")!;
    expect(currentTaskPermissionLevel(bundle, task, "demo-user")).toBe(2);
    expect(currentTaskPermissionLevel(bundle, task, "demo-member")).toBe(1);
  });
});
