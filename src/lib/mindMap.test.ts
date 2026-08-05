import { describe, expect, it } from "vitest";
import {
  buildMindMapTree,
  classifyTaskSchedule,
  moveTaskToDate,
  moveTaskToSchedule,
  resolveMindMapDropAssignment,
} from "./mindMap";
import { DEFAULT_DATE_TIME_PREFERENCES, toDateInput, toTimeInput } from "./dateTimePreferences";
import type { Label, Task } from "../types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    workspace_id: "workspace",
    title: "任务",
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
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    label_ids: [],
    participant_ids: [],
    subtasks: [],
    ...overrides,
    cli_assignee: overrides.cli_assignee ?? null,
    kind: overrides.kind ?? "todo",
    reminders: overrides.reminders ?? [],
    reminder_persistent: overrides.reminder_persistent ?? false,
    recurrence: overrides.recurrence ?? null,
  };
}

function label(
  id: string,
  position: number,
  parentId: string | null = null,
  name = id,
): Label {
  return {
    id,
    workspace_id: "workspace",
    parent_id: parentId,
    name,
    color: `#${String(position + 1).padStart(6, "0")}`,
    position,
    kind: "team",
    view_scope: "all",
    manage_scope: "users",
    inherit_permissions: parentId !== null,
    created_by: "user",
  };
}

