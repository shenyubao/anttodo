import FullCalendar, {
  type CalendarRef,
  type DatesSetInfo,
  type EventInput,
} from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
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
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Inbox,
  PanelLeft,
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
import { chineseCalendarDetail, weekdayLabels } from "./lib/dateTimePreferences";
import type { DateTimePreferences, Label, Task, WorkspaceBundle } from "./types";

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

function taskEvent(task: Task, labels: Label[]): EventInput | null {
  if (task.deleted_at || !task.due_at) return null;
  const label = labels.find((candidate) => task.label_ids.includes(candidate.id));
  const color = label?.color || "#4772fa";
  const start = task.due_start_at || task.due_at;
  return {
    id: task.id,
    title: task.title,
    start,
    end: task.due_start_at ? task.due_at : undefined,
    allDay: task.due_is_all_day,
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
  visibleCalendarIds,
  collapsed,
  onToggleCollapsed,
  onToggleCalendar,
  parentId = null,
  depth = 0,
}: {
  labels: Label[];
  visibleCalendarIds: Set<string>;
  collapsed: Record<string, boolean>;
  onToggleCollapsed: (labelId: string) => void;
  onToggleCalendar: (labelId: string) => void;
  parentId?: string | null;
  depth?: number;
}) {
  const labelIds = new Set(labels.map((label) => label.id));
  const children = labels
    .filter((label) => label.parent_id === parentId
      || (parentId === null && label.parent_id !== null && !labelIds.has(label.parent_id)))
    .sort((a, b) => a.position - b.position);

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

export function CalendarWorkspace({
  bundle,
  visibleCalendarIds,
  dateTimePreferences,
  onSelectTask,
  sidebarVisible,
  onToggleSidebar,
  navigationDate,
  onVisibleDateChange,
}: {
  bundle: WorkspaceBundle;
  visibleCalendarIds: Set<string>;
  dateTimePreferences: DateTimePreferences;
  onSelectTask: (taskId: string) => void;
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  navigationDate: Date | null;
  onVisibleDateChange: (date: Date) => void;
}) {
  const calendarRef = useRef<CalendarRef>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<CalendarViewId>(readStoredView);
  const [multiDayCount, setMultiDayCount] = useState(() =>
    readStoredNumber(MULTI_DAY_STORAGE_KEY, 3, 2, 14));
  const [multiWeekCount, setMultiWeekCount] = useState(() =>
    readStoredNumber(MULTI_WEEK_STORAGE_KEY, 4, 2, 12));
  const [title, setTitle] = useState("");
  const [viewMenuOpen, setViewMenuOpen] = useState(false);

  const events = useMemo(
    () => bundle.tasks.flatMap((task) => {
      if (!taskIsVisible(task, visibleCalendarIds)) return [];
      const event = taskEvent(task, bundle.labels);
      return event ? [event] : [];
    }),
    [bundle.labels, bundle.tasks, visibleCalendarIds],
  );

  const activeView = CALENDAR_VIEWS.find((candidate) => candidate.id === view)!;

  useEffect(() => {
    if (navigationDate) calendarRef.current?.getApi().gotoDate(navigationDate);
  }, [navigationDate]);

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

  return (
    <div className="calendar-workspace">
      <header className="calendar-toolbar">
        <div className="calendar-toolbar-title">
          <button
            className="calendar-sidebar-toggle"
            onClick={onToggleSidebar}
            aria-label={sidebarVisible ? "隐藏日历列表" : "显示日历列表"}
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
          allDayText="全天"
          noEventsText="这段时间没有任务"
          slotMinTime="06:00:00"
          slotMaxTime="24:00:00"
          slotDuration="00:30:00"
          eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: dateTimePreferences.timeFormat === "12h" }}
          events={events}
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
        />
      </div>
    </div>
  );
}
