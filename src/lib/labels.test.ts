import { describe, expect, it } from "vitest";
import {
  DEFAULT_LABEL_COLOR,
  applyLabelAccessToBundle,
  appendCreatedLabelToBundle,
  hasExplicitLabelColor,
  LABEL_COLORS,
  labelIdFromRealtimeChange,
  newLabelAccessDefaults,
} from "./labels";
import type { Label, LabelAccessDraft, WorkspaceBundle } from "../types";

const labels: Label[] = [
  {
    id: "team-parent",
    workspace_id: "workspace",
    parent_id: null,
    name: "团队父标签",
    color: DEFAULT_LABEL_COLOR,
    kind: "team",
    view_scope: "users",
    manage_scope: "groups",
    inherit_permissions: false,
    position: 0,
    created_by: "user",
  },
  {
    id: "private-parent",
    workspace_id: "workspace",
    parent_id: null,
    name: "私人父标签",
    color: DEFAULT_LABEL_COLOR,
    kind: "private",
    view_scope: "all",
    manage_scope: "users",
    inherit_permissions: false,
    position: 1,
    created_by: "user",
  },
];

const emptyBundle = (): WorkspaceBundle => ({
  members: [],
  userGroups: [],
  userGroupMembers: [],
  labels: [],
  labelUserAcls: [],
  labelGroupAcls: [],
  labelPermissionLevels: {},
  tasks: [],
  connectors: [],
  syncRuns: [],
  conflicts: [],
  taskListPreferences: [],
  taskSections: [],
  taskPlacements: [],
});

const teamDraft = (overrides: Partial<LabelAccessDraft> = {}): LabelAccessDraft => ({
  name: "产品",
  color: "#4ca1ff",
  parentId: null,
  kind: "team",
  viewScope: "users",
  manageScope: "users",
  viewSubjectIds: ["viewer"],
  manageSubjectIds: ["manager"],
  ...overrides,
});

describe("label colors", () => {
  it("treats the default task-label gray as no explicit label color", () => {
    expect(hasExplicitLabelColor(DEFAULT_LABEL_COLOR)).toBe(false);
    expect(hasExplicitLabelColor(DEFAULT_LABEL_COLOR.toUpperCase())).toBe(false);
  });

  it("keeps gray out of the user-selectable palette", () => {
    expect(LABEL_COLORS).not.toContain(DEFAULT_LABEL_COLOR);
    expect(LABEL_COLORS.every(hasExplicitLabelColor)).toBe(true);
  });
});

describe("new label access defaults", () => {
  it("keeps the top-level defaults when there is no parent", () => {
    expect(newLabelAccessDefaults(labels, null)).toEqual({
      kind: "private",
      viewScope: "all",
      manageScope: "users",
    });
  });

  it("uses a team parent's type and inherits its access settings", () => {
    expect(newLabelAccessDefaults(labels, "team-parent")).toEqual({
      kind: "team",
      viewScope: "inherit",
      manageScope: "inherit",
    });
  });

  it("uses a private parent's type", () => {
    expect(newLabelAccessDefaults(labels, "private-parent")).toEqual({
      kind: "private",
      viewScope: "inherit",
      manageScope: "inherit",
    });
  });
});

describe("label bundle updates", () => {
  it("appends a created label with manage permission and ACL rows", () => {
    const created: Label = {
      id: "label-new",
      workspace_id: "workspace",
      parent_id: null,
      name: "产品",
      color: "#4ca1ff",
      kind: "team",
      view_scope: "users",
      manage_scope: "users",
      inherit_permissions: false,
      position: 0,
      created_by: "user",
    };
    const draft = teamDraft();
    const next = appendCreatedLabelToBundle(emptyBundle(), created, draft);

    expect(next.labels).toEqual([created]);
    expect(next.labelPermissionLevels["label-new"]).toBe(2);
    expect(next.labelUserAcls).toEqual([
      {
        label_id: "label-new",
        workspace_id: "workspace",
        user_id: "viewer",
        permission: "view",
      },
      {
        label_id: "label-new",
        workspace_id: "workspace",
        user_id: "manager",
        permission: "edit",
      },
    ]);
    expect(next.labelGroupAcls).toEqual([]);
  });

  it("replaces existing ACL rows for a label without touching other labels", () => {
    const bundle: WorkspaceBundle = {
      ...emptyBundle(),
      labels: labels.slice(0, 1),
      labelUserAcls: [
        {
          label_id: "team-parent",
          workspace_id: "workspace",
          user_id: "old-user",
          permission: "view",
        },
        {
          label_id: "other-label",
          workspace_id: "workspace",
          user_id: "kept",
          permission: "edit",
        },
      ],
      labelGroupAcls: [
        {
          label_id: "team-parent",
          workspace_id: "workspace",
          group_id: "old-group",
          permission: "view",
        },
      ],
    };
    const next = applyLabelAccessToBundle(bundle, "team-parent", teamDraft({
      viewScope: "groups",
      manageScope: "groups",
      viewSubjectIds: ["group-a"],
      manageSubjectIds: ["group-b"],
    }));

    expect(next.labelUserAcls).toEqual([
      {
        label_id: "other-label",
        workspace_id: "workspace",
        user_id: "kept",
        permission: "edit",
      },
    ]);
    expect(next.labelGroupAcls).toEqual([
      {
        label_id: "team-parent",
        workspace_id: "workspace",
        group_id: "group-a",
        permission: "view",
      },
      {
        label_id: "team-parent",
        workspace_id: "workspace",
        group_id: "group-b",
        permission: "edit",
      },
    ]);
  });
});

describe("labelIdFromRealtimeChange", () => {
  it("reads labels.id and ACL label_id from new or old records", () => {
    expect(labelIdFromRealtimeChange({
      table: "labels",
      new: { id: "label-1" },
    })).toBe("label-1");
    expect(labelIdFromRealtimeChange({
      table: "label_user_acl",
      new: {},
      old: { label_id: "label-2" },
    })).toBe("label-2");
    expect(labelIdFromRealtimeChange({
      table: "label_group_acl",
      new: { label_id: "label-3" },
    })).toBe("label-3");
  });
});
