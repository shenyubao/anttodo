import {
  CalendarDays,
  ChevronDown,
  CloudOff,
  GripVertical,
  Inbox,
  ListPlus,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import clsx from "clsx";
import {
  buildScheduleTaskGroups,
  canRescheduleTask,
  clearSchedulePatch,
  isSchedulableTask,
} from "./lib/calendarScheduling";
import { chineseCalendarDetail, systemTimeZone } from "./lib/dateTimePreferences";
import type { TaskListGroup } from "./lib/taskList";
import {
  barGeometry,
  buildTimelineMonthSegments,
  clampTimelineLabelWidth,
  collectTimelineDependencyPaths,
  dayOffsetToDate,
  dayWidthForZoom,
  defaultTimelineLabelWidth,
  isSameCalendarDay,
  collectTimelineBars,
  packTimelineBarLanes,
  rehomeTimelineGroupBars,
  schedulePatchForTimelineDrop,
  schedulePatchForTimelineMove,
  schedulePatchForTimelineResize,
  shouldPlaceTimelineBarTitleOutside,
  taskBarRange,
  timelineBarBox,
  TIMELINE_BAR_TOP_INSET,
  TIMELINE_HEADER_HEIGHT,
  TIMELINE_LABEL_MAX_WIDTH,
  TIMELINE_LABEL_MIN_WIDTH,
  TIMELINE_PAD_DAYS,
  TIMELINE_ROW_HEIGHT,
  TIMELINE_TOTAL_DAYS,
  timelineDayHeader,
  timelineDayIsRest,
  timelineDays,
  timelineGroupRowHeight,
  timelineOrigin,
  xToDayOffset,
  type TimelineZoom,
} from "./lib/taskTimeline";
import { collectWorkspaceDependencies } from "./lib/taskDependencies";
import type {
  Label,
  ReminderSchedule,
  Task,
  WorkspaceBundle,
} from "./types";

const ZOOM_OPTIONS: Array<{ id: TimelineZoom; label: string }> = [
  { id: "day", label: "天" },
  { id: "week", label: "周" },
  { id: "month", label: "月" },
];

const ZOOM_STORAGE_KEY = "anttodo.timeline.zoom";
const PANEL_STORAGE_KEY = "anttodo.timeline.schedulePanel";
const LABEL_WIDTH_STORAGE_KEY = "anttodo.timeline.labelWidth";

function readZoom(): TimelineZoom {
  const stored = window.localStorage.getItem(ZOOM_STORAGE_KEY);
  if (stored === "day" || stored === "week" || stored === "month") return stored;
  return "week";
}

function readPanelOpen() {
  return window.localStorage.getItem(PANEL_STORAGE_KEY) !== "0";
}

function readStoredLabelWidth(): number | null {
  const stored = window.localStorage.getItem(LABEL_WIDTH_STORAGE_KEY);
  if (!stored) return null;
  const value = Number(stored);
  if (!Number.isFinite(value)) return null;
  return clampTimelineLabelWidth(value);
}

function scheduleForTask(task: Task): ReminderSchedule {
  return {
    reminders: task.reminders.map((reminder) => ({
      anchor: reminder.anchor,
      offset_value: reminder.offset_value,
      offset_unit: reminder.offset_unit,
      local_time: reminder.local_time,
    })),
    persistent: task.reminder_persistent,
    recurrence: task.recurrence ?? null,
  };
}

function labelColor(task: Task, labels: Label[]) {
  return labels.find((label) => !label.is_system && task.label_ids.includes(label.id))?.color ?? "#9EB3FC";
}

function barBackground(color: string, isChildTask: boolean) {
  if (!isChildTask) return color;
  return `color-mix(in srgb, ${color} 42%, white)`;
}

const BAR_DRAG_CLICK_THRESHOLD_PX = 4;

type PointerDrag =
  | {
    kind: "move";
    taskId: string;
    originX: number;
    dayDelta: number;
  }
  | {
    kind: "resize";
    taskId: string;
    edge: "start" | "end";
    originX: number;
    dayDelta: number;
  };

type TimelineRow = {
  id: string;
  title: string;
  bars: ReturnType<typeof collectTimelineBars>;
  laneCount: number;
  height: number;
  top: number;
};

export function TaskTimeline({
  tasks,
  groups,
  bundle,
  currentUserId,
  online,
  now,
  selectedTaskId,
  showCompleted,
  onSelectTask,
  onSaveTaskSchedule,
  onCreateOnDay,
  onNotice,
}: {
  tasks: Task[];
  groups: TaskListGroup[];
  bundle: WorkspaceBundle;
  currentUserId: string;
  online: boolean;
  now: Date;
  selectedTaskId: string | null;
  showCompleted: boolean;
  onSelectTask: (taskId: string) => void;
  onSaveTaskSchedule: (
    taskId: string,
    patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
    schedule: ReminderSchedule,
  ) => Promise<void>;
  onCreateOnDay: (day: Date) => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const writable = online;
  const timeZone = systemTimeZone();
  const [zoom, setZoom] = useState<TimelineZoom>(readZoom);
  const origin = useMemo(() => timelineOrigin(now), [now]);
  const days = useMemo(() => timelineDays(origin, TIMELINE_TOTAL_DAYS), [origin]);
  const monthSegments = useMemo(() => buildTimelineMonthSegments(days), [days]);
  const [panelOpen, setPanelOpen] = useState(readPanelOpen);
  const [labelWidth, setLabelWidth] = useState(
    () => readStoredLabelWidth() ?? TIMELINE_LABEL_MIN_WIDTH,
  );
  const labelWidthUserSet = useRef(readStoredLabelWidth() !== null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [pointerDrag, setPointerDrag] = useState<PointerDrag | null>(null);
  const pointerDragRef = useRef<PointerDrag | null>(null);
  const suppressBarClickRef = useRef(false);
  const [draggingScheduleTaskId, setDraggingScheduleTaskId] = useState<string | null>(null);
  const [hoveredBarId, setHoveredBarId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const labelsRowsRef = useRef<HTMLDivElement>(null);
  const syncingScroll = useRef(false);
  const didInitScroll = useRef(false);

  const dayWidth = dayWidthForZoom(zoom, viewportWidth || undefined);
  const canvasWidth = TIMELINE_TOTAL_DAYS * dayWidth;
  const listTaskIds = useMemo(() => new Set(tasks.map((task) => task.id)), [tasks]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const update = () => setViewportWidth(scroller.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (didInitScroll.current || !scrollerRef.current || dayWidth <= 0) return;
    didInitScroll.current = true;
    const todayOffset = TIMELINE_PAD_DAYS * dayWidth;
    scrollerRef.current.scrollLeft = Math.max(
      0,
      todayOffset - scrollerRef.current.clientWidth / 3,
    );
  }, [dayWidth]);

  function scrollToToday() {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const todayOffset = TIMELINE_PAD_DAYS * dayWidth;
    scroller.scrollTo({
      left: Math.max(0, todayOffset - scroller.clientWidth / 3),
      behavior: "smooth",
    });
  }

  const dependencyEdges = useMemo(
    () => collectWorkspaceDependencies(bundle.tasks),
    [bundle.tasks],
  );

  const timelineRows = useMemo(() => {
    const grouped = rehomeTimelineGroupBars(
      groups.map((group) => ({
        id: group.id,
        title: group.title || "全部",
        bars: collectTimelineBars(group.tasks, showCompleted),
      })),
      dependencyEdges,
    );
    const rows: TimelineRow[] = [];
    let top = 0;
    for (const group of grouped) {
      const { laneCount } = packTimelineBarLanes(group.bars, timeZone, dependencyEdges);
      const height = timelineGroupRowHeight(laneCount);
      rows.push({
        id: group.id,
        title: group.title,
        bars: group.bars,
        laneCount,
        height,
        top,
      });
      top += height;
    }
    return rows;
  }, [dependencyEdges, groups, showCompleted, timeZone]);

  const autoLabelWidth = useMemo(
    () => defaultTimelineLabelWidth(timelineRows.map((row) => row.title)),
    [timelineRows],
  );

  useEffect(() => {
    if (labelWidthUserSet.current) return;
    setLabelWidth(autoLabelWidth);
  }, [autoLabelWidth]);

  const bodyHeight = Math.max(
    timelineRows.reduce((sum, row) => sum + row.height, 0),
    TIMELINE_ROW_HEIGHT,
  );

  const packedByGroup = useMemo(() => {
    const map = new Map<string, ReturnType<typeof packTimelineBarLanes>>();
    for (const row of timelineRows) {
      map.set(row.id, packTimelineBarLanes(row.bars, timeZone, dependencyEdges));
    }
    return map;
  }, [dependencyEdges, timelineRows, timeZone]);

  const dependencyPaths = useMemo(() => {
    const boxes = timelineRows.flatMap((row) => {
      const packed = packedByGroup.get(row.id);
      if (!packed) return [];
      return packed.items.map(({ source, lane, range }) =>
        timelineBarBox(source.id, barGeometry(range, origin, dayWidth), row.top, lane),
      );
    });
    return collectTimelineDependencyPaths(boxes, dependencyEdges);
  }, [dayWidth, dependencyEdges, origin, packedByGroup, timelineRows]);

  const focusedBarId = hoveredBarId ?? selectedTaskId;

  const schedulePanelBundle = useMemo(() => ({
    ...bundle,
    tasks: bundle.tasks.filter((task) => listTaskIds.has(task.id)),
  }), [bundle, listTaskIds]);

  const scheduleGroups = useMemo(
    () => buildScheduleTaskGroups(schedulePanelBundle, currentUserId, pendingIds),
    [currentUserId, pendingIds, schedulePanelBundle],
  );

  useEffect(() => {
    window.localStorage.setItem(ZOOM_STORAGE_KEY, zoom);
  }, [zoom]);

  useEffect(() => {
    window.localStorage.setItem(PANEL_STORAGE_KEY, panelOpen ? "1" : "0");
  }, [panelOpen]);

  function syncVerticalScroll(source: "grid" | "labels") {
    if (syncingScroll.current) return;
    const scroller = scrollerRef.current;
    const labels = labelsRowsRef.current;
    if (!scroller || !labels) return;
    syncingScroll.current = true;
    if (source === "grid") labels.scrollTop = scroller.scrollTop;
    else scroller.scrollTop = labels.scrollTop;
    requestAnimationFrame(() => {
      syncingScroll.current = false;
    });
  }

  function resizeLabelByPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = labelWidth;
    handle.setPointerCapture(pointerId);
    document.body.classList.add("is-panel-resizing");

    const onPointerMove = (moveEvent: PointerEvent) => {
      const next = clampTimelineLabelWidth(startWidth + (moveEvent.clientX - startX));
      setLabelWidth(next);
    };

    const finishResize = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      document.body.classList.remove("is-panel-resizing");
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      labelWidthUserSet.current = true;
      setLabelWidth((current) => {
        window.localStorage.setItem(LABEL_WIDTH_STORAGE_KEY, String(current));
        return current;
      });
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  }

  function resizeLabelByKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    let nextWidth: number | null = null;
    if (event.key === "Home") nextWidth = TIMELINE_LABEL_MIN_WIDTH;
    if (event.key === "End") nextWidth = TIMELINE_LABEL_MAX_WIDTH;
    if (event.key === "ArrowLeft") nextWidth = labelWidth - 10;
    if (event.key === "ArrowRight") nextWidth = labelWidth + 10;
    if (nextWidth === null) return;
    event.preventDefault();
    const next = clampTimelineLabelWidth(nextWidth);
    labelWidthUserSet.current = true;
    setLabelWidth(next);
    window.localStorage.setItem(LABEL_WIDTH_STORAGE_KEY, String(next));
  }

  async function applySchedule(
    task: Task,
    patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
    failureMessage: string,
  ) {
    if (!writable || pendingIds.has(task.id) || !canRescheduleTask(bundle, task, currentUserId)) {
      return;
    }
    setPendingIds((current) => new Set(current).add(task.id));
    try {
      await onSaveTaskSchedule(task.id, patch, scheduleForTask(task));
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : failureMessage);
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  }

  function dayFromClientX(clientX: number) {
    const scroller = scrollerRef.current;
    if (!scroller) return null;
    const bounds = scroller.getBoundingClientRect();
    const x = clientX - bounds.left + scroller.scrollLeft;
    const offset = Math.max(0, Math.min(TIMELINE_TOTAL_DAYS - 1, xToDayOffset(x, dayWidth)));
    return dayOffsetToDate(origin, offset);
  }

  function startMove(task: Task, event: ReactPointerEvent) {
    if (!writable || !canRescheduleTask(bundle, task, currentUserId)) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const drag: PointerDrag = {
      kind: "move",
      taskId: task.id,
      originX: event.clientX,
      dayDelta: 0,
    };
    pointerDragRef.current = drag;
    setPointerDrag(drag);
  }

  function startResize(task: Task, edge: "start" | "end", event: ReactPointerEvent) {
    if (!writable || !canRescheduleTask(bundle, task, currentUserId)) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const drag: PointerDrag = {
      kind: "resize",
      taskId: task.id,
      edge,
      originX: event.clientX,
      dayDelta: 0,
    };
    pointerDragRef.current = drag;
    setPointerDrag(drag);
  }

  function onPointerMove(event: ReactPointerEvent) {
    const current = pointerDragRef.current;
    if (!current) return;
    const delta = Math.round((event.clientX - current.originX) / dayWidth);
    if (delta === current.dayDelta) return;
    const next = { ...current, dayDelta: delta };
    pointerDragRef.current = next;
    setPointerDrag(next);
  }

  async function onPointerUp(event: ReactPointerEvent) {
    const drag = pointerDragRef.current;
    if (!drag) return;
    pointerDragRef.current = null;
    setPointerDrag(null);
    const movedPx = Math.abs(event.clientX - drag.originX);
    if (movedPx >= BAR_DRAG_CLICK_THRESHOLD_PX || drag.dayDelta !== 0) {
      suppressBarClickRef.current = true;
    }
    if (drag.dayDelta === 0) return;
    const task = bundle.tasks.find((item) => item.id === drag.taskId);
    if (!task) return;
    const patch = drag.kind === "move"
      ? schedulePatchForTimelineMove(task, drag.dayDelta, timeZone)
      : schedulePatchForTimelineResize(task, drag.edge, drag.dayDelta, timeZone);
    if (!patch) return;
    await applySchedule(
      task,
      patch,
      drag.kind === "move" ? "任务改期失败，请重试" : "调整时长失败，请重试",
    );
  }

  function openBar(
    source: { kind: "task" | "childTask"; task: Task; childTask: { id: string } | null },
    event: ReactMouseEvent,
  ) {
    event.stopPropagation();
    if (suppressBarClickRef.current) {
      suppressBarClickRef.current = false;
      return;
    }
    onSelectTask(source.childTask?.id ?? source.task.id);
  }

  async function onGridDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!writable || event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".timeline-bar")) return;
    const day = dayFromClientX(event.clientX);
    if (!day) return;
    try {
      await onCreateOnDay(day);
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : "创建任务失败，请重试");
    }
  }

  function onScheduleDragStart(taskId: string, event: ReactDragEvent) {
    if (!writable) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/anttodo-task-id", taskId);
    event.dataTransfer.effectAllowed = "move";
    setDraggingScheduleTaskId(taskId);
  }

  function onScheduleDragEnd() {
    setDraggingScheduleTaskId(null);
  }

  async function onCanvasDrop(event: ReactDragEvent) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/anttodo-task-id");
    setDraggingScheduleTaskId(null);
    if (!taskId || !writable) return;
    const task = bundle.tasks.find((item) => item.id === taskId);
    const day = dayFromClientX(event.clientX);
    if (!task || !day || !isSchedulableTask(bundle, task, currentUserId)) return;
    await applySchedule(
      task,
      schedulePatchForTimelineDrop(day, timeZone),
      "任务安排失败，请重试",
    );
  }

  async function unscheduleTask(task: Task) {
    await applySchedule(task, clearSchedulePatch(), "取消任务安排失败，请重试");
  }

  return (
    <div className={clsx("timeline-workspace", `zoom-${zoom}`)}>
      {!online && (
        <div className="offline-banner">
          <CloudOff size={16} />
          当前显示上次缓存，恢复网络后会自动刷新
        </div>
      )}
      <header className="timeline-toolbar">
        <div className="timeline-zoom" role="group" aria-label="时间比例">
          {ZOOM_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={zoom === option.id ? "selected" : undefined}
              aria-pressed={zoom === option.id}
              onClick={() => {
                didInitScroll.current = false;
                setZoom(option.id);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" className="timeline-toolbar-button" onClick={scrollToToday}>
          今天
        </button>
        <button
          type="button"
          className={clsx("timeline-toolbar-button", panelOpen && "selected")}
          aria-pressed={panelOpen}
          onClick={() => setPanelOpen((value) => !value)}
        >
          <ListPlus size={16} />
          安排任务
        </button>
      </header>
      <div className={clsx("timeline-body", panelOpen && "has-panel")}>
        <div
          className="timeline-main"
          ref={bodyRef}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => void onPointerUp(event)}
          onPointerCancel={(event) => void onPointerUp(event)}
        >
          <div
            className="timeline-scroller"
            ref={scrollerRef}
            onScroll={() => syncVerticalScroll("grid")}
            onDragOver={(event) => {
              if (draggingScheduleTaskId) event.preventDefault();
            }}
            onDrop={(event) => void onCanvasDrop(event)}
            onDoubleClick={(event) => void onGridDoubleClick(event)}
          >
            <div
              className="timeline-canvas"
              style={{ width: canvasWidth, minHeight: TIMELINE_HEADER_HEIGHT + bodyHeight }}
            >
              <div
                className="timeline-header"
                style={{ height: TIMELINE_HEADER_HEIGHT, width: canvasWidth }}
              >
                <div
                  className="timeline-month-axis"
                  style={{ width: canvasWidth }}
                  aria-hidden="true"
                >
                  {monthSegments.map((segment) => (
                    <div
                      key={segment.key}
                      className="timeline-month-segment"
                      style={{
                        left: segment.startIndex * dayWidth,
                        width: segment.dayCount * dayWidth,
                      }}
                    >
                      <span>{segment.label}</span>
                    </div>
                  ))}
                </div>
                <div
                  className="timeline-header-days"
                  style={{ width: canvasWidth }}
                >
                  {days.map((day) => {
                    const detail = chineseCalendarDetail(day);
                    const header = timelineDayHeader(day, zoom, detail);
                    const isToday = isSameCalendarDay(day, now);
                    const isWeekStart = day.getDay() === 1;
                    return (
                      <div
                        key={day.toISOString()}
                        className={clsx(
                          "timeline-header-day",
                          isToday && "is-today",
                          header.isRestDay && "is-rest",
                          !header.showTitle && "is-blank",
                          isWeekStart && "is-week-start",
                        )}
                        style={{ width: dayWidth }}
                      >
                        {header.showTitle && (
                          <>
                            <span className="timeline-header-weekday">{header.weekday}</span>
                            <span className="timeline-header-date">
                              {header.dayNumber}
                              {header.holidayLabel && (
                                <em
                                  className={clsx(
                                    "timeline-holiday-badge",
                                    header.holidayLabel === "班" && "workday",
                                  )}
                                  title={header.holidayName ?? undefined}
                                >
                                  {header.holidayLabel}
                                </em>
                              )}
                            </span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div
                className="timeline-grid"
                style={{ width: canvasWidth, height: bodyHeight }}
              >
                {days.map((day) => {
                  const detail = chineseCalendarDetail(day);
                  const isRestDay = timelineDayIsRest(day, detail);
                  return (
                    <div
                      key={`grid-${day.toISOString()}`}
                      className={clsx(
                        "timeline-grid-col",
                        isSameCalendarDay(day, now) && "is-today",
                        isRestDay && "is-rest",
                        day.getDay() === 1 && "is-week-start",
                      )}
                      style={{ width: dayWidth }}
                    />
                  );
                })}
                {timelineRows.map((row) => (
                  <div
                    key={`band-${row.id}`}
                    className="timeline-group-band"
                    style={{ top: row.top, height: row.height }}
                  />
                ))}
                {dependencyPaths.length > 0 && (
                  <svg
                    className={clsx(
                      "timeline-dependency-layer",
                      focusedBarId && "has-focus",
                    )}
                    width={canvasWidth}
                    height={bodyHeight}
                    aria-hidden="true"
                  >
                    <defs>
                      <marker
                        id="timeline-dependency-arrow"
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="8"
                        markerHeight="8"
                        orient="auto"
                        markerUnits="userSpaceOnUse"
                      >
                        <path d="M 0 0 L 10 5 L 0 10 z" />
                      </marker>
                    </defs>
                    {dependencyPaths.map((path) => {
                      const isActive = Boolean(
                        focusedBarId
                        && (path.fromId === focusedBarId || path.toId === focusedBarId),
                      );
                      return (
                        <g
                          key={path.id}
                          className={clsx(
                            "timeline-dependency-link",
                            isActive && "is-active",
                          )}
                        >
                          <path className="timeline-dependency-edge-halo" d={path.d} />
                          <path
                            className="timeline-dependency-edge"
                            d={path.d}
                            markerEnd="url(#timeline-dependency-arrow)"
                          />
                        </g>
                      );
                    })}
                  </svg>
                )}
                {timelineRows.flatMap((row) => {
                  const packed = packedByGroup.get(row.id);
                  if (!packed) return [];
                  return packed.items.map(({ source, task, lane, range }) => {
                    const isChildTask = source.kind === "childTask";
                    const drag = pointerDrag?.taskId === task.id ? pointerDrag : null;
                    let displayRange = range;
                    if (!isChildTask && drag) {
                      if (drag.kind === "move" && drag.dayDelta !== 0) {
                        const patch = schedulePatchForTimelineMove(
                          task,
                          drag.dayDelta,
                          timeZone,
                        );
                        if (patch) {
                          displayRange = taskBarRange({ ...task, ...patch }, timeZone) ?? range;
                        }
                      } else if (drag.kind === "resize" && drag.dayDelta !== 0) {
                        const patch = schedulePatchForTimelineResize(
                          task,
                          drag.edge,
                          drag.dayDelta,
                          timeZone,
                        );
                        if (patch) {
                          displayRange = taskBarRange({ ...task, ...patch }, timeZone) ?? range;
                        }
                      }
                    }
                    const { left, width } = barGeometry(displayRange, origin, dayWidth);
                    const titleOutside = shouldPlaceTimelineBarTitleOutside(source.title, width);
                    const color = labelColor(task, bundle.labels);
                    const editable = !isChildTask
                      && writable
                      && canRescheduleTask(bundle, task, currentUserId)
                      && !pendingIds.has(task.id);
                    const selected = selectedTaskId === (source.childTask?.id ?? task.id);
                    return (
                      <div
                        key={source.id}
                        className={clsx(
                          "timeline-bar",
                          isChildTask && "is-childTask",
                          selected && "selected",
                          source.completed && "completed",
                          (source.childTask ?? source.task).status === "cancelled" && "cancelled",
                          editable && "editable",
                          !isChildTask && pendingIds.has(task.id) && "pending",
                          titleOutside && "title-outside",
                        )}
                        style={{
                          top: row.top + lane * TIMELINE_ROW_HEIGHT + TIMELINE_BAR_TOP_INSET,
                          left,
                          width,
                          backgroundColor: barBackground(color, isChildTask),
                        }}
                        title={source.title}
                        onMouseEnter={() => setHoveredBarId(source.id)}
                        onMouseLeave={() => setHoveredBarId((current) => (
                          current === source.id ? null : current
                        ))}
                        onClick={(event) => openBar(source, event)}
                        onPointerDown={(event) => {
                          if (isChildTask) return;
                          if ((event.target as HTMLElement).closest(".timeline-bar-handle")) {
                            return;
                          }
                          if ((event.target as HTMLElement).closest(".timeline-bar-title-outside")) {
                            return;
                          }
                          startMove(task, event);
                        }}
                        onDoubleClick={(event) => event.stopPropagation()}
                        draggable={false}
                      >
                        {editable && (
                          <span
                            className="timeline-bar-handle start"
                            onPointerDown={(event) => startResize(task, "start", event)}
                          />
                        )}
                        <span
                          className={clsx(
                            "timeline-bar-title",
                            titleOutside && "timeline-bar-title-outside",
                          )}
                          onClick={(event) => openBar(source, event)}
                        >
                          {source.title}
                        </span>
                        {editable && (
                          <span
                            className="timeline-bar-handle end"
                            onPointerDown={(event) => startResize(task, "end", event)}
                          />
                        )}
                      </div>
                    );
                  });
                })}
              </div>
            </div>
          </div>
          <div
            className="timeline-labels"
            style={{
              width: labelWidth,
              top: TIMELINE_HEADER_HEIGHT,
            }}
          >
            <div
              className="timeline-labels-rows"
              ref={labelsRowsRef}
              onScroll={() => syncVerticalScroll("labels")}
            >
              {timelineRows.map((row) => (
                <div
                  key={row.id}
                  className="timeline-label-row is-group"
                  style={{ height: row.height }}
                >
                  <span className="timeline-group-title" title={row.title}>
                    {row.title}
                  </span>
                  <em className="timeline-group-count">{row.bars.length}</em>
                </div>
              ))}
              {timelineRows.length === 0 && (
                <div className="timeline-empty-row" style={{ height: TIMELINE_ROW_HEIGHT }}>
                  暂无已安排的任务
                </div>
              )}
            </div>
            <div
              className="panel-resize-handle timeline-label-resize-handle"
              role="separator"
              aria-label="调整分组列宽度"
              aria-orientation="vertical"
              aria-valuemin={TIMELINE_LABEL_MIN_WIDTH}
              aria-valuemax={TIMELINE_LABEL_MAX_WIDTH}
              aria-valuenow={labelWidth}
              tabIndex={0}
              onPointerDown={resizeLabelByPointer}
              onKeyDown={resizeLabelByKeyboard}
            />
          </div>
        </div>
        {panelOpen && (
          <SchedulePanel
            groups={scheduleGroups}
            online={writable}
            draggingTaskId={draggingScheduleTaskId}
            onClose={() => setPanelOpen(false)}
            onSelectTask={onSelectTask}
            onDragStart={onScheduleDragStart}
            onDragEnd={onScheduleDragEnd}
            onDropUnschedule={(taskId) => {
              const task = bundle.tasks.find((item) => item.id === taskId);
              if (task) void unscheduleTask(task);
            }}
          />
        )}
      </div>
    </div>
  );
}

function SchedulePanel({
  groups,
  online,
  draggingTaskId,
  onClose,
  onSelectTask,
  onDragStart,
  onDragEnd,
  onDropUnschedule,
}: {
  groups: ReturnType<typeof buildScheduleTaskGroups>;
  online: boolean;
  draggingTaskId: string | null;
  onClose: () => void;
  onSelectTask: (taskId: string) => void;
  onDragStart: (taskId: string, event: ReactDragEvent) => void;
  onDragEnd: () => void;
  onDropUnschedule: (taskId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  return (
    <aside
      className="calendar-schedule-panel timeline-schedule-panel"
      aria-label="安排任务"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("text/anttodo-task-id")) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        const taskId = event.dataTransfer.getData("text/anttodo-task-id");
        if (taskId) onDropUnschedule(taskId);
      }}
    >
      <header className="calendar-schedule-header">
        <strong>安排任务</strong>
        <button type="button" aria-label="关闭安排任务" onClick={onClose}><X /></button>
      </header>
      {!online && <p className="calendar-schedule-offline">离线模式下只能查看任务</p>}
      <div className="calendar-schedule-groups">
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.id);
          const color = group.label?.color ?? "#8e95a3";
          return (
            <section
              className="calendar-schedule-group"
              key={group.id}
              style={{ "--schedule-label-color": color } as CSSProperties}
            >
              <button
                type="button"
                className="calendar-schedule-group-header"
                style={{ paddingLeft: 12 + group.depth * 14 }}
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(group.id)) next.delete(group.id);
                  else next.add(group.id);
                  return next;
                })}
              >
                <ChevronDown />
                {group.label ? <i /> : <Inbox />}
                <span>{group.label?.name ?? "收集箱"}</span>
                <em>{group.tasks.length}</em>
              </button>
              {!isCollapsed && group.tasks.map((task) => (
                <div
                  className={clsx("calendar-schedule-task", online && "is-draggable")}
                  key={`${group.id}:${task.id}`}
                  draggable={online}
                  onDragStart={(event) => onDragStart(task.id, event)}
                  onDragEnd={onDragEnd}
                  title={online ? "拖到时间线中安排日期" : "离线模式下不能安排任务"}
                >
                  <GripVertical className="calendar-schedule-drag-handle" aria-hidden="true" />
                  <button type="button" onClick={() => onSelectTask(task.id)}>{task.title}</button>
                </div>
              ))}
            </section>
          );
        })}
        {groups.length === 0 && (
          <div className="calendar-schedule-empty">
            <CalendarDays />
            <strong>没有待安排的任务</strong>
            <span>未设置截止时间的待办会显示在这里</span>
          </div>
        )}
      </div>
      {draggingTaskId && (
        <div className="calendar-schedule-drop-hint" role="status">
          拖回收可取消安排
        </div>
      )}
    </aside>
  );
}
