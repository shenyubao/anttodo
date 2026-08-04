import { describe, expect, it } from "vitest";
import type { Label, Member, Task } from "../types";
import {
  buildKanbanColumns,
  kanbanDropAction,
} from "./taskKanban";

const now = new Date("2026-08-03T10:00:00+08:00");
const labels: Label[] = [
  { id: "a", workspace_id: "w", parent_id: null, name: "甲", color: "#f00", kind: "team", view_scope: "all", manage_scope: "all", inherit_permissions: false, position: 0, created_by: "u" },
  { id: "b", workspace_id: "w", parent_id: null, name: "乙", color: "#0f0", kind: "team", view_scope: "all", manage_scope: "all", inherit_permissions: false, position: 1, created_by: "u" },
];
const members: Member[] = [
  { workspace_id: "w", user_id: "u", role: "owner", profile: { id: "u", display_name: "张三", avatar_url: null } },
];
const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id,
  workspace_id: "w",
  title: id,
  description: "",
  kind: "todo",
  status: "open",
  priority: "none",
  due_at: null,
  due_start_at: null,
  due_is_all_day: false,
  due_timezone: null,
  recurrence: null,
  assignee_id: null,
  created_by: "u",
  completed_at: null,
  deleted_at: null,
  version: 1,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  label_ids: [],
  participant_ids: [],
  subtasks: [],
  reminders: [],
  reminder_persistent: false,
  ...patch,
  cli_assignee: patch.cli_assignee ?? null,
});

function columns(grouping: "custom" | "due" | "label" | "priority" | "assignee" | "created" | "none", tasks: Task[], selectedLabelId: string | null = null) {
  return buildKanbanColumns({
    tasks,
    preference: {
      grouping,
      sort: "custom",
      direction: "asc",
      show_completed: true,
    },
    labels,
    members,
    sections: [],
    placements: [],
    now,
    dateTimePreferences: { weekStartsOn: 1 },
    listTitle: "所有",
    selectedLabelId,
  });
}