describe("mind map tree", () => {
  it("excludes notes from the mind map tree", () => {
    const note = task({
      id: "note",
      kind: "note",
      title: "笔记",
      label_ids: ["tag"],
      due_at: "2026-08-01T08:00:00.000Z",
    });
    const todo = task({
      id: "todo",
      title: "待办",
      due_at: "2026-08-01T08:00:00.000Z",
    });
    const root = buildMindMapTree({
      tasks: [note, todo],
      labels: [label("tag", 0, null, "标签")],
      preferences: DEFAULT_DATE_TIME_PREFERENCES,
    });
    const collectTaskIds = (node: typeof root): string[] => [
      ...(node.task ? [node.task.id] : []),
      ...node.children.flatMap(collectTaskIds),
    ];
    expect(collectTaskIds(root)).toEqual(["todo"]);
  });

  it("builds date, inbox and unscheduled branches without deleted tasks", () => {
    const root = buildMindMapTree({
      tasks: [
        task({ id: "early", title: "早", due_at: "2026-07-31T01:00:00.000Z" }),
        task({ id: "later", title: "晚", due_at: "2026-07-31T08:00:00.000Z" }),
        task({ id: "august", due_at: "2026-08-01T08:00:00.000Z" }),
        task({ id: "none" }),
        task({ id: "deleted", deleted_at: "2026-08-01T00:00:00Z" }),
      ],
      labels: [],
      preferences: DEFAULT_DATE_TIME_PREFERENCES,
      focusDateKey: "2026-08-02",
    });

    expect(root.label).toBe("任务清单");
    // Week 7/27–8/2 still has July dates, so Aug 1–2 stay under July.
    expect(root.children.map((node) => node.id)).toEqual([
      "month:2026-07",
      "inbox",
      "unscheduled",
    ]);
    const julyWeek = root.children[0].children[0];
    expect(julyWeek.kind).toBe("week");
    expect(julyWeek.dateKey).toBe("2026-07-27");
    expect(julyWeek.dateEndKey).toBe("2026-08-02");
    expect(julyWeek.children.map((node) => node.id)).toEqual([
      "day:2026-07-31",
      "day:2026-08-01",
      "day:2026-08-02",
    ]);
    const julyDay = julyWeek.children[0];
    expect(julyDay.children.map((node) => node.id)).toEqual([
      "task:2026-07-31:none:early",
      "task:2026-07-31:none:later",
    ]);
    expect(julyWeek.children[2].children).toEqual([]);
    expect(root.children.at(-2)?.children[0].id).toBe("task:inbox:none:none");
    expect(root.children.at(-1)?.children).toEqual([]);
  });

  it("keeps a cross-month week only under the earlier month", () => {
    const weekPatch = moveTaskToSchedule(task(), {
      level: "week",
      startKey: "2026-07-27",
      endKey: "2026-08-02",
    });
    const root = buildMindMapTree({
      tasks: [
        task({ id: "july", due_at: "2026-07-28T08:00:00.000Z" }),
        task({ id: "august", due_at: "2026-08-01T08:00:00.000Z" }),
        task({ id: "week-span", title: "跨月周任务", ...weekPatch }),
        task({ id: "later-august", due_at: "2026-08-05T08:00:00.000Z" }),
      ],
      labels: [],
      preferences: DEFAULT_DATE_TIME_PREFERENCES,
    });

    expect(root.children.map((node) => node.id)).toEqual([
      "month:2026-07",
      "month:2026-08",
      "inbox",
      "unscheduled",
    ]);
    const july = root.children.find((node) => node.id === "month:2026-07");
    const august = root.children.find((node) => node.id === "month:2026-08");
    const julyWeeks = july?.children.filter((node) => node.kind === "week") ?? [];
    const augustWeeks = august?.children.filter((node) => node.kind === "week") ?? [];
    expect(julyWeeks.map((node) => node.dateKey)).toEqual(["2026-07-27"]);
    expect(julyWeeks[0]?.label).toContain("7/27");
    expect(julyWeeks[0]?.children.map((node) => node.id)).toEqual([
      `task:${julyWeeks[0]?.contextKey}:none:week-span`,
      "day:2026-07-28",
      "day:2026-08-01",
    ]);
    expect(augustWeeks.map((node) => node.dateKey)).toEqual(["2026-08-03"]);
    expect(augustWeeks.some((node) => node.dateKey === "2026-07-27")).toBe(false);
  });

  it("prunes empty labels, preserves ancestors, and repeats multi-label tasks", () => {
    const root = buildMindMapTree({
      tasks: [
        task({
          id: "multi",
          title: "多标签",
          due_at: "2026-08-01T08:00:00.000Z",
          label_ids: ["child", "urgent"],
        }),
        task({ id: "parent-task", due_at: "2026-08-01T09:00:00.000Z", label_ids: ["parent"] }),
        task({ id: "loose" }),
        task({ id: "labeled-loose", label_ids: ["child"] }),
      ],
      labels: [
        label("urgent", 0, null, "紧急"),
        label("parent", 1, null, "产品"),
        label("child", 0, "parent", "前端"),
        label("empty", 2, null, "空标签"),
      ],
      preferences: DEFAULT_DATE_TIME_PREFERENCES,
      labelDisplayMode: "full",
    });

    const day = root.children[0].children[0].children[0];
    expect(day.children.map((node) => node.id)).toEqual([
      "label:2026-08-01:urgent",
      "label:2026-08-01:parent",
    ]);
    const urgent = day.children[0];
    const parent = day.children[1];
    expect(urgent.children.map((node) => node.id)).toEqual([
      "task:2026-08-01:urgent:multi",
    ]);
    expect(parent.children.map((node) => node.id)).toEqual([
      "label:2026-08-01:child",
      "task:2026-08-01:parent:parent-task",
    ]);
    expect(parent.children[0].children[0].id).toBe("task:2026-08-01:child:multi");
    expect(JSON.stringify(root)).not.toContain("空标签");

    const inboxChildren = root.children.at(-2)?.children ?? [];
    expect(inboxChildren.map((node) => node.id)).toEqual(["task:inbox:none:loose"]);

    const unscheduledChildren = root.children.at(-1)?.children ?? [];
    expect(unscheduledChildren.map((node) => node.id)).toEqual([
      "label:unscheduled:parent",
    ]);
    expect(unscheduledChildren[0].children[0].id).toBe("label:unscheduled:child");
    expect(unscheduledChildren[0].children[0].children[0].id).toBe(
      "task:unscheduled:child:labeled-loose",
    );
  });

  it("omits hidden labels and their tasks while keeping unlabeled tasks", () => {
    const root = buildMindMapTree({
      tasks: [
        task({
          id: "keep",
          due_at: "2026-08-01T08:00:00.000Z",
          label_ids: ["keep"],
        }),
        task({
          id: "hide",
          due_at: "2026-08-01T09:00:00.000Z",
          label_ids: ["hide"],
        }),
        task({
          id: "both",
          due_at: "2026-08-01T10:00:00.000Z",
          label_ids: ["keep", "hide"],
        }),
        task({ id: "plain", due_at: "2026-08-01T11:00:00.000Z" }),
        task({ id: "loose-hide", label_ids: ["hide"] }),
        task({ id: "inbox-plain" }),
      ],
      // Display settings pass only checked labels into the tree builder.
      labels: [label("keep", 0, null, "保留")],
      preferences: DEFAULT_DATE_TIME_PREFERENCES,
      labelDisplayMode: "full",
    });

    const day = root.children[0].children[0].children[0];
    expect(day.children.map((node) => node.id)).toEqual([
      "label:2026-08-01:keep",
      "task:2026-08-01:none:plain",
    ]);
    expect(day.children[0].children.map((node) => node.id)).toEqual([
      "task:2026-08-01:keep:keep",
      "task:2026-08-01:keep:both",
    ]);
    expect(JSON.stringify(root)).not.toContain("隐藏");
    expect(root.children.at(-1)?.children).toEqual([]);
    expect(root.children.at(-2)?.children.map((node) => node.id)).toEqual([
      "task:inbox:none:inbox-plain",
    ]);
  });

  const nestedLabelFixture = {
    tasks: [
      task({
        id: "child-task",
        due_at: "2026-08-01T08:00:00.000Z",
        label_ids: ["child"],
      }),
      task({
        id: "parent-task",
        due_at: "2026-08-01T09:00:00.000Z",
        label_ids: ["parent"],
      }),
      task({ id: "plain", due_at: "2026-08-01T10:00:00.000Z" }),
      task({ id: "loose-child", label_ids: ["child"] }),
    ],
    labels: [
      label("parent", 0, null, "产品"),
      label("child", 0, "parent", "前端"),
    ],
    preferences: DEFAULT_DATE_TIME_PREFERENCES,
  };

  it("merges label paths into flat sibling nodes", () => {
    const root = buildMindMapTree({
      ...nestedLabelFixture,
      labelDisplayMode: "merged",
    });
    const day = root.children[0].children[0].children[0];
    expect(day.children.map((node) => ({ id: node.id, label: node.label }))).toEqual([
      { id: "label:2026-08-01:parent", label: "产品" },
      { id: "label:2026-08-01:child", label: "产品 / 前端" },
      { id: "task:2026-08-01:none:plain", label: "任务" },
    ]);
    expect(day.children[0].children.map((node) => node.id)).toEqual([
      "task:2026-08-01:parent:parent-task",
    ]);
    expect(day.children[1].children.map((node) => node.id)).toEqual([
      "task:2026-08-01:child:child-task",
    ]);
    expect(day.children[1].children.some((node) => node.kind === "label")).toBe(false);

    const unscheduledChildren = root.children.at(-1)?.children ?? [];
    expect(unscheduledChildren.map((node) => ({ id: node.id, label: node.label }))).toEqual([
      { id: "label:unscheduled:child", label: "产品 / 前端" },
    ]);
  });

  it("shows only leaf labels and lifts intermediate-label tasks", () => {
    const root = buildMindMapTree({
      ...nestedLabelFixture,
      labelDisplayMode: "leaf",
    });
    const day = root.children[0].children[0].children[0];
    expect(day.children.map((node) => ({ id: node.id, label: node.label }))).toEqual([
      { id: "label:2026-08-01:child", label: "前端" },
      { id: "task:2026-08-01:none:parent-task", label: "任务" },
      { id: "task:2026-08-01:none:plain", label: "任务" },
    ]);
    expect(day.children[0].children.map((node) => node.id)).toEqual([
      "task:2026-08-01:child:child-task",
    ]);
    expect(JSON.stringify(day.children.map((node) => node.label))).not.toContain("产品");

    const unscheduledChildren = root.children.at(-1)?.children ?? [];
    expect(unscheduledChildren.map((node) => node.id)).toEqual([
      "label:unscheduled:child",
    ]);
  });

  it("hides label nodes and flattens visible labeled tasks", () => {
    const root = buildMindMapTree({
      ...nestedLabelFixture,
      labelDisplayMode: "hidden",
    });
    const day = root.children[0].children[0].children[0];
    expect(day.children.map((node) => node.id)).toEqual([
      "task:2026-08-01:none:child-task",
      "task:2026-08-01:none:parent-task",
      "task:2026-08-01:none:plain",
    ]);
    expect(day.children.every((node) => node.kind === "task")).toBe(true);

    const unscheduledChildren = root.children.at(-1)?.children ?? [];
    expect(unscheduledChildren.map((node) => node.id)).toEqual([
      "task:unscheduled:none:loose-child",
    ]);
  });
});

