import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import {
  appendWeeklyReportTaskLines,
  canCreateWeeklyReportForWeek,
  defaultWeeklyReportTaskFilters,
  filterWeeklyReportPickerTasks,
  parseWeeklyReportTextParts,
  shiftWeeklyReportWeek,
  weeklyReportPublishError,
  weeklyReportWeekMeta,
  weeklyReportWeekStart,
} from "./weeklyReports";

function taskUrl(id = "task-1", workspaceId = "workspace-1") {
  return `https://app.anttodo.com/workspaces/${workspaceId}/tasks/${id}`;
}

function linked(title: string, id = "task-1") {
  return `[${title}](${taskUrl(id)})`;
}

function task(patch: Partial<Task>): Task {
  return {
    id: "task-1",
    workspace_id: "workspace-1",
    parent_task_id: null,
    position: 0,
    title: "发布周报",
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
    created_by: "user-1",
    completed_at: null,
    deleted_at: null,
    version: 1,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    external_id: null,
    connector_id: null,
    connector_platform: null,
    label_ids: [],
    participant_ids: [],
    children: [],
    reminders: [],
    reminder_persistent: false,
    description_mentions: [],
    ...patch,
  };
}

describe("weekly report weeks", () => {
  it("uses Monday-to-Sunday ISO weeks across year boundaries", () => {
    expect(weeklyReportWeekStart(new Date(2026, 0, 1, 12))).toBe("2025-12-29");
    expect(weeklyReportWeekMeta("2025-12-29")).toEqual({
      week: 1,
      year: 2026,
      range: "12月29日–1月4日",
    });
    expect(shiftWeeklyReportWeek("2025-12-29", 1)).toBe("2026-01-05");
  });

  it("only permits the current or previous week for creation", () => {
    const now = new Date(2026, 8, 4, 12);
    expect(canCreateWeeklyReportForWeek("2026-08-31", now)).toBe(true);
    expect(canCreateWeeklyReportForWeek("2026-08-24", now)).toBe(true);
    expect(canCreateWeeklyReportForWeek("2026-08-17", now)).toBe(false);
    expect(canCreateWeeklyReportForWeek("2026-09-07", now)).toBe(false);
  });
});

