import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  format,
  startOfDay,
} from "date-fns";
import type { Task } from "../types";
import { fromZonedDateTime, toDateInput } from "./dateTimePreferences";
import { schedulePatchFromDrop } from "./calendarScheduling";

export type TimelineZoom = "day" | "week" | "month";

/**
 * How many days should fit in the viewport at each zoom.
 * Used only to derive single-day column width — not the calendar length.
 */
export const TIMELINE_VISIBLE_DAYS: Record<TimelineZoom, number> = {
  day: 12,
  week: 31,
  month: 62,
};

/** Fallback viewport width when the scroller has not been measured yet. */
export const TIMELINE_DEFAULT_VIEWPORT_WIDTH = 960;
export const TIMELINE_MIN_DAY_WIDTH = 8;
export const TIMELINE_MAX_DAY_WIDTH = 120;

/** Half-range of the full scrollable calendar around today (inclusive of today). */
export const TIMELINE_PAD_DAYS = 180;
export const TIMELINE_TOTAL_DAYS = TIMELINE_PAD_DAYS * 2 + 1;

export const TIMELINE_ROW_HEIGHT = 40;
export const TIMELINE_MONTH_AXIS_HEIGHT = 22;
export const TIMELINE_DAY_HEADER_HEIGHT = 40;
export const TIMELINE_HEADER_HEIGHT = TIMELINE_MONTH_AXIS_HEIGHT + TIMELINE_DAY_HEADER_HEIGHT;
export const TIMELINE_LABEL_WIDTH = 220;
export const TIMELINE_LABEL_MIN_WIDTH = 96;
export const TIMELINE_LABEL_MAX_WIDTH = 420;
/** Horizontal padding + count badge + gap inside a group label row. */
export const TIMELINE_LABEL_CHROME_WIDTH = 14 + 12 + 8 + 28;

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"] as const;

/** Approximate character width for 14px/600 system UI fonts (CSS px). */
function approxCharWidth(char: string) {
  const code = char.codePointAt(0) ?? 0;
  if (code <= 0x7f) return 8.2;
  if (code <= 0xff) return 9;
  return 14;
}

export function measureTimelineLabelTextWidth(text: string) {
  let width = 0;
  for (const char of text) width += approxCharWidth(char);
  return width;
}

/**
 * Default label column width from group titles (and optional header).
 * Clamped to min/max; chrome accounts for padding and count badge.
 */
export function defaultTimelineLabelWidth(
  titles: readonly string[],
  header = "分组",
) {
  let maxText = measureTimelineLabelTextWidth(header);
  for (const title of titles) {
    maxText = Math.max(maxText, measureTimelineLabelTextWidth(title || "全部"));
  }
  const next = Math.ceil(maxText + TIMELINE_LABEL_CHROME_WIDTH);
  return Math.min(
    TIMELINE_LABEL_MAX_WIDTH,
    Math.max(TIMELINE_LABEL_MIN_WIDTH, next),
  );
}

export function clampTimelineLabelWidth(width: number) {
  return Math.min(
    TIMELINE_LABEL_MAX_WIDTH,
    Math.max(TIMELINE_LABEL_MIN_WIDTH, Math.round(width)),
  );
}
/** Full scrollable calendar length is independent of zoom. */
export type TimelineBarRange = {
  startDay: Date;
  endDay: Date;
  /** Exclusive end for pixel width (day after last inclusive end day). */
  exclusiveEndDay: Date;
  dayCount: number;
  allDay: boolean;
};

/**
 * Day column width from viewport width / visible-day count for the zoom.
 * 12 / 31 / 62 days are density targets, not the calendar length.
 */
export function dayWidthForZoom(
  zoom: TimelineZoom,
  viewportWidth = TIMELINE_DEFAULT_VIEWPORT_WIDTH,
) {
  const visible = TIMELINE_VISIBLE_DAYS[zoom];
  const width = Math.floor(Math.max(1, viewportWidth) / visible);
  return Math.min(
    TIMELINE_MAX_DAY_WIDTH,
    Math.max(TIMELINE_MIN_DAY_WIDTH, width),
  );
}

