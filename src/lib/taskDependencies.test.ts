import { describe, expect, it } from "vitest";
import {
  filterPickerTasksForDependency,
  wouldCreateDependencyCycle,
} from "./taskDependencies";
import type { Task, TaskDependency } from "../types";

function task(patch: Partial<Task> = {}): Task {
  return {
    id: "t1",
    workspace_id: "ws",
    title: "任务",
    description: "",
    status: "open",
    priority: "none",
    kind: "todo",
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
    completed_at: null,
    deleted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    created_by: "u1",
    version: 1,
    label_ids: [],
    participant_ids: [],
    description_mentions: [],
    children: [],
    reminders: [],
    reminder_persistent: false,
    dependencies: [],
    ...patch,
    parent_task_id: patch.parent_task_id ?? null,
    position: patch.position ?? 0,
  };
}

function childTask(patch: Partial<Task> = {}): Task {
  return task({
    id: "s1",
    parent_task_id: "t1",
    title: "子级任务",
    position: 0,
    ...patch,
  });
}

function edge(
  successor: { taskId: string },
  predecessor: { taskId: string },
): TaskDependency {
  return {
    id: `${successor.taskId}-${predecessor.taskId}`,
    workspace_id: "ws",
    task_id: successor.taskId,
    depends_on_task_id: predecessor.taskId,
    position: 0,
    created_by: "u1",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("task dependencies", () => {
  it("rejects self and existing cycles", () => {
    const a = task({ id: "a", dependencies: [edge({ taskId: "a" }, { taskId: "b" })] });
    const b = task({ id: "b", dependencies: [edge({ taskId: "b" }, { taskId: "c" })] });
    const c = task({ id: "c" });
    expect(wouldCreateDependencyCycle([a, b, c], { taskId: "a" }, { taskId: "a" })).toBe(true);
    expect(wouldCreateDependencyCycle([a, b, c], { taskId: "c" }, { taskId: "a" })).toBe(true);
    expect(wouldCreateDependencyCycle([a, b, c], { taskId: "a" }, { taskId: "c" })).toBe(false);
  });

  it("hides the current item, notes, and already attached predecessors", () => {
    const note = task({ id: "note", kind: "note", title: "笔记" });
    const current = task({
      id: "current",
      dependencies: [edge({ taskId: "current" }, { taskId: "linked" })],
      children: [childTask({ id: "child", parent_task_id: "current" })],
    });
    const linked = task({ id: "linked", title: "已挂载" });
    const other = task({ id: "other", title: "可选", children: [childTask({ id: "other-child", parent_task_id: "other" })] });
    const filtered = filterPickerTasksForDependency(
      [note, current, linked, other],
      { taskId: "current" },
      current.dependencies,
    );
    expect(filtered.map((item) => item.id).sort()).toEqual(["other"]);
    expect(filtered.find((item) => item.id === "other")?.children.map((item) => item.id)).toEqual(["other-child"]);
  });
});