describe("weekly report task helpers", () => {
  const tasks = [
    task({ id: "completed", status: "completed", completed_at: "2026-09-03T03:00:00.000Z", due_at: "2026-09-05T03:00:00.000Z", assignee_id: "user-1" }),
    task({ id: "old", status: "completed", completed_at: "2026-08-20T03:00:00.000Z", due_at: "2026-09-12T03:00:00.000Z", assignee_id: "user-1" }),
    task({ id: "open", status: "open", due_at: "2026-09-12T03:00:00.000Z", assignee_id: "user-1" }),
    task({ id: "unassigned", status: "open", due_at: "2026-09-06T03:00:00.000Z" }),
    task({ id: "undated", status: "open", assignee_id: "user-1" }),
    task({ id: "cancelled", status: "cancelled" }),
    task({ id: "note", kind: "note" }),
    task({ id: "deleted", deleted_at: "2026-09-04T00:00:00.000Z" }),
  ];

  it("uses section-specific time defaults and assigns to me by default", () => {
    expect(defaultWeeklyReportTaskFilters("completed")).toEqual({
      time: "through_this_week",
      assignee: "me",
    });
    expect(defaultWeeklyReportTaskFilters("next_plan")).toEqual({
      time: "through_next_week",
      assignee: "me",
    });
  });

  it("filters picker tasks by section, due cutoff, and assignee", () => {
    const base = { weekStart: "2026-08-31", currentUserId: "user-1" };
    expect(filterWeeklyReportPickerTasks(tasks, {
      ...base, section: "completed", time: "through_this_week", assignee: "me",
    }).map((item) => item.id))
      .toEqual(["completed"]);
    expect(filterWeeklyReportPickerTasks(tasks, {
      ...base, section: "next_plan", time: "through_next_week", assignee: "me",
    }).map((item) => item.id))
      .toEqual(["open"]);
    expect(filterWeeklyReportPickerTasks(tasks, {
      ...base, section: "next_plan", time: "through_this_week", assignee: "unassigned",
    }).map((item) => item.id))
      .toEqual(["unassigned"]);
    expect(filterWeeklyReportPickerTasks(tasks, {
      ...base, section: "next_plan", time: "all", assignee: "all",
    }).map((item) => item.id))
      .toEqual(["open", "unassigned", "undated"]);
  });

  it("appends generated lines after hand-written text", () => {
    expect(appendWeeklyReportTaskLines("手写总结  \n", [task({ title: "上线" })], "completed"))
      .toBe(`手写总结\n\n## 收集箱\n- 完成了 ${linked("上线")}`);
    expect(appendWeeklyReportTaskLines("", [task({ title: "验收" })], "next_plan"))
      .toBe(`## 收集箱\n- 计划完成 ${linked("验收")}`);
    expect(appendWeeklyReportTaskLines("", [task({ title: "含`符号" })], "completed"))
      .toBe(`## 收集箱\n- 完成了 ${linked("含`符号")}`);
  });

  it("groups generated task lines by their labels", () => {
    const labels = [
      { id: "product", name: "产品" },
      { id: "frontend", name: "前端" },
    ];
    expect(appendWeeklyReportTaskLines("", [
      task({ id: "one", title: "完善需求", label_ids: ["product"] }),
      task({ id: "two", title: "修复样式", label_ids: ["frontend"] }),
      task({ id: "three", title: "联调", label_ids: ["product", "frontend"] }),
    ], "completed", labels)).toBe([
      "## 产品",
      `- 完成了 ${linked("完善需求", "one")}`,
      "",
      "## 前端",
      `- 完成了 ${linked("修复样式", "two")}`,
      "",
      "## 产品 / 前端",
      `- 完成了 ${linked("联调", "three")}`,
    ].join("\n"));
  });

  it("includes the parent title when generating a subtask line", () => {
    const labels = [
      { id: "connector", name: "连接器&ISV" },
      { id: "rpa", name: "RPA产品线" },
    ];
    const parent = task({
      id: "parent",
      title: "RPA 连接器入参格式校验+json格式配置+备注",
      label_ids: ["connector", "rpa"],
    });
    const child = task({
      id: "child",
      parent_task_id: "parent",
      title: "连接器入参优化-后端开发",
      label_ids: ["connector", "rpa"],
    });
    const parentLink = linked("RPA 连接器入参格式校验+json格式配置+备注", "parent");
    const childLink = linked("连接器入参优化-后端开发", "child");
    expect(appendWeeklyReportTaskLines("", [parent, child], "completed", labels, [parent, child])).toBe([
      "## 连接器&ISV / RPA产品线",
      `- 完成了 ${parentLink}`,
      `- 完成了 ${parentLink} 下的 ${childLink}`,
    ].join("\n"));
    expect(appendWeeklyReportTaskLines("", [child], "next_plan", labels, [parent, child]))
      .toBe(`## 连接器&ISV / RPA产品线\n- 计划完成 ${parentLink} 下的 ${childLink}`);
  });

  it("parses generated task links for in-app display", () => {
    expect(parseWeeklyReportTextParts(`- 完成了 ${linked("上线")}`)).toEqual([
      { type: "text", value: "- 完成了 " },
      { type: "link", href: taskUrl(), label: "上线" },
    ]);
  });
});

describe("weekly report publish validation", () => {
  it("requires content and a subject for restricted scopes", () => {
    const base = {
      completedText: "",
      nextPlanText: "",
      reflectionText: "",
      visibility: "workspace" as const,
      userIds: [],
      groupIds: [],
    };
    expect(weeklyReportPublishError(base)).toContain("至少填写");
    expect(weeklyReportPublishError({ ...base, completedText: "完成", visibility: "users" })).toContain("用户");
    expect(weeklyReportPublishError({ ...base, completedText: "完成", visibility: "groups" })).toContain("用户组");
    expect(weeklyReportPublishError({ ...base, completedText: "完成" })).toBeNull();
  });
});
