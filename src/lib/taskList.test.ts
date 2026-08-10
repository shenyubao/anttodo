import { describe, expect, it } from "vitest";
import type { Label, Member, Task } from "../types";
import {
  applyTaskListFilters,
  clampGroupingForViewMode,
  filterTasksForView,
  groupingOptionsForViewMode,
  groupTasks,
  orderedTaskSections,
  resolveTaskListFilters,
  resolveTaskListPreference,
  SMART_VIEW_FILTER_PRESETS,
  sortTasks,
  TASK_GROUPING_OPTIONS,
  taskOrdersAfterCrossSectionMove,
  taskSectionOrderAfterInsert,
  taskSectionOrderAfterMove,
  TIMELINE_GROUPING_OPTIONS,
} from "./taskList";

const now = new Date("2026-07-30T12:00:00+08:00");
const labels: Label[] = [
  { id: "a", workspace_id: "w", parent_id: null, name: "甲", color: "#aaa", kind: "team", view_scope: "all", manage_scope: "users", inherit_permissions: false, position: 0, created_by: "u" },
  { id: "b", workspace_id: "w", parent_id: null, name: "乙", color: "#bbb", kind: "team", view_scope: "all", manage_scope: "users", inherit_permissions: false, position: 1, created_by: "u" },
];
const treeLabels: Label[] = [
  { id: "work", workspace_id: "w", parent_id: null, name: "工作", color: "#111", kind: "team", view_scope: "all", manage_scope: "users", inherit_permissions: false, position: 0, created_by: "u" },
  { id: "front", workspace_id: "w", parent_id: "work", name: "前端", color: "#222", kind: "team", view_scope: "all", manage_scope: "users", inherit_permissions: true, position: 0, created_by: "u" },
  { id: "react", workspace_id: "w", parent_id: "front", name: "React", color: "#333", kind: "team", view_scope: "all", manage_scope: "users", inherit_permissions: true, position: 0, created_by: "u" },
  { id: "vue", workspace_id: "w", parent_id: "front", name: "Vue", color: "#444", kind: "team", view_scope: "all", manage_scope: "users", inherit_permissions: true, position: 1, created_by: "u" },
  { id: "back", workspace_id: "w", parent_id: "work", name: "后端", color: "#555", kind: "team", view_scope: "all", manage_scope: "users", inherit_permissions: true, position: 1, created_by: "u" },
  { id: "life", workspace_id: "w", parent_id: null, name: "生活", color: "#666", kind: "team", view_scope: "all", manage_scope: "users", inherit_permissions: false, position: 1, created_by: "u" },
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
  estimate_hours: patch.estimate_hours ?? null,
  actual_hours: patch.actual_hours ?? null,
  description_mentions: patch.description_mentions ?? [],
});