describe("mind map date moves", () => {
  it("moves a point due date while preserving its local time and timezone", () => {
    const source = task({
      due_at: "2026-03-07T14:30:17.250Z",
      due_timezone: "America/New_York",
    });
    const patch = moveTaskToDate(source, "2026-03-09");
    expect(toDateInput(patch.due_at!, patch.due_timezone)).toBe("2026-03-09");
    expect(toTimeInput(patch.due_at!, patch.due_timezone)).toBe("09:30");
    expect(new Date(patch.due_at!).getUTCSeconds()).toBe(17);
  });

  it("moves both ends of a range by calendar days across daylight saving time", () => {
    const source = task({
      due_start_at: "2026-03-07T14:00:00.000Z",
      due_at: "2026-03-08T21:00:00.000Z",
      due_timezone: "America/New_York",
    });
    const patch = moveTaskToDate(source, "2026-03-10");
    expect(toDateInput(patch.due_start_at!, patch.due_timezone)).toBe("2026-03-09");
    expect(toTimeInput(patch.due_start_at!, patch.due_timezone)).toBe("09:00");
    expect(toDateInput(patch.due_at!, patch.due_timezone)).toBe("2026-03-10");
    expect(toTimeInput(patch.due_at!, patch.due_timezone)).toBe("17:00");
  });

  it("assigns all-day week and month spans when dropping onto those nodes", () => {
    const source = task({ due_at: "2026-08-05T08:00:00.000Z" });
    const week = moveTaskToSchedule(source, {
      level: "week",
      startKey: "2026-08-03",
      endKey: "2026-08-09",
    });
    expect(week.due_is_all_day).toBe(true);
    expect(toDateInput(week.due_start_at!)).toBe("2026-08-03");
    expect(toDateInput(week.due_at!)).toBe("2026-08-09");
    expect(classifyTaskSchedule({ ...source, ...week }, DEFAULT_DATE_TIME_PREFERENCES)).toEqual({
      level: "week",
      startKey: "2026-08-03",
      endKey: "2026-08-09",
    });

    const month = moveTaskToSchedule(source, {
      level: "month",
      startKey: "2026-08-01",
      endKey: "2026-08-31",
    });
    expect(toDateInput(month.due_start_at!)).toBe("2026-08-01");
    expect(toDateInput(month.due_at!)).toBe("2026-08-31");
    expect(classifyTaskSchedule({ ...source, ...month }, DEFAULT_DATE_TIME_PREFERENCES).level)
      .toBe("month");
  });

  it("places week and month span tasks under week and month nodes", () => {
    const blank = task();
    const weekPatch = moveTaskToSchedule(blank, {
      level: "week",
      startKey: "2026-08-03",
      endKey: "2026-08-09",
    });
    const monthPatch = moveTaskToSchedule(blank, {
      level: "month",
      startKey: "2026-08-01",
      endKey: "2026-08-31",
    });
    const root = buildMindMapTree({
      tasks: [
        task({ id: "week-task", title: "周任务", ...weekPatch }),
        task({ id: "month-task", title: "月任务", ...monthPatch }),
        task({
          id: "day-task",
          title: "日任务",
          due_at: "2026-08-05T08:00:00.000Z",
        }),
      ],
      labels: [],
      preferences: DEFAULT_DATE_TIME_PREFERENCES,
    });

    const month = root.children.find((node) => node.id === "month:2026-08");
    expect(month?.children.map((node) => node.id)).toContain("task:month:2026-08:none:month-task");
    const week = month?.children.find((node) => node.kind === "week");
    expect(week?.dateKey).toBe("2026-08-03");
    expect(week?.children.map((node) => node.id)).toContain(
      `task:${week?.contextKey}:none:week-task`,
    );
    const day = week?.children.find((node) => node.id === "day:2026-08-05");
    expect(day?.children.map((node) => node.id)).toEqual([
      "task:2026-08-05:none:day-task",
    ]);
  });

  it("creates an all-day range for an unscheduled task and clears it again", () => {
    const source = task();
    const scheduled = moveTaskToDate(source, "2026-12-31");
    expect(scheduled.due_is_all_day).toBe(true);
    expect(toDateInput(scheduled.due_start_at!)).toBe("2026-12-31");
    expect(toDateInput(scheduled.due_at!)).toBe("2026-12-31");
    expect(moveTaskToDate({ ...source, ...scheduled }, null)).toEqual({
      due_at: null,
      due_start_at: null,
      due_is_all_day: false,
      due_timezone: null,
    });
  });
});

