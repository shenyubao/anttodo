import { describe, expect, it } from "vitest";
import type { Label, Member, Task } from "../types";
import { groupTasks, resolveTaskListPreference, sortTasks } from "./taskList";

const now = new Date("2026-07-30T12:00:00+08:00");
const labels: Label[] = [
  { id: "a", workspace_id: "w", parent_id: null, name: "甲", color: "#aaa", visibility: "workspace", inherit_permissions: false, position: 0, created_by: "u" },
  { id: "b", workspace_id: "w", parent_id: null, name: "乙", color: "#bbb", visibility: "workspace", inherit_permissions: false, position: 1, created_by: "u" },
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
  subtasks: [],
  ...patch,
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
    }], "all").grouping).toBe("none");
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
});
