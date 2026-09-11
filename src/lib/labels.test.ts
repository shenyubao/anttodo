import { describe, expect, it } from "vitest";
import {
  DEFAULT_LABEL_COLOR,
  applyLabelAccessToBundle,
  appendCreatedLabelToBundle,
  hasExplicitLabelColor,
  LABEL_COLORS,
  taskLabelBarColor,
  labelDropPlacementFromY,
  labelIdFromRealtimeChange,
  moveIdInOrder,
  newLabelAccessDefaults,
  removeLabelSubtreeFromBundle,
  sortSiblingLabels,
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
  userLabelOrder: [],
  userSidebarMembers: [],
    labelTaskCounts: {},
    tasks: [],
  connectors: [],
  syncRuns: [],
  conflicts: [],
    taskListPreferences: [],
    customTaskViews: [],
    taskSystemViewPreferences: [],
    matrixQuadrantPreferences: [],
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

  it("hides the list color bar when no label has an explicit color", () => {
    expect(taskLabelBarColor(
      [{ id: "work", color: DEFAULT_LABEL_COLOR }],
      ["work"],
      null,
    )).toBeNull();
  });

  it("uses the current list color when viewing a colored label", () => {
    expect(taskLabelBarColor(
      [
        { id: "work", color: "#ffac38" },
        { id: "home", color: "#4ca1ff" },
      ],
      ["work", "home"],
      "home",
    )).toBe("#4ca1ff");
  });

  it("uses the first explicit task label color in mixed views", () => {
    expect(taskLabelBarColor(
      [
        { id: "inbox", color: DEFAULT_LABEL_COLOR },
        { id: "work", color: "#ffac38" },
      ],
      ["inbox", "work"],
      null,
    )).toBe("#ffac38");
  });

  it("falls through to the task label when the current list has no color", () => {
    expect(taskLabelBarColor(
      [
        { id: "parent", color: DEFAULT_LABEL_COLOR },
        { id: "work", color: "#4ca1ff" },
      ],
      ["parent", "work"],
      "parent",
    )).toBe("#4ca1ff");
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
    expect(next.labelTaskCounts["label-new"]).toBe(0);
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

  it("removes a label subtree and all cached associations", () => {
    const child: Label = {
      ...labels[0],
      id: "team-child",
      parent_id: "team-parent",
      name: "子标签",
      position: 0,
    };
    const grandchild: Label = {
      ...child,
      id: "team-grandchild",
      parent_id: "team-child",
      name: "孙标签",
    };
    const bundle: WorkspaceBundle = {
      ...emptyBundle(),
      labels: [...labels, child, grandchild],
      labelUserAcls: [
        { label_id: "team-parent", workspace_id: "workspace", user_id: "viewer", permission: "view" },
        { label_id: "private-parent", workspace_id: "workspace", user_id: "owner", permission: "edit" },
      ],
      labelGroupAcls: [
        { label_id: "team-child", workspace_id: "workspace", group_id: "group", permission: "view" },
      ],
      labelPermissionLevels: {
        "team-parent": 2,
        "team-child": 1,
        "team-grandchild": 1,
        "private-parent": 2,
      },
      userLabelOrder: [
        { user_id: "user", workspace_id: "workspace", label_id: "team-parent", position: 0 },
        { user_id: "user", workspace_id: "workspace", label_id: "private-parent", position: 1 },
      ],
      labelTaskCounts: {
        "team-parent": 1,
        "team-child": 0,
        "team-grandchild": 1,
        "private-parent": 1,
      },
      tasks: [{
        id: "task",
        workspace_id: "workspace",
        parent_task_id: null,
        position: 0,
        title: "任务",
        description: "",
        kind: "todo",
        status: "open",
        priority: "none",
        due_at: null,
        due_start_at: null,
        due_is_all_day: false,
        due_timezone: null,
        recurrence: null,
        estimate_hours: null,
        actual_hours: null,
        estimate_pomodoros: null,
        actual_pomodoros: null,
        assignee_id: null,
        cli_assignee: null,
        created_by: "user",
        completed_at: null,
        deleted_at: null,
        version: 1,
        created_at: "",
        updated_at: "",
        external_id: null,
        connector_id: null,
        connector_platform: null,
        label_ids: ["team-parent", "team-grandchild", "private-parent"],
        participant_ids: [],
        description_mentions: [],
        children: [],
        reminders: [],
        reminder_persistent: false,
      }],
    };

    const next = removeLabelSubtreeFromBundle(bundle, "team-parent");

    expect(next.labels.map((label) => label.id)).toEqual(["private-parent"]);
    expect(next.labelUserAcls.map((acl) => acl.label_id)).toEqual(["private-parent"]);
    expect(next.labelGroupAcls).toEqual([]);
    expect(next.labelPermissionLevels).toEqual({ "private-parent": 2 });
    expect(next.userLabelOrder.map((row) => row.label_id)).toEqual(["private-parent"]);
    expect(next.labelTaskCounts).toEqual({ "private-parent": 1 });
    expect(next.tasks[0]?.label_ids).toEqual(["private-parent"]);
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

describe("label sibling ordering helpers", () => {
  const siblings: Label[] = [
    { ...labels[0], id: "a", parent_id: null, position: 0, name: "A" },
    { ...labels[0], id: "b", parent_id: null, position: 1, name: "B" },
    { ...labels[0], id: "c", parent_id: null, position: 2, name: "C" },
    { ...labels[0], id: "child-1", parent_id: "a", position: 5, name: "Child 1" },
    { ...labels[0], id: "child-2", parent_id: "a", position: 1, name: "Child 2" },
  ];

  it("sorts top-level labels by personal order when present", () => {
    expect(sortSiblingLabels(siblings, null, [
      { label_id: "c", position: 0 },
      { label_id: "a", position: 1 },
    ]).map((label) => label.id)).toEqual(["c", "a", "b"]);
  });

  it("sorts nested labels by shared position", () => {
    expect(sortSiblingLabels(siblings, "a").map((label) => label.id)).toEqual([
      "child-2",
      "child-1",
    ]);
  });

  it("moves an id before or after a sibling", () => {
    expect(moveIdInOrder(["a", "b", "c"], "c", "a", "before")).toEqual(["c", "a", "b"]);
    expect(moveIdInOrder(["a", "b", "c"], "a", "c", "after")).toEqual(["b", "c", "a"]);
    expect(moveIdInOrder(["a", "b", "c"], "a", "a", "before")).toBeNull();
  });

  it("maps pointer Y into before/onto/after thirds", () => {
    expect(labelDropPlacementFromY(5, 0, 30)).toBe("before");
    expect(labelDropPlacementFromY(15, 0, 30)).toBe("onto");
    expect(labelDropPlacementFromY(28, 0, 30)).toBe("after");
  });
});
