import { describe, expect, it } from "vitest";
import {
  filterPickerTasksForDependency,
  wouldCreateDependencyCycle,
} from "./taskDependencies";
import type { Subtask, Task, TaskDependency } from "../types";

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
    subtasks: [],
    reminders: [],
    reminder_persistent: false,
    dependencies: [],
    ...patch,
  };
}

function subtask(patch: Partial<Subtask> = {}): Subtask {
  return {
    id: "s1",
    task_id: "t1",
    parent_subtask_id: null,
    title: "子任务",
    description: "",
    completed: false,
    position: 0,
    priority: "none",
    due_at: null,
    due_start_at: null,
    due_is_all_day: false,
    due_timezone: null,
    estimate_hours: null,
    actual_hours: null,
    estimate_pomodoros: null,
    actual_pomodoros: null,
    assignee_id: null,
    cli_assignee: null,
    created_by: "u1",
    reminders: [],
    reminder_persistent: false,
    dependencies: [],
    ...patch,
  };
}

function edge(
  successor: { taskId: string; subtaskId?: string | null },
  predecessor: { taskId: string; subtaskId?: string | null },
): TaskDependency {
  return {
    id: `${successor.taskId}-${predecessor.taskId}`,
    workspace_id: "ws",
    task_id: successor.taskId,
    subtask_id: successor.subtaskId ?? null,
    depends_on_task_id: predecessor.taskId,
    depends_on_subtask_id: predecessor.subtaskId ?? null,
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
    expect(wouldCreateDependencyCycle([a, b, c], { taskId: "a", subtaskId: null }, { taskId: "a", subtaskId: null })).toBe(true);
    expect(wouldCreateDependencyCycle([a, b, c], { taskId: "c", subtaskId: null }, { taskId: "a", subtaskId: null })).toBe(true);
    expect(wouldCreateDependencyCycle([a, b, c], { taskId: "a", subtaskId: null }, { taskId: "c", subtaskId: null })).toBe(false);
  });

  it("hides the current item, notes, and already attached predecessors", () => {
    const note = task({ id: "note", kind: "note", title: "笔记" });
    const current = task({
      id: "current",
      dependencies: [edge({ taskId: "current" }, { taskId: "linked" })],
      subtasks: [subtask({ id: "child", task_id: "current" })],
    });
    const linked = task({ id: "linked", title: "已挂载" });
    const other = task({ id: "other", title: "可选", subtasks: [subtask({ id: "other-child", task_id: "other" })] });
    const filtered = filterPickerTasksForDependency(
      [note, current, linked, other],
      { taskId: "current", subtaskId: null },
      current.dependencies,
    );
    expect(filtered.map((item) => item.id).sort()).toEqual(["current", "other"]);
    expect(filtered.find((item) => item.id === "current")?.subtasks.map((item) => item.id)).toEqual(["child"]);
    expect(filtered.find((item) => item.id === "other")?.subtasks.map((item) => item.id)).toEqual(["other-child"]);
  });
});
