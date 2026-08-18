import { describe, expect, it } from "vitest";
import {
  allDayRangePatch,
  barGeometry,
  buildTimelineDependencyPath,
  buildTimelineMonthSegments,
  clampTimelineLabelWidth,
  dateToX,
  dayOffsetToDate,
  dayWidthForZoom,
  defaultTimelineLabelWidth,
  collectTimelineBars,
  collectTimelineDependencyPaths,
  packTimelineBarLanes,
  packTimelineLanes,
  rehomeTimelineGroupBars,
  schedulePatchForTimelineDrop,
  schedulePatchForTimelineMove,
  schedulePatchForTimelineResize,
  shouldPlaceTimelineBarTitleOutside,
  splitTimelineTasks,
  taskBarRange,
  TIMELINE_BAR_HEIGHT,
  TIMELINE_DEPENDENCY_CHANNEL,
  TIMELINE_LABEL_MAX_WIDTH,
  TIMELINE_LABEL_MIN_WIDTH,
  TIMELINE_PAD_DAYS,
  TIMELINE_TOTAL_DAYS,
  TIMELINE_VISIBLE_DAYS,
  timelineDayHeader,
  timelineDayIsRest,
  timelineDays,
  timelineBarBox,
  timelineBarDayInset,
  timelineOrigin,
  xToDayOffset,
} from "./taskTimeline";
import type { Task } from "../types";

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
    watcher_ids: [],
    ...patch,
    parent_task_id: patch.parent_task_id ?? null,
    position: patch.position ?? 0,
  } as Task;
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
    const geometry = barGeometry({
      startDay: mid,
      endDay: dayOffsetToDate(origin, 12),
      exclusiveEndDay: dayOffsetToDate(origin, 13),
      dayCount: 3,
      allDay: true,
    }, origin, 48);
    expect(geometry.left).toBe(480 + timelineBarDayInset(48));
  });

  it("leaves a finish-to-start channel between adjacent-day bars", () => {
    const origin = new Date(2026, 7, 1);
    for (const dayWidth of [30, 80] as const) {
      const first = barGeometry({
        startDay: origin,
        endDay: origin,
        exclusiveEndDay: dayOffsetToDate(origin, 1),
        dayCount: 1,
        allDay: true,
      }, origin, dayWidth);
      const second = barGeometry({
        startDay: dayOffsetToDate(origin, 1),
        endDay: dayOffsetToDate(origin, 1),
        exclusiveEndDay: dayOffsetToDate(origin, 2),
        dayCount: 1,
        allDay: true,
      }, origin, dayWidth);
      expect(second.left - (first.left + first.width)).toBeGreaterThanOrEqual(
        TIMELINE_DEPENDENCY_CHANNEL,
      );
    }
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

  it("keeps a task and its predecessor on the same lane", () => {
    const predecessor = task({
      id: "pred",
      title: "前置",
      ...allDayRangePatch(new Date(2026, 7, 1), new Date(2026, 7, 3), null),
    });
    const unrelated = task({
      id: "other",
      title: "无关",
      ...allDayRangePatch(new Date(2026, 7, 4), new Date(2026, 7, 6), null),
    });
    const successor = task({
      id: "succ",
      title: "后续",
      ...allDayRangePatch(new Date(2026, 7, 5), new Date(2026, 7, 7), null),
    });
    const edges = [{
      id: "edge",
      task_id: "succ",
      depends_on_task_id: "pred",
    }];
    const packed = packTimelineBarLanes(
      collectTimelineBars([predecessor, unrelated, successor], false),
      null,
      edges,
    );
    expect(packed.items.find((item) => item.task.id === "pred")?.lane).toBe(0);
    expect(packed.items.find((item) => item.task.id === "succ")?.lane).toBe(0);
    expect(packed.items.find((item) => item.task.id === "other")?.lane).toBe(1);
  });

  it("still splits overlapping predecessor and successor", () => {
    const predecessor = task({
      id: "pred",
      title: "前置",
      ...allDayRangePatch(new Date(2026, 7, 1), new Date(2026, 7, 5), null),
    });
    const successor = task({
      id: "succ",
      title: "后续",
      ...allDayRangePatch(new Date(2026, 7, 3), new Date(2026, 7, 6), null),
    });
    const packed = packTimelineBarLanes(
      collectTimelineBars([predecessor, successor], false),
      null,
      [{
        task_id: "succ",
        depends_on_task_id: "pred",
      }],
    );
    expect(packed.laneCount).toBe(2);
    expect(packed.items.find((item) => item.task.id === "pred")?.lane).not.toBe(
      packed.items.find((item) => item.task.id === "succ")?.lane,
    );
  });

  it("moves a dependency chain into the earliest group row", () => {
    const predecessor = task({
      id: "pred",
      title: "前置",
      ...allDayRangePatch(new Date(2026, 7, 1), new Date(2026, 7, 2), null),
    });
    const successor = task({
      id: "succ",
      title: "后续",
      ...allDayRangePatch(new Date(2026, 7, 4), new Date(2026, 7, 5), null),
    });
    const groups = rehomeTimelineGroupBars(
      [
        { id: "g1", bars: collectTimelineBars([predecessor], false) },
        { id: "g2", bars: collectTimelineBars([successor], false) },
      ],
      [{
        task_id: "succ",
        depends_on_task_id: "pred",
      }],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe("g1");
    expect(groups[0]?.bars.map((item) => item.id).sort()).toEqual(["pred", "succ"]);
  });

  it("includes dated children even when the parent has no due date", () => {
    const parent = task({
      id: "parent",
      due_at: null,
      children: [
        childTask({ id: "dated", parent_task_id: "parent", title: "有日期", due_at: "2026-08-10T12:00:00.000Z" }),
        childTask({ id: "open", parent_task_id: "parent", title: "无日期", due_at: null }),
      ],
    });
    const deleted = task({
      id: "gone",
      deleted_at: "2026-08-02T00:00:00.000Z",
      children: [
        childTask({ id: "orphan", parent_task_id: "gone", due_at: "2026-08-10T12:00:00.000Z" }),
      ],
    });
    const bars = collectTimelineBars([parent, deleted], false);
    expect(bars.map((item) => item.id)).toEqual(["dated"]);
    expect(bars[0]?.kind).toBe("childTask");
    const packed = packTimelineBarLanes(bars, null);
    expect(packed.items).toHaveLength(1);
    expect(packed.items[0]?.range.dayCount).toBe(1);
  });

  it("hides completed parent and childTask bars unless showCompleted", () => {
    const parent = task({
      id: "parent",
      due_at: "2026-08-09T12:00:00.000Z",
      status: "completed",
      children: [
        childTask({
          id: "done",
          parent_task_id: "parent",
          due_at: "2026-08-10T12:00:00.000Z",
          status: "completed",
        }),
        childTask({
          id: "open",
          parent_task_id: "parent",
          due_at: "2026-08-11T12:00:00.000Z",
          status: "open",
        }),
      ],
    });
    expect(collectTimelineBars([parent], false).map((item) => item.id)).toEqual(["open"]);
    expect(collectTimelineBars([parent], true).map((item) => item.id)).toEqual([
      "parent",
      "done",
      "open",
    ]);
  });

  it("packs a parent task and overlapping childTask into separate lanes", () => {
    const parent = task({
      id: "parent",
      title: "主任务",
      due_at: "2026-08-10T02:00:00.000Z",
      children: [
        childTask({
          id: "child",
          parent_task_id: "parent",
          title: "子级任务",
          due_at: "2026-08-10T03:00:00.000Z",
        }),
      ],
    });
    const packed = packTimelineBarLanes(collectTimelineBars([parent], false), null);
    expect(packed.laneCount).toBe(2);
    expect(packed.items.find((item) => item.source.kind === "task")?.lane).not.toBe(
      packed.items.find((item) => item.source.kind === "childTask")?.lane,
    );
  });

  it("does not draw a nested task twice when it is also in the flat list", () => {
    const nested = childTask({
      id: "dated",
      parent_task_id: "parent",
      title: "有日期",
      due_at: "2026-08-10T12:00:00.000Z",
    });
    const parent = task({
      id: "parent",
      due_at: "2026-08-09T12:00:00.000Z",
      children: [nested],
    });
    const bars = collectTimelineBars([parent, nested], false);
    expect(bars.map((item) => item.id)).toEqual(["parent", "dated"]);
    expect(bars.map((item) => item.kind)).toEqual(["task", "childTask"]);
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

  it("draws dashed dependency paths only when both bars exist", () => {
    const predecessor = timelineBarBox("a", { left: 0, width: 80 }, 0, 0);
    const successor = timelineBarBox("b", { left: 200, width: 80 }, 40, 0);
    const paths = collectTimelineDependencyPaths(
      [predecessor, successor],
      [
        {
          id: "edge-1",
          task_id: "b",
          depends_on_task_id: "a",
        },
        {
          id: "edge-missing",
          task_id: "c",
          depends_on_task_id: "a",
        },
        {
          id: "edge-sub",
          task_id: "s1",
          depends_on_task_id: "s0",
        },
      ],
    );
    expect(paths).toHaveLength(1);
    expect(paths[0]?.id).toBe("edge-1");
    expect(paths[0]?.fromId).toBe("a");
    expect(paths[0]?.toId).toBe("b");
    expect(paths[0]?.d.startsWith(`M ${predecessor.left + predecessor.width} `)).toBe(true);
    expect(paths[0]?.d.endsWith(` ${successor.left} ${successor.top + successor.height / 2}`)).toBe(true);
    expect(paths[0]?.d).toContain(" C ");
    expect(paths[0]?.d).not.toContain(" L ");
    const subPaths = collectTimelineDependencyPaths(
      [
        timelineBarBox("s0", { left: 10, width: 40 }, 0, 0),
        timelineBarBox("s1", { left: 90, width: 40 }, 0, 1),
      ],
      [{
        id: "edge-sub",
        task_id: "s1",
        depends_on_task_id: "s0",
      }],
    );
    expect(subPaths).toHaveLength(1);
  });

  it("keeps the arrowhead on the dependent bar even when it starts earlier", () => {
    const predecessor = timelineBarBox("pred", { left: 200, width: 80 }, 0, 0);
    const successor = timelineBarBox("succ", { left: 40, width: 80 }, 40, 0);
    const d = buildTimelineDependencyPath(predecessor, successor);
    expect(d.startsWith(`M ${predecessor.left + predecessor.width} `)).toBe(true);
    expect(d.endsWith(` ${successor.left} ${successor.top + successor.height / 2}`)).toBe(true);
    expect(d).toContain(`L ${successor.left} `);
  });

  it("routes adjacent-day links through the channel instead of over the bars", () => {
    const origin = new Date(2026, 7, 1);
    const dayWidth = 30;
    const first = barGeometry({
      startDay: origin,
      endDay: origin,
      exclusiveEndDay: dayOffsetToDate(origin, 1),
      dayCount: 1,
      allDay: true,
    }, origin, dayWidth);
    const second = barGeometry({
      startDay: dayOffsetToDate(origin, 1),
      endDay: dayOffsetToDate(origin, 1),
      exclusiveEndDay: dayOffsetToDate(origin, 2),
      dayCount: 1,
      allDay: true,
    }, origin, dayWidth);
    const predecessor = {
      id: "a",
      ...first,
      top: 6,
      height: TIMELINE_BAR_HEIGHT,
    };
    const successor = {
      id: "b",
      ...second,
      top: 6,
      height: TIMELINE_BAR_HEIGHT,
    };
    const d = buildTimelineDependencyPath(predecessor, successor);
    expect(d).toContain(" C ");
    expect(d).not.toContain(" L ");
    expect(d.endsWith(` ${successor.left} ${successor.top + successor.height / 2}`)).toBe(true);
  });
});

function formatYmd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
