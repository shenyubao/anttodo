import { describe, expect, it } from "vitest";
import {
  areAllUserGroupsFullyVisible,
  CALENDAR_UNASSIGNED_ID,
  calendarAssigneeFilterIds,
  isUserGroupFullyVisible,
  memberIdsForUserGroup,
  taskIsVisibleOnCalendar,
  taskMatchesCalendarAssignees,
  taskMatchesCalendarLabels,
  taskMatchesCalendarSmartViews,
  toggleAllUserGroupsInAssigneeFilter,
  toggleUserGroupInAssigneeFilter,
} from "./calendarVisibility";
import type { CustomTaskView, Task } from "../types";

const memberships = [
  { group_id: "g1", user_id: "u1" },
  { group_id: "g1", user_id: "u2" },
  { group_id: "g2", user_id: "u2" },
  { group_id: "g2", user_id: "u3" },
];

describe("calendarAssigneeFilterIds", () => {
  it("puts unassigned first, then member ids", () => {
    expect(calendarAssigneeFilterIds([
      { user_id: "u2" },
      { user_id: "u1" },
    ])).toEqual([CALENDAR_UNASSIGNED_ID, "u2", "u1"]);
  });
});

describe("user group assignee helpers", () => {
  it("lists member ids for a group", () => {
    expect(memberIdsForUserGroup("g1", memberships)).toEqual(["u1", "u2"]);
    expect(memberIdsForUserGroup("missing", memberships)).toEqual([]);
  });

  it("checks whether every group member is visible", () => {
    expect(isUserGroupFullyVisible("g1", new Set(["u1", "u2"]), memberships)).toBe(true);
    expect(isUserGroupFullyVisible("g1", new Set(["u1"]), memberships)).toBe(false);
    expect(isUserGroupFullyVisible("g1", new Set(), memberships)).toBe(false);
    expect(isUserGroupFullyVisible("empty", new Set(["u1"]), [])).toBe(false);
  });

  it("checks whether every listed group is fully visible", () => {
    expect(areAllUserGroupsFullyVisible(
      ["g1", "g2"],
      new Set(["u1", "u2", "u3"]),
      memberships,
    )).toBe(true);
    expect(areAllUserGroupsFullyVisible(
      ["g1", "g2"],
      new Set(["u1", "u2"]),
      memberships,
    )).toBe(false);
    expect(areAllUserGroupsFullyVisible([], new Set(["u1"]), memberships)).toBe(false);
  });

  it("toggles a group by adding or removing all of its members", () => {
    expect([...toggleUserGroupInAssigneeFilter(new Set(["u1"]), "g1", memberships)].sort())
      .toEqual(["u1", "u2"]);
    expect([...toggleUserGroupInAssigneeFilter(new Set(["u1", "u2"]), "g1", memberships)].sort())
      .toEqual([]);
    expect([...toggleUserGroupInAssigneeFilter(new Set(["x"]), "missing", memberships)])
      .toEqual(["x"]);
  });

  it("selects or clears every member across all groups", () => {
    expect(toggleAllUserGroupsInAssigneeFilter(
      new Set([CALENDAR_UNASSIGNED_ID]),
      ["g1", "g2"],
      memberships,
    )).toEqual(new Set([CALENDAR_UNASSIGNED_ID, "u1", "u2", "u3"]));
    expect(toggleAllUserGroupsInAssigneeFilter(
      new Set([CALENDAR_UNASSIGNED_ID, "u1", "u2", "u3"]),
      ["g1", "g2"],
      memberships,
    )).toEqual(new Set([CALENDAR_UNASSIGNED_ID]));
  });
});

