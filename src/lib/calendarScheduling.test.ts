import { describe, expect, it } from "vitest";
import { createDemoBundle } from "./demo";
import {
  buildScheduleTaskGroups,
  canRescheduleTask,
  clearSchedulePatch,
  isSchedulableTask,
  schedulePatchForCalendarMove,
  schedulePatchFromDrop,
} from "./calendarScheduling";

describe("calendar task scheduling", () => {
  it("groups editable unscheduled todos under inbox and every matching label", () => {
    const bundle = createDemoBundle();
    const multiLabel = {
      ...bundle.tasks[0],
      id: "multi-unscheduled",
      title: "多标签未安排任务",
      due_at: null,
      due_start_at: null,
      status: "open" as const,
      label_ids: ["product", "urgent"],
    };
    const nestedLabel = {
      ...multiLabel,
      id: "nested-unscheduled",
      title: "子标签未安排任务",
      label_ids: ["frontend"],
    };
    bundle.tasks = [...bundle.tasks, multiLabel, nestedLabel];
    bundle.labelPermissionLevels.product = 2;
    bundle.labelPermissionLevels.frontend = 2;
    bundle.labelPermissionLevels.urgent = 2;

    const groups = buildScheduleTaskGroups(bundle, "demo-user");
    expect(groups.map((group) => group.id)).toEqual([
      "inbox",
      "product",
      "frontend",
      "urgent",
    ]);
    expect(groups.find((group) => group.id === "inbox")?.tasks.map((task) => task.id))
      .toContain("task-5");
    expect(groups.find((group) => group.id === "product")?.tasks.map((task) => task.id))
      .toContain("multi-unscheduled");
    expect(groups.find((group) => group.id === "urgent")?.tasks.map((task) => task.id))
      .toContain("multi-unscheduled");
  });

  it("keeps unfiltered grouping when calendar visibility is omitted", () => {
    const bundle = createDemoBundle();
    bundle.labelPermissionLevels.inbox = 2;
    const groups = buildScheduleTaskGroups(bundle, "demo-user");
    expect(groups.map((group) => group.id)).toContain("inbox");
    expect(groups.find((group) => group.id === "inbox")?.tasks.map((task) => task.id))
      .toEqual(["task-5"]);
  });

  it("hides inbox tasks and keeps multi-label tasks only under visible labels", () => {
    const bundle = createDemoBundle();
    const multiLabel = {
      ...bundle.tasks[0],
      id: "multi-unscheduled",
      title: "多标签未安排任务",
      due_at: null,
      due_start_at: null,
      status: "open" as const,
      assignee_id: "demo-user",
      label_ids: ["product", "urgent"],
    };
    bundle.tasks = [...bundle.tasks, multiLabel];
    bundle.labelPermissionLevels.product = 2;
    bundle.labelPermissionLevels.urgent = 2;

    const groups = buildScheduleTaskGroups(
      bundle,
      "demo-user",
      new Set(),
      new Set(["product"]),
      new Set(["demo-user", "unassigned"]),
    );
    expect(groups.map((group) => group.id)).toEqual(["product"]);
    expect(groups[0].tasks.map((task) => task.id)).toContain("multi-unscheduled");
    expect(groups.find((group) => group.id === "inbox")).toBeUndefined();
    expect(groups.find((group) => group.id === "urgent")).toBeUndefined();
  });

  it("hides unscheduled tasks whose assignee is not visible", () => {
    const bundle = createDemoBundle();
    const assigned = {
      ...bundle.tasks[0],
      id: "assigned-unscheduled",
      title: "已指派未安排任务",
      due_at: null,
      due_start_at: null,
      status: "open" as const,
      assignee_id: "demo-user",
      label_ids: ["product"],
    };
    bundle.tasks = [assigned, bundle.tasks.find((task) => task.id === "task-5")!];
    bundle.labelPermissionLevels.product = 2;

    const withoutAssignee = buildScheduleTaskGroups(
      bundle,
      "demo-user",
      new Set(),
      new Set(["inbox", "product"]),
      new Set(["unassigned"]),
    );
    expect(withoutAssignee.map((group) => group.id)).toEqual(["inbox"]);
    expect(withoutAssignee[0].tasks.map((task) => task.id)).toEqual(["task-5"]);

    const withoutUnassigned = buildScheduleTaskGroups(
      bundle,
      "demo-user",
      new Set(),
      new Set(["inbox", "product"]),
      new Set(["demo-user"]),
    );
    expect(withoutUnassigned.map((group) => group.id)).toEqual(["product"]);
    expect(withoutUnassigned[0].tasks.map((task) => task.id)).toEqual(["assigned-unscheduled"]);
  });

  it("excludes scheduled, completed, note, deleted, readonly, and pending tasks", () => {
    const bundle = createDemoBundle();
    const base = bundle.tasks.find((task) => task.id === "task-5")!;
    const candidates = [
      { ...base, id: "scheduled", due_at: new Date().toISOString() },
      { ...base, id: "completed", status: "completed" as const },
      { ...base, id: "note", kind: "note" as const },
      { ...base, id: "deleted", deleted_at: new Date().toISOString() },
      { ...base, id: "readonly", label_ids: ["product"] },
    ];
    bundle.labelPermissionLevels.product = 1;
    bundle.tasks = candidates;
    expect(candidates.map((task) => isSchedulableTask(bundle, task, "demo-user")))
      .toEqual([false, false, false, false, false]);
    bundle.tasks = [base];
    expect(buildScheduleTaskGroups(bundle, "demo-user", new Set([base.id]))).toEqual([]);
  });

  it("only allows editable open todos to move or return to the candidate panel", () => {
    const bundle = createDemoBundle();
    const scheduled = bundle.tasks.find((task) => task.id === "task-1")!;
    bundle.labelPermissionLevels.product = 2;
    expect(canRescheduleTask(bundle, scheduled, "demo-user")).toBe(true);
    expect(canRescheduleTask(bundle, { ...scheduled, status: "completed" }, "demo-user"))
      .toBe(false);
    expect(canRescheduleTask(bundle, { ...scheduled, kind: "note" }, "demo-user"))
      .toBe(false);
    bundle.labelPermissionLevels.product = 1;
    expect(canRescheduleTask(bundle, scheduled, "demo-user")).toBe(false);
  });

  it("creates an all-day range in the selected timezone", () => {
    const patch = schedulePatchFromDrop(
      new Date("2026-11-01T12:00:00-04:00"),
      true,
      "America/New_York",
    );
    expect(patch).toEqual({
      due_start_at: "2026-11-01T04:00:00.000Z",
      due_at: "2026-11-02T04:59:59.999Z",
      due_is_all_day: true,
      due_timezone: "America/New_York",
    });
  });

  it("keeps the dropped calendar date at a month boundary", () => {
    const patch = schedulePatchFromDrop(
      new Date("2026-08-31T12:00:00+08:00"),
      true,
      "Asia/Shanghai",
    );
    expect(patch.due_start_at).toBe("2026-08-30T16:00:00.000Z");
    expect(patch.due_at).toBe("2026-08-31T15:59:59.999Z");
  });

  it("keeps an exact timed drop as a point deadline", () => {
    const date = new Date("2026-08-07T09:30:00+08:00");
    expect(schedulePatchFromDrop(date, false, "Asia/Shanghai")).toEqual({
      due_at: "2026-08-07T01:30:00.000Z",
      due_start_at: null,
      due_is_all_day: false,
      due_timezone: "Asia/Shanghai",
    });
  });

  it("moves a timed range without changing its duration", () => {
    const bundle = createDemoBundle();
    const task = {
      ...bundle.tasks[0],
      due_start_at: "2026-08-07T01:30:00.000Z",
      due_at: "2026-08-07T03:00:00.000Z",
      due_is_all_day: false,
      due_timezone: "Asia/Shanghai",
    };
    expect(schedulePatchForCalendarMove(
      task,
      new Date("2026-08-31T06:00:00.000Z"),
      false,
      "Asia/Shanghai",
    )).toEqual({
      due_start_at: "2026-08-31T06:00:00.000Z",
      due_at: "2026-08-31T07:30:00.000Z",
      due_is_all_day: false,
      due_timezone: "Asia/Shanghai",
    });
  });

  it("moves an all-day range across DST while preserving its calendar-day span", () => {
    const bundle = createDemoBundle();
    const task = {
      ...bundle.tasks[0],
      due_start_at: "2026-10-30T04:00:00.000Z",
      due_at: "2026-11-02T04:59:59.999Z",
      due_is_all_day: true,
      due_timezone: "America/New_York",
    };
    expect(schedulePatchForCalendarMove(
      task,
      new Date("2026-11-06T12:00:00-05:00"),
      true,
      "America/New_York",
    )).toEqual({
      due_start_at: "2026-11-06T05:00:00.000Z",
      due_at: "2026-11-09T04:59:59.999Z",
      due_is_all_day: true,
      due_timezone: "America/New_York",
    });
  });

  it("clears every due-date field when returning a task to candidates", () => {
    expect(clearSchedulePatch()).toEqual({
      due_at: null,
      due_start_at: null,
      due_is_all_day: false,
      due_timezone: null,
    });
  });
});
