import {
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
  weekdayLabels,
} from "./lib/dateTimePreferences";
import { taskIsVisibleOnCalendar } from "./lib/calendarVisibility";
import type { DateTimePreferences, WorkspaceBundle } from "./types";

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

export function MiniCalendar({
  bundle,
  visibleCalendarIds,
  visibleAssigneeIds,
  visibleDate,
  dateTimePreferences,
  onSelectDate,
  showHeader = true,
  showMonthControls = true,
}: {
  bundle: WorkspaceBundle;
  visibleCalendarIds: Set<string>;
  visibleAssigneeIds: Set<string>;
  visibleDate: Date;
  dateTimePreferences: DateTimePreferences;
  onSelectDate: (date: Date) => void;
  /** When false, omit the month title / navigation row entirely. */
  showHeader?: boolean;
  showMonthControls?: boolean;
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
      .filter((task) => task.due_at && !task.deleted_at
        && taskIsVisibleOnCalendar(task, visibleCalendarIds, visibleAssigneeIds))
      .map((task) => format(new Date(task.due_at!), "yyyy-MM-dd")),
  ), [bundle.tasks, visibleAssigneeIds, visibleCalendarIds]);

  return (
    <section className="mini-calendar" aria-label="日期导航">
      {showHeader && (
        <header className="mini-calendar-header">
          <strong>{format(displayMonth, "yyyy年M月", { locale: zhCN })}</strong>
          {showMonthControls && (
            <div>
              <button
                type="button"
                aria-label="上一个月"
                onClick={() => setDisplayMonth((current) => addMonths(current, -1))}
              >
                <ChevronLeft />
              </button>
              <button
                type="button"
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
                type="button"
                aria-label="下一个月"
                onClick={() => setDisplayMonth((current) => addMonths(current, 1))}
              >
                <ChevronRight />
              </button>
            </div>
          )}
        </header>
      )}
      <div className="mini-calendar-weekdays" aria-hidden="true">
        {weekdayLabels(dateTimePreferences.weekStartsOn).map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>
      <div className="mini-calendar-grid">
        {days.map((day) => {
          const inMonth = isSameMonth(day, displayMonth);
          const selected = isSameDay(day, visibleDate);
          const isToday = isSameDay(day, new Date());
          const hasTask = taskDates.has(format(day, "yyyy-MM-dd"));
          return (
            <button
              key={day.toISOString()}
              type="button"
              className={clsx(
                !inMonth && "outside",
                selected && "selected",
                isToday && "today",
              )}
              aria-label={format(day, "yyyy年M月d日", { locale: zhCN })}
              aria-pressed={selected}
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
