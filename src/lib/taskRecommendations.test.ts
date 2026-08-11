import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import {
  recommendedTasks,
  recommendationDuePatch,
  recommendationFridayAtSixPm,
} from "./taskRecommendations";

const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id,
  workspace_id: "workspace-1",
  title: id,
  description: "",
  status: "open",
  priority: "none",
  due_at: null,
  due_start_at: null,
  due_is_all_day: false,
  due_timezone: null,
  assignee_id: "me",
  created_by: "me",
  completed_at: null,
  deleted_at: null,
  version: 1,
  created_at: "2026-08-03T00:00:00.000Z",
  updated_at: "2026-08-03T00:00:00.000Z",
  label_ids: [],
  participant_ids: [],
  subtasks: [],
  cli_assignee: null,
  kind: "todo",
  reminders: [],
  reminder_persistent: false,
  recurrence: null,
  estimate_hours: null,
  actual_hours: null,
  description_mentions: [],
  ...patch,
  estimate_pomodoros: patch.estimate_pomodoros ?? null,
  actual_pomodoros: patch.actual_pomodoros ?? null,
});

describe("task recommendations", () => {
  it("keeps only open, assigned, undated todo tasks", () => {
    expect(recommendedTasks([
      task("candidate"),
      task("other-assignee", { assignee_id: "other" }),
      task("completed", { status: "completed" }),
      task("deleted", { deleted_at: "2026-08-03T00:00:00.000Z" }),
      task("dated", { due_at: "2026-08-07T10:00:00.000Z" }),
      task("note", { kind: "note" }),
    ], "me").map((item) => item.id)).toEqual(["candidate"]);
  });

  it("calculates Friday at 18:00 within the configured week", () => {
    const monday = new Date(2026, 7, 3, 9, 30);
    const friday = recommendationFridayAtSixPm(monday, 1);
    expect(friday.getDay()).toBe(5);
    expect(friday.getDate()).toBe(7);
    expect(friday.getHours()).toBe(18);
    expect(friday.getMinutes()).toBe(0);

    const sundayStartedWeek = recommendationFridayAtSixPm(
      new Date(2026, 7, 2, 9, 30),
      0,
    );
    expect(sundayStartedWeek.getDay()).toBe(5);
    expect(sundayStartedWeek.getDate()).toBe(7);
    expect(sundayStartedWeek.getHours()).toBe(18);
  });

  it("returns a timed local due-date patch without changing other scheduling fields", () => {
    const patch = recommendationDuePatch(
      new Date(2026, 7, 3, 9, 30),
      1,
      "Asia/Shanghai",
    );
    const dueAt = new Date(patch.due_at!);
    expect(dueAt.getDay()).toBe(5);
    expect(dueAt.getHours()).toBe(18);
    expect(patch.due_start_at).toBeNull();
    expect(patch.due_is_all_day).toBe(false);
    expect(patch.due_timezone).toBe("Asia/Shanghai");
  });
});
