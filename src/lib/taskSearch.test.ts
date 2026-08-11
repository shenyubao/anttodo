import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { normalizeTaskQuery, searchTasks } from "./taskSearch";

function task(id: string, title: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    workspace_id: "workspace",
    title,
    description: "",
    status: "open",
    priority: "none",
    due_at: null,
    due_start_at: null,
    due_is_all_day: false,
    due_timezone: null,
    assignee_id: null,
    created_by: "user",
    completed_at: null,
    deleted_at: null,
    version: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
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
    estimate_pomodoros: patch.estimate_pomodoros ?? null,
    actual_pomodoros: patch.actual_pomodoros ?? null,
    description_mentions: patch.description_mentions ?? [],
  };
}

describe("task search", () => {
  const tasks = [
    task("title", "完成 AntTodo 项目框架验收"),
    task("description", "整理验收材料", {
      description: "验证 Web、Mac 桌面端与 Supabase 权限。",
    }),
    task("completed", "Archive Release Notes", {
      status: "completed",
      completed_at: "2026-01-02T00:00:00.000Z",
    }),
    task("deleted", "已删除任务", {
      deleted_at: "2026-01-03T00:00:00.000Z",
    }),
  ];

  it("normalizes surrounding whitespace and letter case", () => {
    expect(normalizeTaskQuery("  AntTODO  ")).toBe("anttodo");
  });

  it("matches task titles and descriptions", () => {
    expect(searchTasks(tasks, "AntTodo").map((item) => item.id)).toEqual(["title"]);
    expect(searchTasks(tasks, "Supabase").map((item) => item.id)).toEqual([
      "description",
    ]);
  });

  it("matches completed tasks without case sensitivity", () => {
    expect(searchTasks(tasks, "release notes").map((item) => item.id)).toEqual([
      "completed",
    ]);
  });

  it("returns no results for blank queries and excludes deleted tasks", () => {
    expect(searchTasks(tasks, "   ")).toEqual([]);
    expect(searchTasks(tasks, "已删除任务")).toEqual([]);
  });
});