export function timelineVisibleDays(zoom: TimelineZoom) {
  return TIMELINE_VISIBLE_DAYS[zoom];
}

/** Full calendar origin: today - TIMELINE_PAD_DAYS. */
export function timelineOrigin(today: Date = new Date()) {
  return startOfDay(addDays(today, -TIMELINE_PAD_DAYS));
}

export function timelineDays(origin: Date, totalDays = TIMELINE_TOTAL_DAYS) {
  return eachDayOfInterval({
    start: origin,
    end: addDays(origin, totalDays - 1),
  });
}

export type TimelineMonthSegment = {
  key: string;
  label: string;
  startIndex: number;
  dayCount: number;
};

/** Merge consecutive days that share the same calendar month into axis segments. */
export function buildTimelineMonthSegments(days: readonly Date[]): TimelineMonthSegment[] {
  const segments: TimelineMonthSegment[] = [];
  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    const key = `${day.getFullYear()}-${day.getMonth()}`;
    const last = segments[segments.length - 1];
    if (last && last.key === key) {
      last.dayCount += 1;
      continue;
    }
    segments.push({
      key,
      label: `${day.getMonth() + 1}月`,
      startIndex: index,
      dayCount: 1,
    });
  }
  return segments;
}

export type TimelineDayHeader = {
  weekday: string;
  dayNumber: string;
  showTitle: boolean;
  isWeekend: boolean;
  /** 休息日（周末 / 休），工作日含调休「班」。用于列背景色。 */
  isRestDay: boolean;
  holidayLabel: "休" | "班" | null;
  holidayName: string | null;
};

export function chineseWeekdayLabel(day: Date) {
  return WEEKDAY_LABELS[day.getDay()] ?? "";
}

/**
 * Rest-day columns (weekends + legal holidays).
 * "班" overrides weekend to workday; "休" overrides weekdays to rest.
 */
export function timelineDayIsRest(
  day: Date,
  holiday: { holidayLabel: "休" | "班" | null } | null = null,
) {
  if (holiday?.holidayLabel === "休") return true;
  if (holiday?.holidayLabel === "班") return false;
  const dow = day.getDay();
  return dow === 0 || dow === 6;
}

/**
 * Day/week: weekday above + date below every day.
 * Month: only Mondays carry a title to keep the axis sparse.
 */
export function timelineDayHeader(
  day: Date,
  zoom: TimelineZoom,
  holiday: { holidayLabel: "休" | "班" | null; holidayName: string | null } | null = null,
): TimelineDayHeader {
  const isMonday = day.getDay() === 1;
  const showTitle = zoom !== "month" || isMonday;
  return {
    weekday: showTitle ? chineseWeekdayLabel(day) : "",
    dayNumber: showTitle ? String(day.getDate()) : "",
    showTitle,
    isWeekend: day.getDay() === 0 || day.getDay() === 6,
    isRestDay: timelineDayIsRest(day, holiday),
    holidayLabel: showTitle ? holiday?.holidayLabel ?? null : null,
    holidayName: showTitle ? holiday?.holidayName ?? null : null,
  };
}

export function splitTimelineTasks(tasks: Task[]) {
  const scheduled: Task[] = [];
  const unscheduled: Task[] = [];
  for (const task of tasks) {
    if (task.deleted_at) continue;
    if (task.due_at) scheduled.push(task);
    else if (task.kind === "todo") unscheduled.push(task);
  }
  scheduled.sort((left, right) => {
    const leftStart = left.due_start_at ?? left.due_at!;
    const rightStart = right.due_start_at ?? right.due_at!;
    return leftStart.localeCompare(rightStart)
      || left.title.localeCompare(right.title, "zh-CN")
      || left.id.localeCompare(right.id);
  });
  return { scheduled, unscheduled };
}

