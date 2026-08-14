import { describe, expect, it } from "vitest";
import {
  allDayRangePatch,
  barGeometry,
  buildTimelineMonthSegments,
  clampTimelineLabelWidth,
  dateToX,
  dayOffsetToDate,
  dayWidthForZoom,
  defaultTimelineLabelWidth,
  collectTimelineBars,
  packTimelineBarLanes,
  packTimelineLanes,
  schedulePatchForTimelineDrop,
  schedulePatchForTimelineMove,
  schedulePatchForTimelineResize,
  shouldPlaceTimelineBarTitleOutside,
  splitTimelineTasks,
  taskBarRange,
  TIMELINE_LABEL_MAX_WIDTH,
  TIMELINE_LABEL_MIN_WIDTH,
  TIMELINE_PAD_DAYS,
  TIMELINE_TOTAL_DAYS,
  TIMELINE_VISIBLE_DAYS,
  timelineDayHeader,
  timelineDayIsRest,
  timelineDays,
  timelineOrigin,
  xToDayOffset,
} from "./taskTimeline";
import type { Subtask, Task } from "../types";

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
    watcher_ids: [],
    ...patch,
  } as Task;
}

function subtask(patch: Partial<Subtask> = {}): Subtask {
  return {
    id: "s1",
    task_id: "t1",
    title: "子任务",
    description: "",
    completed: false,
    position: 0,
    priority: "none",
    due_at: null,
    estimate_hours: null,
    actual_hours: null,
    estimate_pomodoros: null,
    actual_pomodoros: null,
    assignee_id: null,
    cli_assignee: null,
    created_by: "u1",
    due_start_at: null,
    due_is_all_day: false,
    due_timezone: null,
    reminders: [],
    reminder_persistent: false,
    ...patch,
  };
}

