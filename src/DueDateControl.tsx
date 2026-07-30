import {
  addDays,
  addHours,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
  type Day,
} from "date-fns";
import clsx from "clsx";
import {
  AlarmClock,
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Globe2,
  Moon,
  RotateCcw,
  Sun,
  Sunrise,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  HALF_HOUR_OPTIONS,
  getDueStatus,
  getPresetDate,
  isValidDueRange,
  roundUpToHalfHour,
  type DueFields,
  type DuePreset,
} from "./lib/dueTime";
import {
  chineseCalendarDetail,
  formatDueWithPreferences,
  formatPreferenceDate,
  fromZonedDateTime,
  isValidTimeZone,
  preferenceWeekNumber,
  systemTimeZone,
  toDateInput,
  toTimeInput,
  weekdayLabels,
} from "./lib/dateTimePreferences";
import type { DateTimePreferences, Task } from "./types";

function calendarDays(
  month: Date,
  weekStartsOn: DateTimePreferences["weekStartsOn"],
) {
  const start = startOfWeek(startOfMonth(month), {
    weekStartsOn: weekStartsOn as Day,
  });
  const end = endOfWeek(endOfMonth(month), {
    weekStartsOn: weekStartsOn as Day,
  });
  const days: Date[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  while (days.length < 42) days.push(addDays(days.at(-1)!, 1));
  return days;
}

function initialPoint(task: Task) {
  return roundUpToHalfHour(task.due_at ? new Date(task.due_at) : new Date());
}

function formatDateField(value: string, preferences: DateTimePreferences) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "" : formatPreferenceDate(date, preferences);
}