function parseYmdLocal(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function taskDayValue(iso: string, timeZone: string | null | undefined) {
  return parseYmdLocal(toDateInput(iso, timeZone ?? null));
}

/**
 * Inclusive calendar-day range for a scheduled task.
 * Point due (no due_start_at) occupies a single day.
 */
export function taskBarRange(
  task: Task,
  timeZone?: string | null,
): TimelineBarRange | null {
  if (!task.due_at) return null;
  const zone = timeZone ?? task.due_timezone;
  if (!task.due_start_at) {
    const day = taskDayValue(task.due_at, zone);
    return {
      startDay: day,
      endDay: day,
      exclusiveEndDay: addDays(day, 1),
      dayCount: 1,
      allDay: task.due_is_all_day,
    };
  }
  const startDay = taskDayValue(task.due_start_at, zone);
  const endDay = taskDayValue(task.due_at, zone);
  const dayCount = Math.max(1, differenceInCalendarDays(endDay, startDay) + 1);
  return {
    startDay,
    endDay,
    exclusiveEndDay: addDays(startDay, dayCount),
    dayCount,
    allDay: task.due_is_all_day,
  };
}

export function dateToX(date: Date, origin: Date, dayWidth: number) {
  return differenceInCalendarDays(startOfDay(date), origin) * dayWidth;
}

export function xToDayOffset(x: number, dayWidth: number) {
  if (dayWidth <= 0) return 0;
  return Math.floor(x / dayWidth);
}

export function dayOffsetToDate(origin: Date, dayOffset: number) {
  return addDays(origin, dayOffset);
}

export function barGeometry(
  range: TimelineBarRange,
  origin: Date,
  dayWidth: number,
) {
  const left = dateToX(range.startDay, origin, dayWidth);
  const width = Math.max(dayWidth * 0.6, range.dayCount * dayWidth - 2);
  return { left, width };
}

/** Horizontal padding used when estimating title space inside a bar. */
export const TIMELINE_BAR_TITLE_INSET = 20;

/**
 * Whether the bar is too narrow for an inline title (place it after the bar instead).
 * Approximates 12px UI text; Chinese glyphs ~12px, ASCII ~7px.
 */
export function shouldPlaceTimelineBarTitleOutside(title: string, barWidth: number) {
  if (barWidth <= 0) return true;
  let textWidth = 0;
  for (const char of title) {
    const code = char.codePointAt(0) ?? 0;
    textWidth += code <= 0x7f ? 7 : 12;
  }
  return textWidth + TIMELINE_BAR_TITLE_INSET > barWidth;
}

export function allDayRangePatch(
  startDay: Date,
  endDay: Date,
  timeZone: string | null,
): Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone"> {
  const startValue = timeZone
    ? toDateInput(startDay, timeZone)
    : format(startDay, "yyyy-MM-dd");
  const endValue = timeZone
    ? toDateInput(endDay, timeZone)
    : format(endDay, "yyyy-MM-dd");
  const start = fromZonedDateTime(startValue, "00:00", timeZone);
  const end = fromZonedDateTime(endValue, "23:59", timeZone);
  end.setSeconds(59, 999);
  return {
    due_start_at: new Date(start.getTime()).toISOString(),
    due_at: new Date(end.getTime()).toISOString(),
    due_is_all_day: true,
    due_timezone: timeZone,
  };
}

export function schedulePatchForTimelineDrop(
  date: Date,
  timeZone: string | null,
) {
  return schedulePatchFromDrop(date, true, timeZone);
}

/**
 * Move a bar by a whole-day delta, preserving span and timed-vs-all-day shape.
 */