describe("taskMatchesCalendarLabels", () => {
  it("maps inbox for unlabeled tasks", () => {
    expect(taskMatchesCalendarLabels({ label_ids: [] }, new Set(["inbox"]))).toBe(true);
    expect(taskMatchesCalendarLabels({ label_ids: [] }, new Set(["l1"]))).toBe(false);
  });

  it("matches any visible label", () => {
    expect(taskMatchesCalendarLabels({ label_ids: ["l1", "l2"] }, new Set(["l2"]))).toBe(true);
    expect(taskMatchesCalendarLabels({ label_ids: ["l1"] }, new Set(["inbox"]))).toBe(false);
  });
});

describe("taskMatchesCalendarAssignees", () => {
  it("treats null assignee as unassigned, including cli-only tasks", () => {
    expect(taskMatchesCalendarAssignees({ assignee_id: null }, new Set([CALENDAR_UNASSIGNED_ID])))
      .toBe(true);
    expect(taskMatchesCalendarAssignees({ assignee_id: null }, new Set(["u1"]))).toBe(false);
  });

  it("matches the assigned user id", () => {
    expect(taskMatchesCalendarAssignees({ assignee_id: "u1" }, new Set(["u1"]))).toBe(true);
    expect(taskMatchesCalendarAssignees({ assignee_id: "u1" }, new Set([CALENDAR_UNASSIGNED_ID])))
      .toBe(false);
  });
});

describe("taskIsVisibleOnCalendar", () => {
  it("requires label and assignee filters to both pass", () => {
    const task = { label_ids: [] as string[], assignee_id: null as string | null };
    expect(taskIsVisibleOnCalendar(
      task,
      new Set(["inbox"]),
      new Set([CALENDAR_UNASSIGNED_ID]),
    )).toBe(true);
    expect(taskIsVisibleOnCalendar(
      task,
      new Set(["inbox"]),
      new Set(["u1"]),
    )).toBe(false);
    expect(taskIsVisibleOnCalendar(
      task,
      new Set(["l1"]),
      new Set([CALENDAR_UNASSIGNED_ID]),
    )).toBe(false);
  });
});

describe("taskMatchesCalendarSmartViews", () => {
  const task = {
    assignee_id: "me",
    participant_ids: ["watcher"],
    created_by: "creator",
    label_ids: ["l1"],
    due_at: "2026-08-25T09:00:00.000Z",
    due_start_at: null,
    due_is_all_day: false,
    status: "open",
    kind: "todo",
  } as Task;
  const customView = {
    id: "custom-1",
    workspace_id: "w1",
    user_id: "me",
    name: "我的标签",
    definition: {
      scope: "label",
      label_ids: ["l1"],
      filter_assignee: "all",
      filter_assignee_ids: [],
      filter_watching: "all",
      filter_creator: "all",
      filter_due: ["all"],
    },
    visible: true,
    position: 0,
    created_at: "2026-08-25T00:00:00.000Z",
    updated_at: "2026-08-25T00:00:00.000Z",
  } satisfies CustomTaskView;

  it("does not narrow the calendar until a smart list is selected", () => {
    expect(taskMatchesCalendarSmartViews(task, new Set(), [customView], "someone-else"))
      .toBe(true);
  });

  it("matches assigned-to-me and watching system lists", () => {
    expect(taskMatchesCalendarSmartViews(task, new Set(["assigned"]), [], "me")).toBe(true);
    expect(taskMatchesCalendarSmartViews(task, new Set(["assigned"]), [], "someone-else"))
      .toBe(false);
    expect(taskMatchesCalendarSmartViews(task, new Set(["watching"]), [], "watcher"))
      .toBe(true);
  });

  it("matches custom list scope and filters, with selected lists combined by union", () => {
    expect(taskMatchesCalendarSmartViews(
      task,
      new Set(["custom:custom-1"]),
      [customView],
      "me",
    )).toBe(true);
    expect(taskMatchesCalendarSmartViews(
      { ...task, label_ids: ["other"] },
      new Set(["custom:custom-1"]),
      [customView],
      "me",
    )).toBe(false);
    expect(taskMatchesCalendarSmartViews(
      task,
      new Set(["assigned", "custom:missing"]),
      [customView],
      "me",
    )).toBe(true);
  });
});
