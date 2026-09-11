import { describe, expect, it } from "vitest";
import type { Label, MatrixRuleDefinition, Task } from "../types";
import {
  MATRIX_QUADRANT_KEYS,
  defaultMatrixPreference,
  groupMatrixTasks,
  matrixDueBucket,
  resolveMatrixPreferences,
  resolveTaskForMatrixRule,
  sortMatrixTasks,
  taskMatchesMatrixRule,
} from "./taskMatrix";

const now = new Date("2026-09-01T04:00:00.000Z");

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    workspace_id: "workspace",
    parent_task_id: null,
    position: 0,
    title: "任务",
    description: "",
    kind: "todo",
    status: "open",
    priority: "none",
    due_at: null,
    due_start_at: null,
    due_is_all_day: false,
    due_timezone: "Asia/Shanghai",
    recurrence: null,
    estimate_hours: null,
    actual_hours: null,
    estimate_pomodoros: null,
    actual_pomodoros: null,
    assignee_id: "user",
    cli_assignee: null,
    created_by: "user",
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
    ...overrides,
  };
}

describe("matrix defaults and matching", () => {
  const preferences = resolveMatrixPreferences([], "user", "workspace");

  it("builds all four defaults in stable I–IV order", () => {
    expect(preferences.map((item) => item.quadrant_key)).toEqual(MATRIX_QUADRANT_KEYS);
    expect(preferences.map((item) => item.name)).toEqual([
      "重要且紧急",
      "重要不紧急",
      "不重要但紧急",
      "不重要不紧急",
    ]);
    expect(preferences.every((item) => item.definition.assignee === "user")).toBe(true);
  });

  it.each([
    ["important_urgent", task({ priority: "high", due_at: "2026-09-01T10:00:00.000Z" })],
    ["important_not_urgent", task({ priority: "medium", due_at: null })],
    ["not_important_urgent", task({ priority: "low", due_at: "2026-09-02T10:00:00.000Z" })],
    ["not_important_not_urgent", task({ priority: "none", due_at: "2026-09-05T10:00:00.000Z" })],
  ] as const)("matches the %s default", (key, value) => {
    const preference = preferences.find((item) => item.quadrant_key === key)!;
    expect(taskMatchesMatrixRule(value, preference.definition, now)).toBe(true);
  });

  it("uses the task time zone at the calendar-day boundary", () => {
    const boundaryNow = new Date("2026-09-01T23:30:00.000Z");
    const due = "2026-09-02T00:15:00.000Z";
    expect(matrixDueBucket(due, boundaryNow, "UTC")).toBe("tomorrow");
    expect(matrixDueBucket(due, boundaryNow, "Asia/Shanghai")).toBe("today");
  });

  it("treats notes as no-priority and allows overlapping custom rules", () => {
    const note = task({ kind: "note", priority: "high" });
    const rule: MatrixRuleDefinition = {
      labels: "all",
      due: "all",
      priorities: ["none"],
      kinds: ["note"],
      assignee: "all",
    };
    expect(taskMatchesMatrixRule(note, rule, now)).toBe(true);
    expect([rule, rule].filter((item) => taskMatchesMatrixRule(note, item, now))).toHaveLength(2);
  });
});

describe("matrix grouping and sorting", () => {
  const labels: Label[] = [{
    id: "label",
    workspace_id: "workspace",
    parent_id: null,
    name: "产品",
    color: "#4772fa",
    kind: "team",
    view_scope: "all",
    manage_scope: "all",
    inherit_permissions: true,
    position: 0,
    created_by: "user",
  }];

  it("sorts stably and honors direction", () => {
    const first = task({ id: "first", title: "相同", created_at: "2026-08-01T00:00:00Z" });
    const second = task({ id: "second", title: "相同", created_at: "2026-08-02T00:00:00Z" });
    expect(sortMatrixTasks([first, second], "title", "desc").map((item) => item.id))
      .toEqual(["first", "second"]);
    expect(sortMatrixTasks([first, second], "created", "desc").map((item) => item.id))
      .toEqual(["second", "first"]);
  });

  it("keeps completed and cancelled items in the final completed group", () => {
    const groups = groupMatrixTasks([
      task({ id: "active", label_ids: ["label"] }),
      task({ id: "done", status: "completed", completed_at: "2026-09-01T05:00:00Z" }),
      task({ id: "cancelled", status: "cancelled" }),
    ], "label", "title", "asc", labels, now);
    expect(groups.at(-1)?.id).toBe("completed");
    expect(groups.at(-1)?.tasks.map((item) => item.id)).toEqual(["done", "cancelled"]);
  });
});

describe("matrix drag and quick-create resolution", () => {
  it("preserves matching fields and emits only the minimum patch", () => {
    const target = defaultMatrixPreference("important_urgent", "user", "workspace");
    const result = resolveTaskForMatrixRule(task({
      priority: "medium",
      due_at: "2026-09-01T10:00:00.000Z",
    }), target.definition, now, new Set());
    expect(result).toEqual({ resolution: {} });
  });

  it("selects deterministic priority, due date and an editable target label", () => {
    const result = resolveTaskForMatrixRule(task(), {
      labels: ["readonly", "editable"],
      due: ["tomorrow"],
      priorities: ["high", "medium"],
      kinds: ["todo"],
      assignee: "all",
    }, now, new Set(["editable"]));
    expect(result).toEqual({
      resolution: { priority: "high", dueBucket: "tomorrow", addLabelId: "editable" },
    });
  });

  it("clears labels for inbox and rejects unsafe rules", () => {
    const inbox = resolveTaskForMatrixRule(task({ label_ids: ["editable"] }), {
      labels: ["inbox"], due: "all", priorities: "all", kinds: "all", assignee: "all",
    }, now, new Set(["editable"]));
    expect(inbox).toEqual({ resolution: { clearLabels: true } });

    expect(resolveTaskForMatrixRule(task(), {
      labels: "all", due: ["overdue"], priorities: "all", kinds: "all", assignee: "all",
    }, now, new Set())).toEqual({ error: "仅含已过期日期的象限无法安全接收此任务" });

    expect(resolveTaskForMatrixRule(task({ kind: "note" }), {
      labels: "all", due: "all", priorities: ["high"], kinds: "all", assignee: "all",
    }, now, new Set())).toEqual({ error: "笔记无法满足目标象限的优先级规则" });

    expect(resolveTaskForMatrixRule(task(), {
      labels: "all", due: "all", priorities: "all", kinds: ["note"], assignee: "all",
    }, now, new Set())).toEqual({ error: "目标象限不接受当前任务类型" });
  });

  it("matches and resolves a selected assignee deterministically", () => {
    const rule: MatrixRuleDefinition = {
      labels: "all",
      due: "all",
      priorities: "all",
      kinds: "all",
      assignee: "member",
    };
    expect(taskMatchesMatrixRule(task({ assignee_id: "member" }), rule, now)).toBe(true);
    expect(taskMatchesMatrixRule(task({ assignee_id: null }), rule, now)).toBe(false);
    expect(resolveTaskForMatrixRule(
      task({ assignee_id: null }),
      rule,
      now,
      new Set(),
      new Set(["member"]),
    )).toEqual({ resolution: { assigneeId: "member" } });
    expect(resolveTaskForMatrixRule(
      task({ assignee_id: null }),
      rule,
      now,
      new Set(),
      new Set(["user"]),
    )).toEqual({ error: "目标指派用户已不在当前团队空间" });
  });
});
