import FullCalendar, {
  type CalendarRef,
  type DatesSetInfo,
  type EventDragStartInfo,
  type EventDragStopInfo,
  type EventDropInfo,
  type EventReceiveInfo,
  type EventInput,
} from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin, { Draggable } from "@fullcalendar/react/interaction";
import listPlugin from "@fullcalendar/react/list";
import multiMonthPlugin from "@fullcalendar/react/multimonth";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import zhCnLocale from "@fullcalendar/react/locales/zh-cn";
import classicTheme from "@fullcalendar/react/themes/classic";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import {
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Inbox,
  PanelLeft,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  addDays,
  addMonths,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  chineseCalendarDetail,
  systemTimeZone,
  weekdayLabels,
} from "./lib/dateTimePreferences";
import {
  buildScheduleTaskGroups,
  canRescheduleTask,
  clearSchedulePatch,
  schedulePatchForCalendarMove,
  schedulePatchFromDrop,
} from "./lib/calendarScheduling";
import { compareSiblingLabels, userLabelOrderMap } from "./lib/labels";
import type {
  DateTimePreferences,
  Label,
  ReminderSchedule,
  Task,
  WorkspaceBundle,
} from "./types";

type CalendarViewId =
  | "day"
  | "week"
  | "month"
  | "year"
  | "agenda"
  | "multiDay"
  | "multiWeek";

type CalendarViewDefinition = {
  id: CalendarViewId;
  label: string;
  fullCalendarView: string;
  shortcut: string;
};

const CALENDAR_VIEWS: CalendarViewDefinition[] = [
  { id: "day", label: "日", fullCalendarView: "timeGridDay", shortcut: "D/1" },
  { id: "week", label: "周", fullCalendarView: "timeGridWeek", shortcut: "W/2" },
  { id: "month", label: "月", fullCalendarView: "dayGridMonth", shortcut: "M/3" },
  { id: "year", label: "年", fullCalendarView: "multiMonthYear", shortcut: "Y/4" },
  { id: "agenda", label: "日程", fullCalendarView: "listMonth", shortcut: "A/5" },
  { id: "multiDay", label: "多日", fullCalendarView: "timeGridMultiDay", shortcut: "" },
  { id: "multiWeek", label: "多周", fullCalendarView: "dayGridMultiWeek", shortcut: "" },
];

const VIEW_STORAGE_KEY = "anttodo:calendar-view";
const MULTI_DAY_STORAGE_KEY = "anttodo:calendar-multi-day-count";
const MULTI_WEEK_STORAGE_KEY = "anttodo:calendar-multi-week-count";
const SCHEDULE_PANEL_OPEN_KEY = "anttodo:calendar-schedule-panel-open";