describe("task list grouping and sorting", () => {
  it("keeps the default ungrouped view and restores a saved custom preference", () => {
    expect(resolveTaskListPreference([], "all").grouping).toBe("none");
    expect(resolveTaskListPreference([{
      user_id: "u",
      workspace_id: "w",
      list_key: "all",
      grouping: "custom",
      sort: "custom",
      direction: "asc",
      filter_assignee: "all",
      filter_watching: "all",
      filter_creator: "all",
      filter_due: "all",
      show_labels: false,
      show_completed: false,
      show_hours: false,
      view_mode: "list",
    }], "all").grouping).toBe("custom");
  });

  it("defaults parent label views to label grouping when unsaved", () => {
    expect(resolveTaskListPreference([], "label:work", treeLabels).grouping).toBe("label");
    expect(resolveTaskListPreference([], "label:react", treeLabels).grouping).toBe("none");
    expect(resolveTaskListPreference([{
      user_id: "u",
      workspace_id: "w",
      list_key: "label:work",
      grouping: "priority",
      sort: "custom",
      direction: "asc",
      filter_assignee: "all",
      filter_watching: "all",
      filter_creator: "all",
      filter_due: "all",
      show_labels: false,
      show_completed: false,
      show_hours: false,
      view_mode: "list",
    }], "label:work", treeLabels).grouping).toBe("priority");
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
      filter_assignee: "all",
      filter_watching: "all",
      filter_creator: "all",
      filter_due: "all",
      show_labels: false,
      show_completed: true,
      show_hours: false,
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
      filter_assignee: "all",
      filter_watching: "all",
      filter_creator: "all",
      filter_due: "all",
      show_labels: false,
      show_completed: false,
      show_hours: false,
      view_mode: "kanban",
    }], "all").view_mode).toBe("kanban");
  });

  it("defaults unsaved kanban views to custom grouping", () => {
    expect(resolveTaskListPreference([], "all", [], "kanban").grouping).toBe("custom");
    expect(resolveTaskListPreference([], "label:work", treeLabels, "kanban").grouping)
      .toBe("custom");
    expect(resolveTaskListPreference([{
      user_id: "u",
      workspace_id: "w",
      list_key: "all",
      grouping: "priority",
      sort: "custom",
      direction: "asc",
      filter_assignee: "all",
      filter_watching: "all",
      filter_creator: "all",
      filter_due: "all",
      show_labels: false,
      show_completed: false,
      show_hours: false,
      view_mode: "kanban",
    }], "all", [], "kanban").grouping).toBe("priority");
  });

  it("limits timeline grouping to custom, label, priority, and none", () => {
    expect(TIMELINE_GROUPING_OPTIONS.map((option) => option.value)).toEqual([
      "custom",
      "label",
      "priority",
      "none",
    ]);
    expect(groupingOptionsForViewMode("timeline").map((option) => option.value))
      .toEqual(["custom", "label", "priority", "none"]);
    expect(groupingOptionsForViewMode("list")).toEqual(TASK_GROUPING_OPTIONS);
    expect(clampGroupingForViewMode("due", "timeline")).toBe("none");
    expect(clampGroupingForViewMode("assignee", "timeline")).toBe("none");
    expect(clampGroupingForViewMode("created", "timeline")).toBe("none");
    expect(clampGroupingForViewMode("label", "timeline")).toBe("label");
    expect(clampGroupingForViewMode("priority", "timeline")).toBe("priority");
    expect(clampGroupingForViewMode("custom", "timeline")).toBe("custom");
    expect(clampGroupingForViewMode("none", "timeline")).toBe("none");
    expect(clampGroupingForViewMode("none", "kanban")).toBe("custom");
    expect(clampGroupingForViewMode("due", "list")).toBe("due");
  });

  it("defaults show_hours to false and preserves a saved value", () => {
    expect(resolveTaskListPreference([], "all").show_hours).toBe(false);
    expect(resolveTaskListPreference([{
      user_id: "u",
      workspace_id: "w",
      list_key: "all",
      grouping: "none",
      sort: "custom",
      direction: "asc",
      filter_assignee: "all",
      filter_watching: "all",
      filter_creator: "all",
      filter_due: "all",
      show_labels: false,
      show_completed: false,
      show_hours: true,
      view_mode: "list",
    }], "all").show_hours).toBe(true);
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

  it("flattens multi-level labels into leaf groups and buckets intermediate tasks", () => {
    const groups = groupTasks({
      tasks: [
        task("react", { label_ids: ["react"] }),
        task("vue", { label_ids: ["vue"] }),
        task("back", { label_ids: ["back"] }),
        task("front-only", { label_ids: ["front"] }),
        task("work-only", { label_ids: ["work"] }),
        task("life", { label_ids: ["life"] }),
        task("both-leaves", { label_ids: ["react", "vue"] }),
      ],
      grouping: "label",
      sort: "title",
      direction: "asc",
      labels: treeLabels,
      members,
      sections: [],
      placements: [],
      now,
      preferences: { weekStartsOn: 1 },
      selectedLabelId: "work",
    });
    expect(groups.map((group) => [group.id, group.title, group.tasks.map((item) => item.id)]))
      .toEqual([
        ["label:react", "React", ["both-leaves", "react"]],
        ["label:vue", "Vue", ["both-leaves", "vue"]],
        ["label:back", "后端", ["back"]],
        ["label:intermediate", "工作", ["front-only", "work-only"]],
      ]);
  });

  it("includes descendant label tasks when filtering a parent label view", () => {
    const tasks = [
      task("react", { label_ids: ["react"] }),
      task("front", { label_ids: ["front"] }),
      task("work", { label_ids: ["work"] }),
      task("life", { label_ids: ["life"] }),
    ];
    expect(
      filterTasksForView({
        tasks,
        labels: treeLabels,
        smartView: "all",
        selectedLabelId: "work",
      }).map((item) => item.id),
    ).toEqual(["react", "front", "work"]);
    expect(
      filterTasksForView({
        tasks,
        labels: treeLabels,
        smartView: "all",
        selectedLabelId: "front",
      }).map((item) => item.id),
    ).toEqual(["react", "front"]);
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

  it("always keeps a fixed ungrouped bucket and preserves empty custom sections", () => {
    const groups = groupTasks({
      tasks: [],
      grouping: "custom",
      sort: "custom",
      direction: "asc",
      labels,
      members,
      sections: [
        { id: "later", workspace_id: "w", list_key: "all", name: "稍后", position: 1, created_by: "u" },
        { id: "first", workspace_id: "w", list_key: "all", name: "先做", position: 0, created_by: "u" },
      ],
      placements: [],
      now,
      preferences: { weekStartsOn: 1 },
    });
    expect(groups.map((group) => [group.id, group.title, group.tasks.length])).toEqual([
      ["section:ungrouped", "未分组", 0],
      ["section:first", "先做", 0],
      ["section:later", "稍后", 0],
    ]);
  });

  it("orders sections deterministically and moves ordinary sections", () => {
    const sections = [
      { id: "c", workspace_id: "w", list_key: "all", name: "丙", position: 2, created_by: "u" },
      { id: "b", workspace_id: "w", list_key: "all", name: "乙", position: 1, created_by: "u" },
      { id: "a", workspace_id: "w", list_key: "all", name: "甲", position: 1, created_by: "u" },
    ];
    expect(orderedTaskSections(sections).map((section) => section.id)).toEqual(["a", "b", "c"]);
    expect(taskSectionOrderAfterMove(sections, "c", "a")).toEqual(["c", "a", "b"]);
    expect(taskSectionOrderAfterMove(sections, "missing", "a")).toEqual(["a", "b", "c"]);
    expect(taskSectionOrderAfterInsert(sections, "new", 1)).toEqual(["a", "new", "b", "c"]);
  });

  it("computes the same cross-section task order for list and kanban moves", () => {
    expect(taskOrdersAfterCrossSectionMove({
      sourceTaskIds: ["one", "move", "two"],
      targetTaskIds: ["three", "four"],
      taskId: "move",
      targetIndex: 1,
    })).toEqual({
      sourceTaskIds: ["one", "two"],
      targetTaskIds: ["three", "move", "four"],
    });
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
        labels,
        smartView: "trash",
        selectedLabelId: null,
      }).map((item) => item.id),
    ).toEqual(["recent-trash", "older-trash"]);
    expect(
      filterTasksForView({
        tasks,
        labels,
        smartView: "all",
        selectedLabelId: null,
      }).map((item) => item.id),
    ).toEqual(["alive", "inbox", "labeled"]);
    expect(
      filterTasksForView({
        tasks,
        labels,
        smartView: "inbox",
        selectedLabelId: null,
      }).map((item) => item.id),
    ).toEqual(["alive", "inbox"]);
  });

  it("leaves smart filter views unfiltered before applyTaskListFilters", () => {
    const tasks = [
      task("mine", { assignee_id: "u" }),
      task("other"),
    ];
    expect(
      filterTasksForView({
        tasks,
        labels,
        smartView: "assigned",
        selectedLabelId: null,
      }).map((item) => item.id),
    ).toEqual(["mine", "other"]);
  });
});

