import { describe, expect, it } from "vitest";
import type { Label, Member, Task } from "../types";
import {
  filterTasksForView,
  groupTasks,
  resolveTaskListPreference,
  sortTasks,
} from "./taskList";

const now = new Date("2026-07-30T12:00:00+08:00");
const labels: Label[] = [
  { id: "a", workspace_id: "w", parent_id: null, name: "甲", color: "#aaa", kind: "team", view_scope: "all", manage_scope: "users", inherit_permissions: false, position: 0, created_by: "u" },
  { id: "b", workspace_id: "w", parent_id: null, name: "乙", color: "#bbb", kind: "team", view_scope: "all", manage_scope: "users", inherit_permissions: false, position: 1, created_by: "u" },
];
const members: Member[] = [
  { workspace_id: "w", user_id: "u", role: "owner", profile: { id: "u", display_name: "张三", avatar_url: null } },
];
const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id,
  workspace_id: "w",
  title: id,
  description: "",
  status: "open",
  priority: "none",
  due_at: null,
  due_start_at: null,
  due_is_all_day: false,
  due_timezone: null,
  assignee_id: null,
  created_by: "u",
  completed_at: null,
  deleted_at: null,
  version: 1,
  created_at: "2026-07-29T01:00:00.000Z",
  updated_at: "2026-07-29T01:00:00.000Z",
  label_ids: [],
  participant_ids: [],
  subtasks: [],
  ...patch,
  cli_assignee: patch.cli_assignee ?? null,
  kind: patch.kind ?? "todo",
  reminders: patch.reminders ?? [],
  reminder_persistent: patch.reminder_persistent ?? false,
  recurrence: patch.recurrence ?? null,
});