describe("task kanban", () => {
  it("keeps empty due columns and groups notes with todos", () => {
    const result = columns("due", [
      task("today", { due_at: "2026-08-03T04:00:00.000Z" }),
      task("note", { kind: "note" }),
      task("done", { status: "completed", completed_at: now.toISOString() }),
    ]);
    expect(result.map((column) => column.title)).toEqual([
      "已过期", "今天", "明天", "本周", "以后", "无日期", "已完成",
    ]);
    expect(result.find((column) => column.title === "今天")?.tasks.map((item) => item.id))
      .toEqual(["today"]);
    expect(result.find((column) => column.title === "无日期")?.tasks.map((item) => item.id))
      .toEqual(["note"]);
    expect(result.some((column) => column.id === "notes")).toBe(false);
  });

  it("duplicates multi-label tasks and omits unreachable no-label column in a label view", () => {
    const result = columns("label", [task("both", { label_ids: ["a", "b"] })], "a");
    expect(result.find((column) => column.id === "label:a")?.tasks).toHaveLength(1);
    expect(result.some((column) => column.id === "label:b")).toBe(false);
    expect(result.some((column) => column.id === "label:none")).toBe(false);
  });

  it("uses leaf label columns and an intermediate bucket for nested trees", () => {
    const nested: Label[] = [
      { id: "work", workspace_id: "w", parent_id: null, name: "工作", color: "#111", kind: "team", view_scope: "all", manage_scope: "all", inherit_permissions: false, position: 0, created_by: "u" },
      { id: "front", workspace_id: "w", parent_id: "work", name: "前端", color: "#222", kind: "team", view_scope: "all", manage_scope: "all", inherit_permissions: true, position: 0, created_by: "u" },
      { id: "react", workspace_id: "w", parent_id: "front", name: "React", color: "#333", kind: "team", view_scope: "all", manage_scope: "all", inherit_permissions: true, position: 0, created_by: "u" },
      { id: "back", workspace_id: "w", parent_id: "work", name: "后端", color: "#555", kind: "team", view_scope: "all", manage_scope: "all", inherit_permissions: true, position: 1, created_by: "u" },
    ];
    const result = buildKanbanColumns({
      tasks: [
        task("react", { label_ids: ["react"] }),
        task("front", { label_ids: ["front"] }),
      ],
      preference: {
        grouping: "label",
        sort: "custom",
        direction: "asc",
        show_completed: false,
      },
      labels: nested,
      members,
      sections: [],
      placements: [],
      now,
      dateTimePreferences: { weekStartsOn: 1 },
      listTitle: "工作",
      selectedLabelId: "work",
    });
    expect(result.map((column) => column.id)).toEqual([
      "label:react",
      "label:back",
      "label:intermediate",
    ]);
    expect(result.find((column) => column.id === "label:react")?.tasks.map((item) => item.id))
      .toEqual(["react"]);
    expect(result.find((column) => column.id === "label:intermediate")?.tasks.map((item) => item.id))
      .toEqual(["front"]);
    expect(result.find((column) => column.id === "label:intermediate")?.target)
      .toEqual({ kind: "label", labelId: "work" });
  });

  it("maps writable cross-column drops and rejects immutable columns", () => {
    const due = columns("due", []);
    expect(kanbanDropAction({
      source: due[0],
      target: due[1],
      now,
      weekStartsOn: 1,
    })).toMatchObject({ kind: "schedule" });

    const priority = columns("priority", []);
    expect(kanbanDropAction({
      source: priority[3],
      target: priority[0],
      now,
      weekStartsOn: 1,
    })).toEqual({ kind: "priority", priority: "high" });

    const assignee = columns("assignee", []);
    expect(kanbanDropAction({
      source: assignee[1],
      target: assignee[0],
      now,
      weekStartsOn: 1,
    })).toEqual({ kind: "assignee", assigneeId: "u", cliAssignee: null });

    const labelColumns = columns("label", []);
    expect(kanbanDropAction({
      source: labelColumns[0],
      target: labelColumns[1],
      now,
      weekStartsOn: 1,
    })).toEqual({ kind: "labels", sourceLabelId: "a", targetLabelId: "b" });

    const created = columns("created", []);
    expect(kanbanDropAction({
      source: created[0],
      target: created[1],
      now,
      weekStartsOn: 1,
    })).toBeNull();
  });

  it("uses composite column instances for duplicate tasks", () => {
    const result = columns("label", [task("both", { label_ids: ["a", "b"] })]);
    const instances = result
      .flatMap((column) => column.tasks.map((item) => `${column.id}:${item.id}`));
    expect(instances).toContain("label:a:both");
    expect(instances).toContain("label:b:both");
    expect(new Set(instances).size).toBe(instances.length);
  });

  it("builds custom columns shared by todos, notes, and completed tasks", () => {
    const result = buildKanbanColumns({
      tasks: [
        task("todo", { status: "open" }),
        task("note", { kind: "note" }),
        task("loose"),
        task("done", { status: "completed", completed_at: now.toISOString() }),
      ],
      preference: {
        grouping: "custom",
        sort: "custom",
        direction: "asc",
        show_completed: true,
      },
      labels,
      members,
      sections: [
        { id: "later", workspace_id: "w", list_key: "all", name: "稍后", position: 1, created_by: "u" },
        { id: "first", workspace_id: "w", list_key: "all", name: "先做", position: 0, created_by: "u" },
      ],
      placements: [
        { workspace_id: "w", list_key: "all", task_id: "todo", section_id: "first", position: 0 },
        { workspace_id: "w", list_key: "all", task_id: "done", section_id: "first", position: 1 },
        { workspace_id: "w", list_key: "all", task_id: "note", section_id: "later", position: 0 },
      ],
      now,
      dateTimePreferences: { weekStartsOn: 1 },
      listTitle: "所有",
      selectedLabelId: null,
    });

    expect(result.map((column) => column.id)).toEqual([
      "section:ungrouped",
      "section:first",
      "section:later",
    ]);
    expect(result.find((column) => column.id === "section:ungrouped")?.tasks.map((item) => item.id))
      .toEqual(["loose"]);
    expect(result.find((column) => column.id === "section:later")?.tasks.map((item) => item.id))
      .toEqual(["note"]);
    expect(result.find((column) => column.id === "section:first")?.target)
      .toEqual({ kind: "section", sectionId: "first" });
    expect(result.find((column) => column.id === "section:first")?.tasks.map((item) => item.id))
      .toEqual(["todo", "done"]);
    expect(result.some((column) => column.id === "completed")).toBe(false);
    expect(result.some((column) => column.id === "notes")).toBe(false);

    const hiddenCompleted = buildKanbanColumns({
      tasks: [
        task("todo", { status: "open" }),
        task("done", { status: "completed", completed_at: now.toISOString() }),
      ],
      preference: {
        grouping: "custom",
        sort: "custom",
        direction: "asc",
        show_completed: false,
      },
      labels,
      members,
      sections: [
        { id: "first", workspace_id: "w", list_key: "all", name: "先做", position: 0, created_by: "u" },
      ],
      placements: [
        { workspace_id: "w", list_key: "all", task_id: "todo", section_id: "first", position: 0 },
        { workspace_id: "w", list_key: "all", task_id: "done", section_id: "first", position: 1 },
      ],
      now,
      dateTimePreferences: { weekStartsOn: 1 },
      listTitle: "所有",
      selectedLabelId: null,
    });
    expect(hiddenCompleted.find((column) => column.id === "section:first")?.tasks.map((item) => item.id))
      .toEqual(["todo"]);

    const reopened = buildKanbanColumns({
      tasks: [
        task("todo"),
        task("done"),
      ],
      preference: { grouping: "custom", sort: "custom", direction: "asc", show_completed: true },
      labels,
      members,
      sections: [{ id: "first", workspace_id: "w", list_key: "all", name: "先做", position: 0, created_by: "u" }],
      placements: [
        { workspace_id: "w", list_key: "all", task_id: "todo", section_id: "first", position: 0 },
        { workspace_id: "w", list_key: "all", task_id: "done", section_id: "first", position: 1 },
      ],
      now,
      dateTimePreferences: { weekStartsOn: 1 },
      listTitle: "所有",
      selectedLabelId: null,
    });
    expect(reopened.find((column) => column.id === "section:first")?.tasks.map((item) => item.id))
      .toEqual(["todo", "done"]);
  });

  it("maps custom-column drops to section reassignment", () => {
    const customColumns = buildKanbanColumns({
      tasks: [],
      preference: { grouping: "custom", sort: "custom", direction: "asc", show_completed: false },
      labels,
      members,
      sections: [{ id: "next", workspace_id: "w", list_key: "all", name: "下一步", position: 0, created_by: "u" }],
      placements: [],
      now,
      dateTimePreferences: { weekStartsOn: 1 },
      listTitle: "所有",
      selectedLabelId: null,
    });
    expect(kanbanDropAction({
      source: customColumns[0],
      target: customColumns[1],
      now,
      weekStartsOn: 1,
    })).toEqual({ kind: "section", sourceSectionId: null, targetSectionId: "next" });
  });

  it("adds CLI assignee columns without treating CLI tasks as unassigned", () => {
    const result = columns("assignee", [
      task("cli", { cli_assignee: "codex" }),
      task("none"),
    ]);
    expect(result.find((column) => column.id === "assignee:cli:codex")?.tasks
      .map((item) => item.id)).toEqual(["cli"]);
    expect(result.find((column) => column.id === "assignee:none")?.tasks
      .map((item) => item.id)).toEqual(["none"]);
    const cliColumn = result.find((column) => column.id === "assignee:cli:codex")!;
    const noneColumn = result.find((column) => column.id === "assignee:none")!;
    expect(kanbanDropAction({
      source: noneColumn,
      target: cliColumn,
      now,
      weekStartsOn: 1,
    })).toEqual({ kind: "assignee", assigneeId: null, cliAssignee: "codex" });
  });
});