describe("task list preference filters", () => {
  it("defaults filter fields when preference rows omit them", () => {
    const preference = resolveTaskListPreference([], "all");
    expect(preference.filter_assignee).toBe("all");
    expect(preference.filter_watching).toBe("all");
    expect(preference.filter_creator).toBe("all");
    expect(preference.filter_due).toBe("all");
  });

  it("uses fixed filter presets for today, week, assigned, watching, and inbox smart views", () => {
    expect(resolveTaskListPreference([], "today")).toMatchObject(SMART_VIEW_FILTER_PRESETS.today);
    expect(resolveTaskListPreference([], "week")).toMatchObject(SMART_VIEW_FILTER_PRESETS.week);
    expect(resolveTaskListPreference([], "assigned")).toMatchObject(
      SMART_VIEW_FILTER_PRESETS.assigned,
    );
    expect(resolveTaskListPreference([], "watching")).toMatchObject(
      SMART_VIEW_FILTER_PRESETS.watching,
    );
    expect(resolveTaskListPreference([], "inbox")).toMatchObject(
      SMART_VIEW_FILTER_PRESETS.inbox,
    );
    expect(resolveTaskListFilters("assigned", {
      filter_assignee: "all",
      filter_watching: "all",
      filter_creator: "all",
      filter_due: "today",
    })).toEqual(SMART_VIEW_FILTER_PRESETS.assigned);

    const tasks = [
      task("mine-today", {
        assignee_id: "u",
        due_at: "2026-07-30T15:59:59.999Z",
        due_is_all_day: true,
      }),
      task("mine-later", {
        assignee_id: "u",
        due_at: "2026-08-10T15:59:59.999Z",
        due_is_all_day: true,
      }),
      task("watching-only", { participant_ids: ["u"] }),
      task("other"),
      task("created-by-other", { created_by: "other" }),
    ];
    const today = SMART_VIEW_FILTER_PRESETS.today;
    expect(
      applyTaskListFilters({
        tasks,
        filterAssignee: today.filter_assignee,
        filterWatching: today.filter_watching,
        filterCreator: today.filter_creator,
        filterDue: today.filter_due,
        currentUserId: "u",
        now,
      }).map((item) => item.id),
    ).toEqual(["mine-today"]);
    const assigned = SMART_VIEW_FILTER_PRESETS.assigned;
    expect(
      applyTaskListFilters({
        tasks,
        filterAssignee: assigned.filter_assignee,
        filterWatching: assigned.filter_watching,
        filterCreator: assigned.filter_creator,
        filterDue: assigned.filter_due,
        currentUserId: "u",
        now,
      }).map((item) => item.id),
    ).toEqual(["mine-today", "mine-later"]);
    const week = SMART_VIEW_FILTER_PRESETS.week;
    expect(
      applyTaskListFilters({
        tasks: [
          task("week-start", {
            assignee_id: "u",
            due_at: "2026-07-26T16:00:00.000Z",
            due_is_all_day: true,
          }),
          task("week-end", {
            assignee_id: "u",
            due_at: "2026-08-02T15:59:59.999Z",
            due_is_all_day: true,
          }),
          task("next-week", {
            assignee_id: "u",
            due_at: "2026-08-02T16:00:00.000Z",
            due_is_all_day: true,
          }),
          task("other-assignee", {
            assignee_id: "other",
            due_at: "2026-07-30T15:59:59.999Z",
            due_is_all_day: true,
          }),
        ],
        filterAssignee: week.filter_assignee,
        filterDue: week.filter_due,
        currentUserId: "u",
        now,
        weekStartsOn: 1,
      }).map((item) => item.id),
    ).toEqual(["week-start", "week-end"]);
    const watching = SMART_VIEW_FILTER_PRESETS.watching;
    expect(
      applyTaskListFilters({
        tasks,
        filterAssignee: watching.filter_assignee,
        filterWatching: watching.filter_watching,
        filterCreator: watching.filter_creator,
        filterDue: watching.filter_due,
        currentUserId: "u",
        now,
      }).map((item) => item.id),
    ).toEqual(["watching-only"]);
    const inbox = SMART_VIEW_FILTER_PRESETS.inbox;
    expect(
      applyTaskListFilters({
        tasks,
        filterAssignee: inbox.filter_assignee,
        filterWatching: inbox.filter_watching,
        filterCreator: inbox.filter_creator,
        filterDue: inbox.filter_due,
        currentUserId: "u",
        now,
      }).map((item) => item.id),
    ).toEqual(["mine-today", "mine-later", "watching-only", "other"]);
  });

  it("filters by assignee, watching, and creator independently", () => {
    const tasks = [
      task("mine", { assignee_id: "u" }),
      task("watching", { participant_ids: ["u"] }),
      task("both", { assignee_id: "u", participant_ids: ["u"] }),
      task("created-by-other", { created_by: "other", assignee_id: "u" }),
      task("other", { assignee_id: "other", participant_ids: ["other"], created_by: "other" }),
    ];
    expect(
      applyTaskListFilters({
        tasks,
        filterAssignee: "assigned_to_me",
        currentUserId: "u",
        now,
      }).map((item) => item.id),
    ).toEqual(["mine", "both", "created-by-other"]);
    expect(
      applyTaskListFilters({
        tasks,
        filterWatching: "watching",
        currentUserId: "u",
        now,
      }).map((item) => item.id),
    ).toEqual(["watching", "both"]);
    expect(
      applyTaskListFilters({
        tasks,
        filterCreator: "created_by_me",
        currentUserId: "u",
        now,
      }).map((item) => item.id),
    ).toEqual(["mine", "watching", "both"]);
    expect(
      applyTaskListFilters({
        tasks,
        filterAssignee: "assigned_to_me",
        filterWatching: "watching",
        currentUserId: "u",
        now,
      }).map((item) => item.id),
    ).toEqual(["both"]);
  });

  it("filters due windows and treats timed overdue separately from today", () => {
    const tasks = [
      task("overdue-day", {
        due_at: "2026-07-29T15:59:59.999Z",
        due_is_all_day: true,
      }),
      task("overdue-timed", {
        due_at: "2026-07-30T02:00:00.000Z",
        due_is_all_day: false,
      }),
      task("today", {
        due_at: "2026-07-30T15:59:59.999Z",
        due_is_all_day: true,
      }),
      task("tomorrow", {
        due_at: "2026-07-31T15:59:59.999Z",
        due_is_all_day: true,
      }),
      task("day6", {
        due_at: "2026-08-05T15:59:59.999Z",
        due_is_all_day: true,
      }),
      task("day7", {
        due_at: "2026-08-06T15:59:59.999Z",
        due_is_all_day: true,
      }),
      task("day29", {
        due_at: "2026-08-28T15:59:59.999Z",
        due_is_all_day: true,
      }),
      task("day30", {
        due_at: "2026-08-29T15:59:59.999Z",
        due_is_all_day: true,
      }),
      task("none"),
    ];

    expect(
      applyTaskListFilters({
        tasks,
        filterDue: "overdue",
        currentUserId: "u",
        now,
      }).map((item) => item.id),
    ).toEqual(["overdue-day", "overdue-timed"]);
    expect(
      applyTaskListFilters({
        tasks,
        filterDue: "today",
        currentUserId: "u",
        now,
      }).map((item) => item.id),
    ).toEqual(["today"]);
    expect(
      applyTaskListFilters({
        tasks,
        filterDue: "tomorrow",
        currentUserId: "u",
        now,
      }).map((item) => item.id),
    ).toEqual(["tomorrow"]);
    expect(
      applyTaskListFilters({
        tasks,
        filterDue: "next_7_days",
        currentUserId: "u",
        now,
      }).map((item) => item.id),
    ).toEqual(["overdue-timed", "today", "tomorrow", "day6"]);
    expect(
      applyTaskListFilters({
        tasks,
        filterDue: "next_30_days",
        currentUserId: "u",
        now,
      }).map((item) => item.id),
    ).toEqual(["overdue-timed", "today", "tomorrow", "day6", "day7", "day29"]);
  });

  it("applies assignee and due filters together", () => {
    const result = applyTaskListFilters({
      tasks: [
        task("mine-today", {
          assignee_id: "u",
          due_at: "2026-07-30T15:59:59.999Z",
          due_is_all_day: true,
        }),
        task("mine-later", {
          assignee_id: "u",
          due_at: "2026-08-10T15:59:59.999Z",
          due_is_all_day: true,
        }),
        task("other-today", {
          assignee_id: "other",
          due_at: "2026-07-30T15:59:59.999Z",
          due_is_all_day: true,
        }),
      ],
      filterAssignee: "assigned_to_me",
      filterDue: "today",
      currentUserId: "u",
      now,
    });
    expect(result.map((item) => item.id)).toEqual(["mine-today"]);
  });
});