describe("mind map drop assignment", () => {
  it("picks the closest date and label from the drop path", () => {
    expect(resolveMindMapDropAssignment([
      { kind: "label", labelId: "child", dateKey: "2026-08-07", scheduleLevel: "day", contextKey: "2026-08-07" },
      { kind: "day", dateKey: "2026-08-07", scheduleLevel: "day", contextKey: "2026-08-07" },
      { kind: "week", dateKey: "2026-08-03", dateEndKey: "2026-08-09", scheduleLevel: "week" },
      { kind: "month", dateKey: "2026-08-01", dateEndKey: "2026-08-31", scheduleLevel: "month" },
      { kind: "root" },
    ])).toEqual({
      schedule: { level: "day", dateKey: "2026-08-07" },
      applySchedule: true,
      labelId: "child",
      clearLabels: false,
    });
  });

  it("inherits ancestor date when the target itself has no schedule", () => {
    expect(resolveMindMapDropAssignment([
      { kind: "label", labelId: "frontend" },
      { kind: "day", dateKey: "2026-08-05", scheduleLevel: "day", contextKey: "2026-08-05" },
      { kind: "week", dateKey: "2026-08-03", dateEndKey: "2026-08-09", scheduleLevel: "week" },
      { kind: "root" },
    ])).toEqual({
      schedule: { level: "day", dateKey: "2026-08-05" },
      applySchedule: true,
      labelId: "frontend",
      clearLabels: false,
    });
  });

  it("clears schedule and labels when dropping into the inbox path", () => {
    expect(resolveMindMapDropAssignment([
      { kind: "task", labelId: "keep", contextKey: "inbox" },
      { kind: "inbox", contextKey: "inbox" },
      { kind: "root" },
    ])).toEqual({
      schedule: { level: "none" },
      applySchedule: true,
      labelId: null,
      clearLabels: true,
    });
  });

  it("clears schedule for unscheduled without removing labels unless labeled", () => {
    expect(resolveMindMapDropAssignment([
      { kind: "unscheduled", contextKey: "unscheduled" },
      { kind: "root" },
    ])).toEqual({
      schedule: { level: "none" },
      applySchedule: true,
      labelId: null,
      clearLabels: false,
    });

    expect(resolveMindMapDropAssignment([
      { kind: "label", labelId: "work", contextKey: "unscheduled" },
      { kind: "unscheduled", contextKey: "unscheduled" },
      { kind: "root" },
    ])).toEqual({
      schedule: { level: "none" },
      applySchedule: true,
      labelId: "work",
      clearLabels: false,
    });
  });

  it("prefers a day ancestor over a week-level task target on the same path", () => {
    expect(resolveMindMapDropAssignment([
      {
        kind: "task",
        labelId: "product",
        dateKey: "2026-08-10",
        dateEndKey: "2026-08-16",
        scheduleLevel: "week",
        contextKey: "week:2026-08:2026-08-10",
      },
      {
        kind: "day",
        dateKey: "2026-08-16",
        scheduleLevel: "day",
        contextKey: "2026-08-16",
      },
      {
        kind: "week",
        dateKey: "2026-08-10",
        dateEndKey: "2026-08-16",
        scheduleLevel: "week",
      },
      { kind: "root" },
    ])).toEqual({
      schedule: { level: "day", dateKey: "2026-08-16" },
      applySchedule: true,
      labelId: "product",
      clearLabels: false,
    });
  });

  it("collapses a week all-day span onto a single day when dropping on a day", () => {
    const source = task({
      ...moveTaskToSchedule(task(), {
        level: "week",
        startKey: "2026-08-10",
        endKey: "2026-08-16",
      }),
    });
    expect(classifyTaskSchedule(source, DEFAULT_DATE_TIME_PREFERENCES).level).toBe("week");

    const day = moveTaskToSchedule(source, { level: "day", dateKey: "2026-08-16" });
    expect(day.due_is_all_day).toBe(true);
    expect(toDateInput(day.due_start_at!)).toBe("2026-08-16");
    expect(toDateInput(day.due_at!)).toBe("2026-08-16");
    expect(classifyTaskSchedule({ ...source, ...day }, DEFAULT_DATE_TIME_PREFERENCES)).toEqual({
      level: "day",
      dateKey: "2026-08-16",
    });
  });
});
