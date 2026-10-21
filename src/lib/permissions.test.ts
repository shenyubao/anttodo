import { describe, expect, it } from "vitest";
import { createDemoBundle } from "./demo";
import {
  canAccessAllLabels,
  canOrganizeTask,
  canAssignQuickCreateTask,
  isYunxiaoQuickCreateTask,
  currentLabelPermissionLevel,
  currentTaskPermissionLevel,
  intersectPermissionLevels,
  isExternalTask,
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

  it("denies access while restoring a legacy bundle without permission levels", () => {
    const legacyBundle = createDemoBundle() as Partial<ReturnType<typeof createDemoBundle>>;
    delete legacyBundle.labelPermissionLevels;

    expect(currentLabelPermissionLevel(
      legacyBundle as ReturnType<typeof createDemoBundle>,
      "product",
    )).toBe(0);
  });

  it("lets the creator, assignee, or workspace administrators edit inbox tasks", () => {
    const bundle = createDemoBundle();
    const task = bundle.tasks.find((item) => item.id === "task-5")!;
    expect(currentTaskPermissionLevel(bundle, task, "demo-user")).toBe(2);
    expect(currentTaskPermissionLevel(bundle, task, "demo-member")).toBe(1);
    task.assignee_id = "demo-member";
    expect(currentTaskPermissionLevel(bundle, task, "demo-member")).toBe(2);
  });

  it("lets editors organize connector-synced tasks without treating them as editable content", () => {
    const bundle = createDemoBundle();
    const task = bundle.tasks.find((item) => item.id === "task-1")!;
    bundle.labelPermissionLevels.product = 2;
    bundle.labelPermissionLevels.urgent = 2;
    expect(canOrganizeTask(bundle, task, "demo-user")).toBe(true);
    expect(isExternalTask(task)).toBe(false);
    task.connector_id = "connector-1";
    expect(isExternalTask(task)).toBe(true);
    expect(canOrganizeTask(bundle, task, "demo-user")).toBe(true);
  });
});

describe("local quick-create assignment", () => {
  function fixture() {
    const bundle = createDemoBundle();
    const task = bundle.tasks.find((item) => item.id === "task-1")!;
    bundle.labelPermissionLevels.product = 2;
    bundle.labelPermissionLevels.urgent = 2;
    task.connector_platform = "yunxiao";
    task.connector_id = bundle.connectors[0].id;
    Object.assign(bundle.connectors[0], {
      workspace_id: task.workspace_id,
      type: "yunxiao",
      enabled: false,
      public_config: { kind: "quick_create", organizationId: "org" },
    });
    return { bundle, task };
  }

  it("allows editors to assign existing quick-create tasks even with a disabled connector", () => {
    const { bundle, task } = fixture();
    expect(canAssignQuickCreateTask(bundle, task, "demo-user")).toBe(true);
    task.deleted_at = new Date().toISOString();
    expect(canAssignQuickCreateTask(bundle, task, "demo-user")).toBe(false);
  });

  it("requires edit permission on every label", () => {
    const { bundle, task } = fixture();
    bundle.labelPermissionLevels.urgent = 1;
    expect(canAssignQuickCreateTask(bundle, task, "demo-user")).toBe(false);
  });

  it("checks the actual connector and fails closed for missing or mismatched metadata", () => {
    const { bundle, task } = fixture();
    bundle.connectors[0].public_config = { organizationId: "org" };
    expect(isYunxiaoQuickCreateTask(bundle, task)).toBe(false);
    bundle.connectors[0].public_config = { kind: "quick_create", organizationId: "org" };
    bundle.connectors[0].workspace_id = "another-workspace";
    expect(canAssignQuickCreateTask(bundle, task, "demo-user")).toBe(false);
    bundle.connectors = [];
    expect(canAssignQuickCreateTask(bundle, task, "demo-user")).toBe(false);
  });
});