function timeOptionLabel(value: string, preferences: DateTimePreferences) {
  if (preferences.timeFormat === "24h") return value;
  const [hours, minutes] = value.split(":").map(Number);
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

export function DueDateControl({
  task,
  online,
  now,
  preferences,
  onSave,
}: {
  task: Task;
  online: boolean;
  now: Date;
  preferences: DateTimePreferences;
  onSave: (
    patch: Pick<
      Task,
      "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone"
    >,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"point" | "range">("point");
  const [pointDate, setPointDate] = useState("");
  const [pointTime, setPointTime] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [timeZone, setTimeZone] = useState(systemTimeZone);
  const [displayedMonth, setDisplayedMonth] = useState(new Date());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  function resetDraft() {
    const zone = task.due_timezone ?? systemTimeZone();
    const point = initialPoint(task);
    const start = task.due_start_at
      ? roundUpToHalfHour(new Date(task.due_start_at))
      : point;
    const end = task.due_start_at && task.due_at
      ? roundUpToHalfHour(new Date(task.due_at))
      : addHours(start, 1);
    setTab(task.due_start_at ? "range" : "point");
    setPointDate(toDateInput(point, zone));
    setPointTime(toTimeInput(point, zone));
    setStartDate(toDateInput(start, zone));
    setStartTime(toTimeInput(start, zone));
    setEndDate(toDateInput(end, zone));
    setEndTime(toTimeInput(end, zone));
    setAllDay(task.due_is_all_day);
    setTimeZone(zone);
    setDisplayedMonth(new Date(`${toDateInput(point, zone)}T12:00:00`));
    setError("");
  }

  useEffect(() => {
    if (open) resetDraft();
  }, [
    open,
    task.id,
    task.due_at,
    task.due_start_at,
    task.due_is_all_day,
    task.due_timezone,
  ]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !popoverRef.current) return;
    const positionPopover = () => {
      const trigger = triggerRef.current!.getBoundingClientRect();
      const popover = popoverRef.current!;
      const gap = 8;
      const inset = 12;
      const width = Math.min(260, window.innerWidth - inset * 2);
      const height = popover.offsetHeight;
      const left = Math.min(
        Math.max(trigger.left, inset),
        Math.max(inset, window.innerWidth - width - inset),
      );
      const preferredTop = trigger.bottom + gap;
      const top = preferredTop + height <= window.innerHeight - inset
        ? preferredTop
        : Math.max(inset, trigger.top - height - gap);
      setPosition({ width, left, top });
    };
    positionPopover();
    window.addEventListener("resize", positionPopover);
    return () => window.removeEventListener("resize", positionPopover);
  }, [open, tab, allDay, error]);

  const dueFields: DueFields = {
    due_at: task.due_at,
    due_start_at: task.due_start_at,
    due_is_all_day: task.due_is_all_day,
  };
  const calendar = calendarDays(displayedMonth, preferences.weekStartsOn);
  const timeZones =
    (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf?.("timeZone") ?? [
        "Asia/Shanghai",
        "Asia/Hong_Kong",
        "Asia/Tokyo",
        "Europe/London",
        "America/New_York",
        "America/Los_Angeles",
        "UTC",
      ];
  const status = getDueStatus(task.due_at, now);

  function applyPreset(preset: DuePreset) {
    const date = getPresetDate(preset);
    setPointDate(toDateInput(date, timeZone));
    setPointTime(toTimeInput(date, timeZone));
    setDisplayedMonth(date);
  }

  function switchTab(next: "point" | "range") {
    if (next === "range" && tab === "point") {
      const start = fromZonedDateTime(pointDate, pointTime, timeZone);
      const end = addHours(start, 1);
      setStartDate(toDateInput(start, timeZone));
      setStartTime(toTimeInput(start, timeZone));
      setEndDate(toDateInput(end, timeZone));
      setEndTime(toTimeInput(end, timeZone));
    }
    setTab(next);
    setError("");
  }

  async function save() {
    if (!isValidTimeZone(timeZone)) {
      setError("请选择有效的 IANA 时区");
      return;
    }
    const savedZone = preferences.timeZoneEnabled ? timeZone : task.due_timezone;
    let patch: Pick<
      Task,
      "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone"
    >;
    if (tab === "point") {
      const dueAt = fromZonedDateTime(pointDate, pointTime, savedZone);
      if (Number.isNaN(dueAt.getTime())) {
        setError("请选择有效的日期和时间");
        return;
      }
      patch = {
        due_at: new Date(dueAt.getTime()).toISOString(),
        due_start_at: null,
        due_is_all_day: false,
        due_timezone: savedZone,
      };
    } else if (allDay) {
      const start = fromZonedDateTime(startDate, "00:00", savedZone);
      const end = fromZonedDateTime(endDate, "23:59", savedZone);
      end.setSeconds(59, 999);
      patch = {
        due_start_at: new Date(start.getTime()).toISOString(),
        due_at: new Date(end.getTime()).toISOString(),
        due_is_all_day: true,
        due_timezone: savedZone,
      };
      if (new Date(patch.due_start_at!).getTime() > new Date(patch.due_at!).getTime()) {
        setError("结束日期不能早于开始日期");
        return;
      }
    } else {
      const start = fromZonedDateTime(startDate, startTime, savedZone);
      const end = fromZonedDateTime(endDate, endTime, savedZone);
      if (!isValidDueRange(start, end)) {
        setError("结束时间不能早于开始时间");
        return;
      }
      patch = {
        due_start_at: new Date(start.getTime()).toISOString(),
        due_at: new Date(end.getTime()).toISOString(),
        due_is_all_day: false,
        due_timezone: savedZone,
      };
    }
    setBusy(true);
    try {
      await onSave(patch);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await onSave({
        due_at: null,
        due_start_at: null,
        due_is_all_day: false,
        due_timezone: null,
      });
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="detail-due-control" ref={rootRef}>
      <button
        ref={triggerRef}
        className={status?.overdue ? "detail-due-trigger overdue" : "detail-due-trigger"}
        aria-label="设置到期时间"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!online}
        onClick={() => setOpen((value) => !value)}
      >
        <CalendarDays />
        <span>{formatDueWithPreferences({ ...dueFields, due_timezone: task.due_timezone }, preferences)}</span>
        {status && <em>{status.label}</em>}
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="due-popover"
          role="dialog"
          aria-label="设置到期时间"
          style={position}
        >
          <div className="due-tabs" role="tablist" aria-label="到期时间类型">
            <button
              role="tab"
              aria-selected={tab === "point"}
              onClick={() => switchTab("point")}
            >
              日期
            </button>
            <button
              role="tab"
              aria-selected={tab === "range"}
              onClick={() => switchTab("range")}
            >
              时间段
            </button>
          </div>

          {tab === "point" ? (
            <div className="due-point-panel">
              <div className="due-presets">
                <button title="今天" aria-label="今天" onClick={() => applyPreset("today")}><Sun /></button>
                <button title="明天" aria-label="明天" onClick={() => applyPreset("tomorrow")}><Sunrise /></button>
                <button title="下周" aria-label="下周" onClick={() => applyPreset("next-week")}><CalendarPlus /><span>+7</span></button>
                <button title="下月" aria-label="下月" onClick={() => applyPreset("next-month")}><Moon /></button>
              </div>
              <div className="due-calendar-header">
                <strong>{format(displayedMonth, "yyyy年 M月")}</strong>
                <div>
                  <button aria-label="上个月" onClick={() => setDisplayedMonth((value) => subMonths(value, 1))}><ChevronLeft /></button>
                  <button aria-label="回到今天" onClick={() => setDisplayedMonth(new Date())}><span className="due-today-dot" /></button>
                  <button aria-label="下个月" onClick={() => setDisplayedMonth((value) => addMonths(value, 1))}><ChevronRight /></button>
                </div>
              </div>
              <div
                className={clsx(
                  "due-calendar-grid",
                  preferences.showWeekNumbers && "with-week-numbers",
                  preferences.showLunar && "with-lunar",
                )}
              >
                {preferences.showWeekNumbers && (
                  <span className="due-weekday due-week-number-heading">周</span>
                )}
                {weekdayLabels(preferences.weekStartsOn).map((weekday) => (
                  <span className="due-weekday" key={weekday}>{weekday}</span>
                ))}
                {calendar.map((day, index) => {
                  const selected = pointDate === toDateInput(day);
                  const today = isSameDay(day, new Date());
                  const chinese = (
                    preferences.showLunar || preferences.showHolidayAdjustments
                  ) ? chineseCalendarDetail(day) : null;
                  return (
                    <Fragment key={day.toISOString()}>
                      {preferences.showWeekNumbers && index % 7 === 0 && (
                        <span className="due-week-number">
                          {preferenceWeekNumber(day, preferences.weekStartsOn)}
                        </span>
                      )}
                      <button
                        className={[
                          !isSameMonth(day, displayedMonth) ? "outside" : "",
                          selected ? "selected" : "",
                          today ? "today" : "",
                        ].filter(Boolean).join(" ")}
                        aria-pressed={selected}
                        aria-label={[
                          format(day, "yyyy年M月d日"),
                          preferences.showLunar ? chinese?.lunarLabel : "",
                          preferences.showHolidayAdjustments ? chinese?.holidayName : "",
                        ].filter(Boolean).join("，")}
                        onClick={() => setPointDate(toDateInput(day))}
                      >
                        <span className="due-solar-day">{format(day, "d")}</span>
                        {preferences.showLunar && chinese?.lunarLabel && (
                          <small>{chinese.lunarLabel}</small>
                        )}
                        {preferences.showHolidayAdjustments && chinese?.holidayLabel && (
                          <em className={chinese.holidayLabel === "班" ? "workday" : ""}>
                            {chinese.holidayLabel}
                          </em>
                        )}
                      </button>
                    </Fragment>
                  );
                })}
              </div>
              <label className="due-time-row">
                <Clock3 />
                <span>时间</span>
                <select value={pointTime} onChange={(event) => setPointTime(event.target.value)}>
                  {HALF_HOUR_OPTIONS.map((time) => (
                    <option key={time} value={time}>
                      {timeOptionLabel(time, preferences)}
                    </option>
                  ))}
                </select>
                <ChevronRight />
              </label>
              {preferences.timeZoneEnabled && (
                <label className="due-timezone-row">
                  <Globe2 />
                  <span>时区</span>
                  <input
                    aria-label="任务时区"
                    list="anttodo-time-zones"
                    value={timeZone}
                    onChange={(event) => setTimeZone(event.target.value)}
                  />
                </label>
              )}
            </div>
          ) : (
            <div className="due-range-panel">
              <label>
                <span>开始</span>
                <span className="due-date-input">
                  <span aria-hidden="true">{formatDateField(startDate, preferences)}</span>
                  <input
                    aria-label="开始日期"
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </span>
                {!allDay && (
                  <select value={startTime} onChange={(event) => setStartTime(event.target.value)}>
                    {HALF_HOUR_OPTIONS.map((time) => (
                      <option key={time} value={time}>
                        {timeOptionLabel(time, preferences)}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <label>
                <span>结束</span>
                <span className="due-date-input">
                  <span aria-hidden="true">{formatDateField(endDate, preferences)}</span>
                  <input
                    aria-label="结束日期"
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                </span>
                {!allDay && (
                  <select value={endTime} onChange={(event) => setEndTime(event.target.value)}>
                    {HALF_HOUR_OPTIONS.map((time) => (
                      <option key={time} value={time}>
                        {timeOptionLabel(time, preferences)}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <label className="due-all-day">
                <span>全天</span>
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(event) => setAllDay(event.target.checked)}
                />
                <i />
              </label>
              {preferences.timeZoneEnabled && (
                <label className="due-range-timezone">
                  <span>时区</span>
                  <input
                    aria-label="任务时区"
                    list="anttodo-time-zones"
                    value={timeZone}
                    onChange={(event) => setTimeZone(event.target.value)}
                  />
                </label>
              )}
            </div>
          )}

          <datalist id="anttodo-time-zones">
            {timeZones.map((zone) => <option value={zone} key={zone} />)}
          </datalist>

          <div className="due-placeholder-actions">
            <button type="button" aria-label="提醒" aria-disabled="true" title="提醒功能暂未开放">
              <AlarmClock /><span>准时</span><em>暂未开放</em><ChevronRight />
            </button>
            <button type="button" aria-label="重复" aria-disabled="true" title="重复功能暂未开放">
              <RotateCcw /><span>重复</span><em>暂未开放</em><ChevronRight />
            </button>
          </div>
          {error && <p className="due-error" role="alert">{error}</p>}
          <div className="due-footer">
            <button className="secondary" disabled={busy} onClick={() => void clear()}>清除</button>
            <button className="primary" disabled={busy} onClick={() => void save()}>
              {busy ? "保存中…" : "确定"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