function readStoredNumber(key: string, fallback: number, min: number, max: number) {
  const parsed = Number(window.localStorage.getItem(key));
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function readStoredView(): CalendarViewId {
  const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
  return CALENDAR_VIEWS.some((view) => view.id === stored)
    ? stored as CalendarViewId
    : "month";
}

function readSchedulePanelOpen() {
  return window.localStorage.getItem(SCHEDULE_PANEL_OPEN_KEY) !== "0";
}

function taskEvent(task: Task, labels: Label[], editable = false): EventInput | null {
  if (task.deleted_at || !task.due_at) return null;
  const label = labels.find((candidate) => task.label_ids.includes(candidate.id));
  const color = label?.color || "#9EB3FC";
  const start = task.due_start_at || task.due_at;
  return {
    id: task.id,
    title: task.title,
    start,
    end: task.due_start_at ? task.due_at : undefined,
    allDay: task.due_is_all_day,
    editable,
    color,
    contrastColor: task.kind !== "note" && task.status === "completed"
      ? "rgba(25,25,25,.5)"
      : "#191919",
    className: task.kind !== "note" && task.status === "completed"
      ? "calendar-event-completed"
      : "",
  };
}

function taskIsVisible(task: Task, visibleCalendarIds: Set<string>) {
  return task.label_ids.length === 0
    ? visibleCalendarIds.has("inbox")
    : task.label_ids.some((labelId) => visibleCalendarIds.has(labelId));
}

function HolidayBadge({
  date,
  enabled,
}: {
  date: Date;
  enabled: boolean;
}) {
  if (!enabled) return null;
  const detail = chineseCalendarDetail(date);
  if (!detail.holidayLabel) return null;
  return (
    <span
      className={clsx(
        "calendar-holiday-badge",
        detail.holidayLabel === "班" ? "workday" : "holiday",
      )}
      title={detail.holidayName || (detail.holidayLabel === "班" ? "调休上班" : "法定假期")}
      aria-label={detail.holidayLabel === "班" ? "调休上班" : "法定假期"}
    >
      {detail.holidayLabel}
    </span>
  );
}

function MiniCalendar({
  bundle,
  visibleCalendarIds,
  visibleDate,
  dateTimePreferences,
  onSelectDate,
}: {
  bundle: WorkspaceBundle;
  visibleCalendarIds: Set<string>;
  visibleDate: Date;
  dateTimePreferences: DateTimePreferences;
  onSelectDate: (date: Date) => void;
}) {
  const [displayMonth, setDisplayMonth] = useState(() => startOfMonth(visibleDate));

  useEffect(() => {
    setDisplayMonth(startOfMonth(visibleDate));
  }, [visibleDate]);

  const days = useMemo(() => {
    const first = startOfWeek(startOfMonth(displayMonth), {
      weekStartsOn: dateTimePreferences.weekStartsOn,
    });
    return Array.from({ length: 42 }, (_, index) => addDays(first, index));
  }, [dateTimePreferences.weekStartsOn, displayMonth]);

  const taskDates = useMemo(() => new Set(
    bundle.tasks
      .filter((task) => task.due_at && !task.deleted_at && taskIsVisible(task, visibleCalendarIds))
      .map((task) => format(new Date(task.due_at!), "yyyy-MM-dd")),
  ), [bundle.tasks, visibleCalendarIds]);

  return (
    <section className="mini-calendar" aria-label="日期导航">
      <header className="mini-calendar-header">
        <strong>{format(displayMonth, "yyyy年M月", { locale: zhCN })}</strong>
        <div>
          <button
            aria-label="上一个月"
            onClick={() => setDisplayMonth((current) => addMonths(current, -1))}
          >
            <ChevronLeft />
          </button>
          <button
            className="mini-calendar-today"
            aria-label="回到本月"
            onClick={() => {
              const today = new Date();
              setDisplayMonth(startOfMonth(today));
              onSelectDate(today);
            }}
          >
            <span />
          </button>
          <button
            aria-label="下一个月"
            onClick={() => setDisplayMonth((current) => addMonths(current, 1))}
          >
            <ChevronRight />
          </button>
        </div>
      </header>
      <div className="mini-calendar-weekdays" aria-hidden="true">
        {weekdayLabels(dateTimePreferences.weekStartsOn).map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>
      <div className="mini-calendar-grid">
        {days.map((day) => {
          const inMonth = isSameMonth(day, displayMonth);
          const hasTask = taskDates.has(format(day, "yyyy-MM-dd"));
          return (
            <button
              key={day.toISOString()}
              className={clsx(
                !inMonth && "outside",
                isSameDay(day, new Date()) && "today",
              )}
              aria-label={format(day, "yyyy年M月d日", { locale: zhCN })}
              onClick={() => {
                setDisplayMonth(startOfMonth(day));
                onSelectDate(day);
              }}
            >
              <span>{day.getDate()}</span>
              <HolidayBadge
                date={day}
                enabled={dateTimePreferences.showHolidayAdjustments}
              />
              {hasTask && <i aria-label="有任务" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function CalendarLabelTree({
  labels,
  userLabelOrder,
  visibleCalendarIds,
  collapsed,
  onToggleCollapsed,
  onToggleCalendar,
  parentId = null,
  depth = 0,
}: {
  labels: Label[];
  userLabelOrder: WorkspaceBundle["userLabelOrder"];
  visibleCalendarIds: Set<string>;
  collapsed: Record<string, boolean>;
  onToggleCollapsed: (labelId: string) => void;
  onToggleCalendar: (labelId: string) => void;
  parentId?: string | null;
  depth?: number;
}) {
  const labelIds = new Set(labels.map((label) => label.id));
  const orderMap = userLabelOrderMap(userLabelOrder);
  const children = labels
    .filter((label) => label.parent_id === parentId
      || (parentId === null && label.parent_id !== null && !labelIds.has(label.parent_id)))
    .sort((a, b) => compareSiblingLabels(a, b, parentId, orderMap));

  return children.map((label) => {
    const hasChildren = labels.some((candidate) => candidate.parent_id === label.id);
    const isCollapsed = collapsed[label.id] ?? false;
    const visible = visibleCalendarIds.has(label.id);

    return (
      <div
        key={label.id}
        className="calendar-label-tree-node"
        role="treeitem"
        aria-expanded={hasChildren ? !isCollapsed : undefined}
      >
        <div className="calendar-label-tree-row" style={{ paddingLeft: depth * 16 }}>
          {hasChildren ? (
            <button
              className="calendar-label-expander"
              aria-label={`${isCollapsed ? "展开" : "收起"}${label.name}`}
              onClick={() => onToggleCollapsed(label.id)}
            >
              {isCollapsed ? <ChevronRight /> : <ChevronDown />}
            </button>
          ) : <span className="calendar-label-expander-spacer" aria-hidden="true" />}
          <button
            className={clsx("calendar-list-item", visible && "active")}
            aria-pressed={visible}
            onClick={() => onToggleCalendar(label.id)}
          >
            <span
              className="calendar-visibility-check"
              style={{ backgroundColor: visible ? label.color : "transparent" }}
              aria-hidden="true"
            >
              {visible && <Check />}
            </span>
            <span className="calendar-list-icon" style={{ color: label.color }}>
              <CalendarDays />
            </span>
            <span>{label.name}</span>
          </button>
        </div>
        {hasChildren && !isCollapsed && (
          <div role="group">
            <CalendarLabelTree
              labels={labels}
              userLabelOrder={userLabelOrder}
              visibleCalendarIds={visibleCalendarIds}
              collapsed={collapsed}
              onToggleCollapsed={onToggleCollapsed}
              onToggleCalendar={onToggleCalendar}
              parentId={label.id}
              depth={depth + 1}
            />
          </div>
        )}
      </div>
    );
  });
}

export function CalendarSidebar({
  openMobile,
  bundle,
  visibleCalendarIds,
  onCloseMobile,
  onToggleCalendar,
  onShowAll,
  visibleDate,
  dateTimePreferences,
  onSelectDate,
}: {
  openMobile: boolean;
  bundle: WorkspaceBundle;
  visibleCalendarIds: Set<string>;
  onCloseMobile: () => void;
  onToggleCalendar: (id: string) => void;
  onShowAll: () => void;
  visibleDate: Date;
  dateTimePreferences: DateTimePreferences;
  onSelectDate: (date: Date) => void;
}) {
  const [collapsedLabels, setCollapsedLabels] = useState<Record<string, boolean>>({});
  const calendarIds = ["inbox", ...bundle.labels.map((label) => label.id)];
  const allVisible = calendarIds.every((calendarId) => visibleCalendarIds.has(calendarId));

  return (
    <>
      {openMobile && (
        <button className="sidebar-scrim" onClick={onCloseMobile} aria-label="关闭侧栏" />
      )}
      <aside className={clsx("sidebar", "calendar-sidebar", openMobile && "mobile-open")}>
        <MiniCalendar
          bundle={bundle}
          visibleCalendarIds={visibleCalendarIds}
          visibleDate={visibleDate}
          dateTimePreferences={dateTimePreferences}
          onSelectDate={onSelectDate}
        />
        <div className="calendar-list" aria-label="日历列表">
          <button className="calendar-all-item" onClick={onShowAll} aria-pressed={allVisible}>
            <strong>所有</strong>
            <span className={clsx("calendar-all-check", allVisible && "active")}>{allVisible && <Check />}</span>
          </button>
          <button
            className={clsx("calendar-list-item", visibleCalendarIds.has("inbox") && "active")}
            aria-pressed={visibleCalendarIds.has("inbox")}
            onClick={() => onToggleCalendar("inbox")}
          >
            <span
              className="calendar-visibility-check"
              style={{ backgroundColor: visibleCalendarIds.has("inbox") ? "#8e95a3" : "transparent" }}
              aria-hidden="true"
            >
              {visibleCalendarIds.has("inbox") && <Check />}
            </span>
            <span className="calendar-list-icon" style={{ color: "#8e95a3" }}><Inbox /></span>
            <span>收集箱</span>
          </button>
          <div className="calendar-label-tree" role="tree" aria-label="标签树">
            <CalendarLabelTree
              labels={bundle.labels}
              userLabelOrder={bundle.userLabelOrder}
              visibleCalendarIds={visibleCalendarIds}
              collapsed={collapsedLabels}
              onToggleCollapsed={(labelId) => setCollapsedLabels((current) => ({
                ...current,
                [labelId]: !current[labelId],
              }))}
              onToggleCalendar={onToggleCalendar}
            />
          </div>
        </div>
      </aside>
    </>
  );
}

function ScheduleTaskPanel({
  bundle,
  currentUserId,
  online,
  pendingTaskIds,
  optimisticallyUnscheduledTaskIds,
  calendarTaskDragging,
  panelRef,
  onClose,
  onSelectTask,
}: {
  bundle: WorkspaceBundle;
  currentUserId: string;
  online: boolean;
  pendingTaskIds: ReadonlySet<string>;
  optimisticallyUnscheduledTaskIds: ReadonlySet<string>;
  calendarTaskDragging: boolean;
  panelRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onSelectTask: (taskId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const panelBundle = useMemo(() => optimisticallyUnscheduledTaskIds.size === 0
    ? bundle
    : {
      ...bundle,
      tasks: bundle.tasks.map((task) => optimisticallyUnscheduledTaskIds.has(task.id)
        ? { ...task, ...clearSchedulePatch() }
        : task),
    }, [bundle, optimisticallyUnscheduledTaskIds]);
  const groups = useMemo(
    () => buildScheduleTaskGroups(panelBundle, currentUserId, pendingTaskIds),
    [currentUserId, panelBundle, pendingTaskIds],
  );

  return (
    <aside
      className={clsx("calendar-schedule-panel", calendarTaskDragging && "is-calendar-drop-target")}
      aria-label="安排任务"
      ref={panelRef}
    >
      <header className="calendar-schedule-header">
        <strong>安排任务</strong>
        <button aria-label="关闭安排任务" onClick={onClose}><X /></button>
      </header>
      {calendarTaskDragging && (
        <div className="calendar-schedule-drop-hint" role="status">
          拖到此处取消安排
        </div>
      )}
      {!online && <p className="calendar-schedule-offline">离线模式下只能查看任务</p>}
      <div className="calendar-schedule-groups">
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.id);
          const color = group.label?.color ?? "#8e95a3";
          return (
            <section
              className="calendar-schedule-group"
              key={group.id}
              style={{ "--schedule-label-color": color } as React.CSSProperties}
            >
              <button
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
                  data-task-id={task.id}
                  data-event-title={task.title}
                  data-event-color={group.label?.color ?? "#9EB3FC"}
                  key={`${group.id}:${task.id}`}
                  title={online ? "拖到日历中安排截止时间" : "离线模式下不能安排任务"}
                >
                  <GripVertical className="calendar-schedule-drag-handle" aria-hidden="true" />
                  <button onClick={() => onSelectTask(task.id)}>{task.title}</button>
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
    </aside>
  );
}

export function CalendarWorkspace({
  bundle,
  currentUserId,
  online,
  visibleCalendarIds,
  dateTimePreferences,
  onSelectTask,
  onSaveTaskSchedule,
  onNotice,
  sidebarVisible,
  onToggleSidebar,
  navigationDate,
  onVisibleDateChange,
}: {
  bundle: WorkspaceBundle;
  currentUserId: string;
  online: boolean;
  visibleCalendarIds: Set<string>;
  dateTimePreferences: DateTimePreferences;
  onSelectTask: (taskId: string) => void;
  onSaveTaskSchedule: (
    taskId: string,
    patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
    schedule: ReminderSchedule,
  ) => Promise<void>;
  onNotice: (message: string) => void;
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  navigationDate: Date | null;
  onVisibleDateChange: (date: Date) => void;
}) {
  const calendarRef = useRef<CalendarRef>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const schedulePanelRef = useRef<HTMLDivElement>(null);
  const unscheduleDropTaskIdsRef = useRef<Set<string>>(new Set());
  const [view, setView] = useState<CalendarViewId>(readStoredView);
  const [multiDayCount, setMultiDayCount] = useState(() =>
    readStoredNumber(MULTI_DAY_STORAGE_KEY, 3, 2, 14));
  const [multiWeekCount, setMultiWeekCount] = useState(() =>
    readStoredNumber(MULTI_WEEK_STORAGE_KEY, 4, 2, 12));
  const [title, setTitle] = useState("");
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [schedulePanelOpen, setSchedulePanelOpen] = useState(readSchedulePanelOpen);
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(() => new Set());
  const [calendarMutationTaskIds, setCalendarMutationTaskIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [optimisticallyUnscheduledTaskIds, setOptimisticallyUnscheduledTaskIds] = useState<
    Set<string>
  >(() => new Set());
  const [draggingCalendarTaskId, setDraggingCalendarTaskId] = useState<string | null>(null);
  const [optimisticEvents, setOptimisticEvents] = useState<Record<string, EventInput>>({});

  const events = useMemo(() => [
    ...bundle.tasks.flatMap((task) => {
      if (optimisticallyUnscheduledTaskIds.has(task.id)) return [];
      if (!taskIsVisible(task, visibleCalendarIds)) return [];
      const event = taskEvent(
        task,
        bundle.labels,
        online
          && view !== "agenda"
          && !calendarMutationTaskIds.has(task.id)
          && canRescheduleTask(bundle, task, currentUserId),
      );
      return event ? [event] : [];
    }),
    ...Object.values(optimisticEvents),
  ], [
    bundle,
    calendarMutationTaskIds,
    currentUserId,
    online,
    optimisticEvents,
    optimisticallyUnscheduledTaskIds,
    view,
    visibleCalendarIds,
  ]);

  const activeView = CALENDAR_VIEWS.find((candidate) => candidate.id === view)!;

  useEffect(() => {
    if (navigationDate) calendarRef.current?.getApi().gotoDate(navigationDate);
  }, [navigationDate]);

  useEffect(() => {
    const container = schedulePanelRef.current;
    if (!container || !schedulePanelOpen || !online) return;
    const draggable = new Draggable(container, {
      itemSelector: ".calendar-schedule-task.is-draggable",
      minDistance: 6,
      longPressDelay: 350,
      eventData: (element) => ({
        id: element.dataset.taskId,
        title: element.dataset.eventTitle,
        color: element.dataset.eventColor,
        contrastColor: "#191919",
        extendedProps: { taskId: element.dataset.taskId },
      }),
    });
    return () => draggable.destroy();
  }, [online, schedulePanelOpen]);

  useEffect(() => {
    if (!viewMenuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setViewMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [viewMenuOpen]);

  useEffect(() => {
    const shortcutViews: Record<string, CalendarViewId> = {
      "1": "day",
      d: "day",
      "2": "week",
      w: "week",
      "3": "month",
      m: "month",
      "4": "year",
      y: "year",
      "5": "agenda",
      a: "agenda",
    };
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const nextView = shortcutViews[event.key.toLowerCase()];
      if (!nextView) return;
      event.preventDefault();
      changeView(nextView);
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  });

  function changeView(nextView: CalendarViewId) {
    const definition = CALENDAR_VIEWS.find((candidate) => candidate.id === nextView)!;
    setView(nextView);
    window.localStorage.setItem(VIEW_STORAGE_KEY, nextView);
    calendarRef.current?.getApi().changeView(definition.fullCalendarView);
    setViewMenuOpen(false);
  }

  function updateMultiDayCount(value: number) {
    setMultiDayCount(value);
    window.localStorage.setItem(MULTI_DAY_STORAGE_KEY, String(value));
    if (view === "multiDay") {
      calendarRef.current?.getApi().changeView("timeGridMultiDay");
    }
  }

  function updateMultiWeekCount(value: number) {
    setMultiWeekCount(value);
    window.localStorage.setItem(MULTI_WEEK_STORAGE_KEY, String(value));
    if (view === "multiWeek") {
      calendarRef.current?.getApi().changeView("dayGridMultiWeek");
    }
  }

  function setSchedulePanelVisibility(open: boolean) {
    setSchedulePanelOpen(open);
    window.localStorage.setItem(SCHEDULE_PANEL_OPEN_KEY, open ? "1" : "0");
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

  function setCalendarTaskMutation(taskId: string, pending: boolean) {
    setCalendarMutationTaskIds((current) => {
      const next = new Set(current);
      if (pending) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }

  async function moveCalendarTask(info: EventDropInfo) {
    const taskId = info.event.id;
    if (unscheduleDropTaskIdsRef.current.has(taskId)) {
      info.revert();
      return;
    }
    const task = bundle.tasks.find((candidate) => candidate.id === taskId);
    const dropDate = info.event.start;
    if (
      !online
      || view === "agenda"
      || !task
      || !dropDate
      || calendarMutationTaskIds.has(taskId)
      || !canRescheduleTask(bundle, task, currentUserId)
    ) {
      info.revert();
      return;
    }

    const timeZone = dateTimePreferences.timeZoneEnabled
      ? systemTimeZone()
      : task.due_timezone;
    const patch = schedulePatchForCalendarMove(task, dropDate, info.event.allDay, timeZone);
    setCalendarTaskMutation(taskId, true);
    try {
      await onSaveTaskSchedule(taskId, patch, scheduleForTask(task));
    } catch (cause) {
      info.revert();
      onNotice(cause instanceof Error ? cause.message : "任务改期失败，请重试");
    } finally {
      setCalendarTaskMutation(taskId, false);
    }
  }

  async function returnCalendarTaskToCandidates(task: Task) {
    const taskId = task.id;
    setCalendarTaskMutation(taskId, true);
    setOptimisticallyUnscheduledTaskIds((current) => new Set(current).add(taskId));
    try {
      await onSaveTaskSchedule(taskId, clearSchedulePatch(), {
        reminders: [],
        persistent: false,
        recurrence: null,
      });
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : "取消任务安排失败，请重试");
    } finally {
      unscheduleDropTaskIdsRef.current.delete(taskId);
      setOptimisticallyUnscheduledTaskIds((current) => {
        const next = new Set(current);
        next.delete(taskId);
        return next;
      });
      setCalendarTaskMutation(taskId, false);
    }
  }

  function stopCalendarTaskDrag(info: EventDragStopInfo) {
    setDraggingCalendarTaskId(null);
    const panel = schedulePanelRef.current;
    const task = bundle.tasks.find((candidate) => candidate.id === info.event.id);
    if (!panel || !schedulePanelOpen || !online || view === "agenda" || !task) return;
    const bounds = panel.getBoundingClientRect();
    const { clientX, clientY } = info.jsEvent;
    const droppedOnPanel = clientX >= bounds.left
      && clientX <= bounds.right
      && clientY >= bounds.top
      && clientY <= bounds.bottom;
    if (!droppedOnPanel || !canRescheduleTask(bundle, task, currentUserId)) return;

    unscheduleDropTaskIdsRef.current.add(task.id);
    void returnCalendarTaskToCandidates(task);
  }

  async function receiveScheduledTask(info: EventReceiveInfo) {
    const taskId = String(info.event.extendedProps.taskId ?? info.event.id);
    const task = bundle.tasks.find((candidate) => candidate.id === taskId);
    const dropDate = info.event.start;
    const allDay = info.event.allDay;
    info.event.remove();
    if (
      !online
      || view === "agenda"
      || !task
      || !dropDate
      || pendingTaskIds.has(taskId)
      || !canRescheduleTask(bundle, task, currentUserId)
    ) return;

    const timeZone = dateTimePreferences.timeZoneEnabled
      ? systemTimeZone()
      : task.due_timezone;
    const patch = schedulePatchFromDrop(dropDate, allDay, timeZone);
    const optimistic = taskEvent({ ...task, ...patch }, bundle.labels);
    setPendingTaskIds((current) => new Set(current).add(taskId));
    if (optimistic) {
      setOptimisticEvents((current) => ({ ...current, [taskId]: optimistic }));
    }
    try {
      await onSaveTaskSchedule(taskId, patch, scheduleForTask(task));
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : "任务安排失败，请重试");
    } finally {
      setPendingTaskIds((current) => {
        const next = new Set(current);
        next.delete(taskId);
        return next;
      });
      setOptimisticEvents((current) => {
        const next = { ...current };
        delete next[taskId];
        return next;
      });
    }
  }

  return (
    <div className={clsx("calendar-workspace", schedulePanelOpen && "schedule-panel-open")}>
      <div className="calendar-stage">
        <header className="calendar-toolbar">
        <div className="calendar-toolbar-title">
          <button
            className="calendar-sidebar-toggle"
            onClick={onToggleSidebar}
            aria-label={sidebarVisible ? "打开导航或隐藏日历列表" : "打开导航或显示日历列表"}
            aria-pressed={sidebarVisible}
          >
            <PanelLeft />
          </button>
          <h1>{title}</h1>
        </div>
        <div className="calendar-toolbar-actions">
          <div className="calendar-view-anchor" ref={menuRef}>
            <button
              className="calendar-view-trigger"
              aria-haspopup="menu"
              aria-expanded={viewMenuOpen}
              onClick={() => setViewMenuOpen((open) => !open)}
            >
              {activeView.label === "多日" ? `${multiDayCount}日` : activeView.label === "多周" ? `${multiWeekCount}周` : activeView.label}
              <ChevronDown />
            </button>
            {viewMenuOpen && (
              <div className="calendar-view-menu" role="menu" aria-label="选择日历视图">
                {CALENDAR_VIEWS.map((definition, index) => (
                  <div
                    key={definition.id}
                    className={clsx(
                      "calendar-view-row",
                      definition.id === view && "active",
                      index === 5 && "with-divider",
                    )}
                  >
                    <button role="menuitemradio" aria-checked={definition.id === view} onClick={() => changeView(definition.id)}>
                      <span className="calendar-view-check">{definition.id === view && <Check />}</span>
                      <span>{definition.label}</span>
                    </button>
                    {definition.id === "multiDay" ? (
                      <select
                        aria-label="多日视图天数"
                        value={multiDayCount}
                        onChange={(event) => updateMultiDayCount(Number(event.target.value))}
                      >
                        {[2, 3, 4, 5, 7, 10, 14].map((count) => <option key={count} value={count}>{count}日</option>)}
                      </select>
                    ) : definition.id === "multiWeek" ? (
                      <select
                        aria-label="多周视图周数"
                        value={multiWeekCount}
                        onChange={(event) => updateMultiWeekCount(Number(event.target.value))}
                      >
                        {[2, 3, 4, 5, 6, 8, 10, 12].map((count) => <option key={count} value={count}>{count}周</option>)}
                      </select>
                    ) : (
                      <span className="calendar-view-shortcut">{definition.shortcut}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="calendar-date-navigation">
            <button aria-label="上一个日期范围" onClick={() => calendarRef.current?.getApi().prev()}><ChevronLeft /></button>
            <button onClick={() => calendarRef.current?.getApi().today()}>今天</button>
            <button aria-label="下一个日期范围" onClick={() => calendarRef.current?.getApi().next()}><ChevronRight /></button>
          </div>
          {!schedulePanelOpen && (
            <button
              className="calendar-schedule-toggle"
              aria-label="显示安排任务"
              onClick={() => setSchedulePanelVisibility(true)}
            >
              <CalendarPlus />
            </button>
          )}
        </div>
      </header>
      <div className="calendar-canvas">
        <FullCalendar
          ref={calendarRef}
          plugins={[classicTheme, interactionPlugin, dayGridPlugin, timeGridPlugin, listPlugin, multiMonthPlugin]}
          locale={zhCnLocale}
          initialView={activeView.fullCalendarView}
          firstDay={dateTimePreferences.weekStartsOn}
          weekNumbers={dateTimePreferences.showWeekNumbers}
          weekNumberCalculation="ISO"
          headerToolbar={false}
          height="100%"
          expandRows
          nowIndicator
          navLinks
          dayMaxEvents={3}
          eventDisplay="block"
          displayEventTime={false}
          allDayText="全天"
          noEventsText="这段时间没有任务"
          slotMinTime="06:00:00"
          slotMaxTime="24:00:00"
          slotDuration="00:30:00"
          events={events}
          editable={online && view !== "agenda"}
          eventDurationEditable={false}
          droppable={online && view !== "agenda"}
          dayCellTopContent={(info) => (
            <div className="calendar-main-day-top">
              <span>{info.date.getDate()}</span>
              <HolidayBadge
                date={info.date}
                enabled={dateTimePreferences.showHolidayAdjustments}
              />
            </div>
          )}
          views={{
            timeGridMultiDay: {
              type: "timeGrid",
              duration: { days: multiDayCount },
              dateIncrement: { days: multiDayCount },
            },
            dayGridMultiWeek: {
              type: "dayGrid",
              duration: { weeks: multiWeekCount },
              dateIncrement: { weeks: multiWeekCount },
            },
          }}
          datesSet={(info: DatesSetInfo) => {
            setTitle(info.view.title);
            onVisibleDateChange(info.view.currentStart);
          }}
          eventClick={(info) => onSelectTask(info.event.id)}
          eventDragStart={(info: EventDragStartInfo) => setDraggingCalendarTaskId(info.event.id)}
          eventDragStop={stopCalendarTaskDrag}
          eventDrop={(info) => void moveCalendarTask(info)}
          eventReceive={(info) => void receiveScheduledTask(info)}
        />
      </div>
      </div>
      {schedulePanelOpen && (
        <>
          <button
            className="calendar-schedule-scrim"
            aria-label="关闭安排任务"
            onClick={() => setSchedulePanelVisibility(false)}
          />
          <ScheduleTaskPanel
            bundle={bundle}
            currentUserId={currentUserId}
            online={online}
            pendingTaskIds={pendingTaskIds}
            optimisticallyUnscheduledTaskIds={optimisticallyUnscheduledTaskIds}
            calendarTaskDragging={draggingCalendarTaskId !== null}
            panelRef={schedulePanelRef}
            onClose={() => setSchedulePanelVisibility(false)}
            onSelectTask={onSelectTask}
          />
        </>
      )}
    </div>
  );
}