describe("task list grouping and sorting", () => {
  it("falls back from the removed custom grouping to no grouping", () => {
    expect(resolveTaskListPreference([], "all").grouping).toBe("none");
    expect(resolveTaskListPreference([{
      user_id: "u",
      workspace_id: "w",
      list_key: "all",
      grouping: "custom",
      sort: "custom",
      direction: "asc",
      show_labels: false,
      show_completed: false,
      view_mode: "list",
    }], "all").grouping).toBe("none");
  });

  it("defaults show_completed to false and preserves saved value", () => {
    expect(resolveTaskListPreference([], "all").show_completed).toBe(false);
    expect(resolveTaskListPreference([{
      user_id: "u",
      workspace_id: "w",
      list_key: "all",
      grouping: "none",
      sort: "custom",
      direction: "asc",
      show_labels: false,
      show_completed: true,
      view_mode: "kanban",
    }], "all").show_completed).toBe(true);
  });

  it("defaults view mode to list and preserves a saved kanban mode", () => {
    expect(resolveTaskListPreference([], "all").view_mode).toBe("list");
    expect(resolveTaskListPreference([{
      user_id: "u",
      workspace_id: "w",
      list_key: "all",
      grouping: "none",
      sort: "custom",
      direction: "asc",
      show_labels: false,
      show_completed: false,
      view_mode: "kanban",
    }], "all").view_mode).toBe("kanban");
  });

  it("keeps null values last in either due-date direction", () => {
    const tasks = [
      task("none"),
      task("later", { due_at: "2026-08-02T00:00:00.000Z" }),
      task("earlier", { due_at: "2026-08-01T00:00:00.000Z" }),
    ];
    expect(sortTasks(tasks, "due", "asc", labels, members, []).map((item) => item.id))
      .toEqual(["earlier", "later", "none"]);
    expect(sortTasks(tasks, "due", "desc", labels, members, []).map((item) => item.id))
      .toEqual(["later", "earlier", "none"]);
  });

  it("duplicates multi-label tasks into every label group", () => {
    const groups = groupTasks({
      tasks: [task("both", { label_ids: ["a", "b"] })],
      grouping: "label",
      sort: "title",
      direction: "asc",
      labels,
      members,
      sections: [],
      placements: [],
      now,
      preferences: { weekStartsOn: 1 },
    });
    expect(groups.map((group) => [group.title, group.tasks.map((item) => item.id)]))
      .toEqual([["甲", ["both"]], ["乙", ["both"]]]);
  });

  it("uses custom sections and placement order", () => {
    const groups = groupTasks({
      tasks: [task("one"), task("two")],
      grouping: "custom",
      sort: "custom",
      direction: "asc",
      labels,
      members,
      sections: [{ id: "s", workspace_id: "w", list_key: "all", name: "计划", position: 0, created_by: "u" }],
      placements: [
        { workspace_id: "w", list_key: "all", task_id: "two", section_id: "s", position: 0 },
        { workspace_id: "w", list_key: "all", task_id: "one", section_id: "s", position: 1 },
      ],
      now,
      preferences: { weekStartsOn: 1 },
    });
    expect(groups.find((group) => group.title === "计划")?.tasks.map((item) => item.id))
      .toEqual(["two", "one"]);
  });

  it("isolates completed tasks before automatic grouping", () => {
    const groups = groupTasks({
      tasks: [task("open"), task("done", { status: "completed", completed_at: now.toISOString() })],
      grouping: "none",
      sort: "custom",
      direction: "asc",
      labels,
      members,
      sections: [],
      placements: [],
      now,
      preferences: { weekStartsOn: 1 },
    });
    expect(groups.flatMap((group) => group.tasks).map((item) => item.id)).toEqual(["open"]);
  });

  it("keeps notes active regardless of their preserved completion status", () => {
    const groups = groupTasks({
      tasks: [task("note", {
        kind: "note",
        status: "completed",
        completed_at: now.toISOString(),
      })],
      grouping: "none",
      sort: "custom",
      direction: "asc",
      labels,
      members,
      sections: [],
      placements: [],
      now,
      preferences: { weekStartsOn: 1 },
    });
    expect(groups.flatMap((group) => group.tasks).map((item) => item.id)).toEqual(["note"]);
  });

  it("treats notes as having no priority for grouping and sorting", () => {
    const tasks = [
      task("note", { kind: "note", priority: "high" }),
      task("low", { priority: "low" }),
    ];
    const groups = groupTasks({
      tasks,
      grouping: "priority",
      sort: "title",
      direction: "asc",
      labels,
      members,
      sections: [],
      placements: [],
      now,
      preferences: { weekStartsOn: 1 },
    });
    expect(groups.map((group) => [group.title, group.tasks.map((item) => item.id)]))
      .toEqual([["低优先级", ["low"]], ["无优先级", ["note"]]]);
    expect(sortTasks(tasks, "priority", "asc", labels, members, []).map((item) => item.id))
      .toEqual(["note", "low"]);
  });

  it("groups CLI assignees separately from unassigned tasks", () => {
    const groups = groupTasks({
      tasks: [
        task("codex", { cli_assignee: "codex" }),
        task("member", { assignee_id: "u" }),
        task("none"),
      ],
      grouping: "assignee",
      sort: "assignee",
      direction: "asc",
      labels,
      members,
      sections: [],
      placements: [],
      now,
      preferences: { weekStartsOn: 1 },
    });
    expect(groups.map((group) => [group.title, group.tasks.map((item) => item.id)]))
      .toEqual([
        ["Codex", ["codex"]],
        ["张三", ["member"]],
        ["未指派", ["none"]],
      ]);
  });

  it("keeps the assigned-to-me view limited to real users", () => {
    const result = filterTasksForView({
      tasks: [
        task("mine", { assignee_id: "u" }),
        task("cli", { cli_assignee: "codex" }),
        task("none"),
      ],
      smartView: "assigned",
      selectedLabelId: null,
      currentUserId: "u",
    });
    expect(result.map((item) => item.id)).toEqual(["mine"]);
  });

  it("filters trash tasks by deleted_at and excludes them from other views", () => {
    const tasks = [
      task("alive"),
      task("recent-trash", { deleted_at: "2026-07-28T00:00:00.000Z" }),
      task("older-trash", { deleted_at: "2026-07-20T00:00:00.000Z" }),
      task("inbox", { label_ids: [] }),
      task("labeled", { label_ids: ["a"] }),
    ];
    expect(
      filterTasksForView({
        tasks,
        smartView: "trash",
        selectedLabelId: null,
        currentUserId: "u",
      }).map((item) => item.id),
    ).toEqual(["recent-trash", "older-trash"]);
    expect(
      filterTasksForView({
        tasks,
        smartView: "all",
        selectedLabelId: null,
        currentUserId: "u",
      }).map((item) => item.id),
    ).toEqual(["alive", "inbox", "labeled"]);
    expect(
      filterTasksForView({
        tasks,
        smartView: "inbox",
        selectedLabelId: null,
        currentUserId: "u",
      }).map((item) => item.id),
    ).toEqual(["alive", "inbox"]);
  });
});