describe("taskTimeline", () => {
  it("splits scheduled vs unscheduled todos and drops deleted", () => {
    const tasks = [
      task({ id: "a", due_at: "2026-08-10T12:00:00.000Z" }),
      task({ id: "b", due_at: null }),
      task({ id: "c", kind: "note", due_at: null }),
      task({ id: "d", due_at: "2026-08-01T00:00:00.000Z", deleted_at: "2026-08-02T00:00:00.000Z" }),
      task({ id: "e", due_at: "2026-08-05T00:00:00.000Z", title: "早" }),
    ];
    const { scheduled, unscheduled } = splitTimelineTasks(tasks);
    expect(scheduled.map((item) => item.id)).toEqual(["e", "a"]);
    expect(unscheduled.map((item) => item.id)).toEqual(["b"]);
  });

  it("maps point and range tasks to bar day spans", () => {
    const point = task({
      due_at: "2026-08-10T15:30:00.000Z",
      due_start_at: null,
      due_is_all_day: false,
    });
    const pointRange = taskBarRange(point, null)!;
    expect(pointRange.dayCount).toBe(1);

    const multi = task({
      ...allDayRangePatch(new Date(2026, 7, 10), new Date(2026, 7, 12), null),
    });
    const multiRange = taskBarRange(multi, null)!;
    expect(multiRange.dayCount).toBe(3);
  });

  it("converts dates to x positions and offsets", () => {
    const origin = timelineOrigin(new Date(2026, 7, 8));
    const mid = dayOffsetToDate(origin, 10);
    expect(dateToX(mid, origin, 48)).toBe(480);
    expect(xToDayOffset(500, 48)).toBe(10);
    expect(barGeometry({
      startDay: mid,
      endDay: dayOffsetToDate(origin, 12),
      exclusiveEndDay: dayOffsetToDate(origin, 13),
      dayCount: 3,
      allDay: true,
    }, origin, 48).left).toBe(480);
  });

  it("builds all-day drop patch and move/resize patches", () => {
    const drop = schedulePatchForTimelineDrop(new Date(2026, 7, 10), null);
    expect(drop.due_is_all_day).toBe(true);
    expect(drop.due_start_at).toBeTruthy();
    expect(drop.due_at).toBeTruthy();

    const multi = task({
      ...allDayRangePatch(new Date(2026, 7, 10), new Date(2026, 7, 12), null),
    });
    const moved = schedulePatchForTimelineMove(multi, 2, null)!;
    expect(moved.due_is_all_day).toBe(true);
    const movedRange = taskBarRange({ ...multi, ...moved }, null)!;
    expect(movedRange.dayCount).toBe(3);
    expect(formatYmd(movedRange.startDay)).toBe("2026-08-12");

    const resized = schedulePatchForTimelineResize(multi, "end", 2, null)!;
    const resizedRange = taskBarRange({ ...multi, ...resized }, null)!;
    expect(resizedRange.dayCount).toBe(5);

    const shrunk = schedulePatchForTimelineResize(multi, "start", 1, null)!;
    const shrunkRange = taskBarRange({ ...multi, ...shrunk }, null)!;
    expect(shrunkRange.dayCount).toBe(2);
  });

  it("clamps resize so start never passes end", () => {
    const multi = task({
      ...allDayRangePatch(new Date(2026, 7, 10), new Date(2026, 7, 11), null),
    });
    const resized = schedulePatchForTimelineResize(multi, "start", 5, null)!;
    expect(taskBarRange({ ...multi, ...resized }, null)!.dayCount).toBe(1);
  });

  it("returns null for zero-delta move/resize", () => {
    const multi = task({
      ...allDayRangePatch(new Date(2026, 7, 10), new Date(2026, 7, 11), null),
    });
    expect(schedulePatchForTimelineMove(multi, 0, null)).toBeNull();
    expect(schedulePatchForTimelineResize(multi, "end", 0, null)).toBeNull();
  });

  it("builds inclusive all-day range patches", () => {
    const patch = allDayRangePatch(new Date(2026, 7, 1), new Date(2026, 7, 3), null);
    expect(patch.due_is_all_day).toBe(true);
    expect(taskBarRange({
      ...task(),
      ...patch,
    }, null)!.dayCount).toBe(3);
  });

  it("packs overlapping tasks into lanes within a group", () => {
    const a = task({
      id: "a",
      title: "A",
      ...allDayRangePatch(new Date(2026, 7, 1), new Date(2026, 7, 3), null),
    });
    const b = task({
      id: "b",
      title: "B",
      ...allDayRangePatch(new Date(2026, 7, 2), new Date(2026, 7, 2), null),
    });
    const c = task({
      id: "c",
      title: "C",
      ...allDayRangePatch(new Date(2026, 7, 4), new Date(2026, 7, 4), null),
    });
    const packed = packTimelineLanes([a, b, c], null);
    expect(packed.laneCount).toBe(2);
    expect(packed.items.find((item) => item.task.id === "a")?.lane).toBe(0);
    expect(packed.items.find((item) => item.task.id === "b")?.lane).toBe(1);
    expect(packed.items.find((item) => item.task.id === "c")?.lane).toBe(0);
  });

  it("includes dated subtasks even when the parent has no due date", () => {
    const parent = task({
      id: "parent",
      due_at: null,
      subtasks: [
        subtask({ id: "dated", task_id: "parent", title: "有日期", due_at: "2026-08-10T12:00:00.000Z" }),
        subtask({ id: "open", task_id: "parent", title: "无日期", due_at: null }),
      ],
    });
    const deleted = task({
      id: "gone",
      deleted_at: "2026-08-02T00:00:00.000Z",
      subtasks: [
        subtask({ id: "orphan", task_id: "gone", due_at: "2026-08-10T12:00:00.000Z" }),
      ],
    });
    const bars = collectTimelineBars([parent, deleted], false);
    expect(bars.map((item) => item.id)).toEqual(["subtask:dated"]);
    expect(bars[0]?.kind).toBe("subtask");
    const packed = packTimelineBarLanes(bars, null);
    expect(packed.items).toHaveLength(1);
    expect(packed.items[0]?.range.dayCount).toBe(1);
  });

  it("hides completed parent and subtask bars unless showCompleted", () => {
    const parent = task({
      id: "parent",
      due_at: "2026-08-09T12:00:00.000Z",
      status: "completed",
      subtasks: [
        subtask({
          id: "done",
          task_id: "parent",
          due_at: "2026-08-10T12:00:00.000Z",
          completed: true,
        }),
        subtask({
          id: "open",
          task_id: "parent",
          due_at: "2026-08-11T12:00:00.000Z",
          completed: false,
        }),
      ],
    });
    expect(collectTimelineBars([parent], false).map((item) => item.id)).toEqual(["subtask:open"]);
    expect(collectTimelineBars([parent], true).map((item) => item.id)).toEqual([
      "parent",
      "subtask:done",
      "subtask:open",
    ]);
  });

  it("packs a parent task and overlapping subtask into separate lanes", () => {
    const parent = task({
      id: "parent",
      title: "主任务",
      due_at: "2026-08-10T02:00:00.000Z",
      subtasks: [
        subtask({
          id: "child",
          task_id: "parent",
          title: "子任务",
          due_at: "2026-08-10T03:00:00.000Z",
        }),
      ],
    });
    const packed = packTimelineBarLanes(collectTimelineBars([parent], false), null);
    expect(packed.laneCount).toBe(2);
    expect(packed.items.find((item) => item.source.kind === "task")?.lane).toBe(0);
    expect(packed.items.find((item) => item.source.kind === "subtask")?.lane).toBe(1);
  });

  it("defaults label width from the longest group title", () => {
    const narrow = defaultTimelineLabelWidth(["研发"]);
    const wide = defaultTimelineLabelWidth(["产品 / 前端协作事项"]);
    expect(wide).toBeGreaterThan(narrow);
    expect(wide).toBeLessThanOrEqual(TIMELINE_LABEL_MAX_WIDTH);
    expect(narrow).toBeGreaterThanOrEqual(TIMELINE_LABEL_MIN_WIDTH);
    expect(clampTimelineLabelWidth(40)).toBe(TIMELINE_LABEL_MIN_WIDTH);
    expect(clampTimelineLabelWidth(999)).toBe(TIMELINE_LABEL_MAX_WIDTH);
  });

  it("keeps a full calendar length and uses visible days only for column width", () => {
    expect(TIMELINE_VISIBLE_DAYS).toEqual({ day: 12, week: 31, month: 62 });
    expect(TIMELINE_TOTAL_DAYS).toBe(TIMELINE_PAD_DAYS * 2 + 1);
    const today = new Date(2026, 4, 8);
    const origin = timelineOrigin(today);
    expect(timelineDays(origin, TIMELINE_TOTAL_DAYS)).toHaveLength(TIMELINE_TOTAL_DAYS);
    expect(dayWidthForZoom("day", 960)).toBe(80);
    expect(dayWidthForZoom("week", 960)).toBe(30);
    expect(dayWidthForZoom("month", 960)).toBe(15);
    // day width grows for denser day zoom vs month zoom
    expect(dayWidthForZoom("day", 960)).toBeGreaterThan(dayWidthForZoom("month", 960));
  });

  it("builds month axis segments and weekday-over-date headers", () => {
    const days = [
      new Date(2026, 3, 29),
      new Date(2026, 3, 30),
      new Date(2026, 4, 1),
      new Date(2026, 4, 2),
    ];
    expect(buildTimelineMonthSegments(days)).toEqual([
      { key: "2026-3", label: "4月", startIndex: 0, dayCount: 2 },
      { key: "2026-4", label: "5月", startIndex: 2, dayCount: 2 },
    ]);
    const monday = new Date(2026, 4, 4); // Monday
    const tuesday = new Date(2026, 4, 5);
    expect(timelineDayHeader(monday, "month").showTitle).toBe(true);
    expect(timelineDayHeader(monday, "month").weekday).toBe("一");
    expect(timelineDayHeader(tuesday, "month").showTitle).toBe(false);
    expect(timelineDayHeader(tuesday, "week").showTitle).toBe(true);
    expect(timelineDayHeader(tuesday, "week").weekday).toBe("二");
    expect(timelineDayHeader(tuesday, "week").dayNumber).toBe("5");
  });

  it("marks weekends and 休 as rest days, and 班 as workdays", () => {
    const saturday = new Date(2026, 4, 2);
    const monday = new Date(2026, 4, 4);
    expect(timelineDayIsRest(saturday)).toBe(true);
    expect(timelineDayIsRest(monday)).toBe(false);
    expect(timelineDayIsRest(saturday, { holidayLabel: "班" })).toBe(false);
    expect(timelineDayIsRest(monday, { holidayLabel: "休" })).toBe(true);
    expect(timelineDayHeader(saturday, "week", { holidayLabel: "休", holidayName: "劳动节" }).isRestDay).toBe(true);
    expect(timelineDayHeader(saturday, "week", { holidayLabel: "班", holidayName: "调休" }).isRestDay).toBe(false);
  });

  it("places long titles outside narrow bars", () => {
    expect(shouldPlaceTimelineBarTitleOutside("完成 AntTodo 项目框架验收", 70)).toBe(true);
    expect(shouldPlaceTimelineBarTitleOutside("短", 120)).toBe(false);
  });
});

function formatYmd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