export function schedulePatchForTimelineMove(
  task: Task,
  dayDelta: number,
  timeZone: string | null,
): Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone"> | null {
  if (!task.due_at || dayDelta === 0) return null;
  const range = taskBarRange(task, timeZone ?? task.due_timezone);
  if (!range) return null;

  const nextStart = addDays(range.startDay, dayDelta);
  const nextEnd = addDays(range.endDay, dayDelta);

  if (!task.due_start_at) {
    if (task.due_is_all_day) {
      return allDayRangePatch(nextStart, nextEnd, timeZone);
    }
    // Point timed: shift due_at by calendar days.
    return {
      due_at: addDays(new Date(task.due_at), dayDelta).toISOString(),
      due_start_at: null,
      due_is_all_day: false,
      due_timezone: timeZone,
    };
  }

  if (task.due_is_all_day) {
    return allDayRangePatch(nextStart, nextEnd, timeZone);
  }

  const durationMs = Math.max(
    0,
    new Date(task.due_at).getTime() - new Date(task.due_start_at).getTime(),
  );
  const nextStartAt = addDays(new Date(task.due_start_at), dayDelta);
  return {
    due_start_at: nextStartAt.toISOString(),
    due_at: new Date(nextStartAt.getTime() + durationMs).toISOString(),
    due_is_all_day: false,
    due_timezone: timeZone,
  };
}

/**
 * Resize a bar from the start or end edge by whole days. Minimum span is 1 day.
 */
export function schedulePatchForTimelineResize(
  task: Task,
  edge: "start" | "end",
  dayDelta: number,
  timeZone: string | null,
): Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone"> | null {
  if (!task.due_at || dayDelta === 0) return null;
  const range = taskBarRange(task, timeZone ?? task.due_timezone);
  if (!range) return null;

  let startDay = range.startDay;
  let endDay = range.endDay;
  if (edge === "start") {
    startDay = addDays(startDay, dayDelta);
    if (startDay > endDay) startDay = endDay;
  } else {
    endDay = addDays(endDay, dayDelta);
    if (endDay < startDay) endDay = startDay;
  }

  // Always store as all-day range after resize for clear day-granularity.
  return allDayRangePatch(startDay, endDay, timeZone);
}

export function headerLabelForDay(day: Date, zoom: TimelineZoom) {
  const header = timelineDayHeader(day, zoom);
  if (!header.showTitle) return "";
  return `${header.weekday}${header.dayNumber}`;
}

export function isSameCalendarDay(left: Date, right: Date) {
  return differenceInCalendarDays(startOfDay(left), startOfDay(right)) === 0;
}

export type TimelineLaneItem = {
  task: Task;
  lane: number;
  range: TimelineBarRange;
};

/** Pack scheduled tasks into non-overlapping horizontal lanes within a group row. */
export function packTimelineLanes(
  tasks: Task[],
  timeZone: string | null,
): { items: TimelineLaneItem[]; laneCount: number } {
  const ranged = tasks
    .map((task) => {
      const range = taskBarRange(task, timeZone ?? task.due_timezone);
      return range ? { task, range } : null;
    })
    .filter((item): item is { task: Task; range: TimelineBarRange } => item !== null)
    .sort((left, right) => {
      const start = differenceInCalendarDays(left.range.startDay, right.range.startDay);
      if (start !== 0) return start;
      const span = left.range.dayCount - right.range.dayCount;
      if (span !== 0) return span;
      return left.task.title.localeCompare(right.task.title, "zh-CN")
        || left.task.id.localeCompare(right.task.id);
    });

  const laneExclusiveEnds: Date[] = [];
  const items: TimelineLaneItem[] = [];
  for (const { task, range } of ranged) {
    let lane = laneExclusiveEnds.findIndex(
      (end) => differenceInCalendarDays(range.startDay, end) >= 0,
    );
    if (lane < 0) {
      lane = laneExclusiveEnds.length;
      laneExclusiveEnds.push(range.exclusiveEndDay);
    } else {
      laneExclusiveEnds[lane] = range.exclusiveEndDay;
    }
    items.push({ task, lane, range });
  }
  return {
    items,
    laneCount: Math.max(1, laneExclusiveEnds.length),
  };
}

export function timelineGroupRowHeight(laneCount: number) {
  return Math.max(1, laneCount) * TIMELINE_ROW_HEIGHT;
}
