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
  Check,
  ChevronDown,
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
import { createPortal } from "react-dom";
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
import {
  ALL_DAY_REMINDER_PRESETS,
  TIMED_REMINDER_PRESETS,
  endReminderRule,
  normalizeReminderRules,
  reminderRuleKey,
  reminderRuleLabel,
  reminderSummary,
  reminderTriggerAt,
} from "./lib/reminders";
import {
  RECURRENCE_PRESETS,
  normalizeRecurrence,
  recurrenceRule,
  recurrenceSummary,
} from "./lib/recurrence";
import {
  currentNotificationPermission,
  requestWebNotificationPermission,
  type NotificationPermissionState,
} from "./lib/webPush";
import type {
  DateTimePreferences,
  RecurrenceFreq,
  ReminderRule,
  ReminderSchedule,
  ReminderUnit,
  Task,
  TaskRecurrence,
} from "./types";

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
  return roundUpToHalfHour(task.due_start_at
    ? new Date(task.due_start_at)
    : task.due_at ? new Date(task.due_at) : new Date());
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
  autoOpen = false,
  showTrigger = true,
  anchorPoint,
  onClose,
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
    schedule: ReminderSchedule,
  ) => Promise<void>;
  autoOpen?: boolean;
  showTrigger?: boolean;
  anchorPoint?: { left: number; top: number };
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(autoOpen);

  function setPopoverOpen(next: boolean) {
    setOpen(next);
    if (!next) onClose?.();
  }
  const [tab, setTab] = useState<"point" | "range">("point");
  const [pointDate, setPointDate] = useState("");
  const [pointTime, setPointTime] = useState("");
  const [pointHasTime, setPointHasTime] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [timeZone, setTimeZone] = useState(systemTimeZone);
  const [displayedMonth, setDisplayedMonth] = useState(new Date());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [reminders, setReminders] = useState<ReminderRule[]>([]);
  const [panelReminders, setPanelReminders] = useState<ReminderRule[]>([]);
  const [recurrence, setRecurrence] = useState<TaskRecurrence | null>(null);
  const [persistent, setPersistent] = useState(false);
  const [panelPersistent, setPanelPersistent] = useState(false);
  const [customValue, setCustomValue] = useState(10);
  const [customUnit, setCustomUnit] = useState<ReminderUnit>("minute");
  const [customTime, setCustomTime] = useState("09:00");
  const [customAnchor, setCustomAnchor] = useState<"start" | "end">("start");
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermissionState>(() => currentNotificationPermission());
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
    const singleAllDay = Boolean(
      task.due_is_all_day && task.due_start_at && task.due_at
      && toDateInput(new Date(task.due_start_at), zone) === toDateInput(new Date(task.due_at), zone),
    );
    setTab(task.due_start_at && !singleAllDay ? "range" : "point");
    setPointDate(toDateInput(point, zone));
    setPointTime(toTimeInput(point, zone));
    setPointHasTime(!singleAllDay);
    setStartDate(toDateInput(start, zone));
    setStartTime(toTimeInput(start, zone));
    setEndDate(toDateInput(end, zone));
    setEndTime(toTimeInput(end, zone));
    setAllDay(task.due_is_all_day);
    setTimeZone(zone);
    setDisplayedMonth(new Date(`${toDateInput(point, zone)}T12:00:00`));
    setReminders((task.reminders ?? []).map((reminder) => ({
      anchor: reminder.anchor,
      offset_value: reminder.offset_value,
      offset_unit: reminder.offset_unit,
      local_time: reminder.local_time ? reminder.local_time.slice(0, 5) : null,
    })));
    setPanelReminders([]);
    setRecurrence(task.recurrence ?? null);
    setPersistent(Boolean(task.reminder_persistent));
    setPanelPersistent(false);
    setReminderOpen(false);
    setRepeatOpen(false);
    setCustomOpen(false);
    setNotificationPermission(currentNotificationPermission());
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
    task.reminders,
    task.reminder_persistent,
    task.recurrence,
  ]);

  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen, task.id]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      setPopoverOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setPopoverOpen(false);
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
    if (!open || !popoverRef.current) return;
    if (!triggerRef.current && !anchorPoint) return;
    const positionPopover = () => {
      const popover = popoverRef.current!;
      const gap = 8;
      const inset = 12;
      const width = Math.min(260, window.innerWidth - inset * 2);
      const height = popover.offsetHeight;
      if (anchorPoint && !triggerRef.current) {
        const left = Math.min(
          Math.max(anchorPoint.left, inset),
          Math.max(inset, window.innerWidth - width - inset),
        );
        const top = Math.min(
          Math.max(anchorPoint.top, inset),
          Math.max(inset, window.innerHeight - height - inset),
        );
        setPosition({ width, left, top });
        return;
      }
      const trigger = triggerRef.current!.getBoundingClientRect();
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
  }, [
    open,
    tab,
    allDay,
    pointHasTime,
    reminderOpen,
    repeatOpen,
    customOpen,
    error,
    anchorPoint?.left,
    anchorPoint?.top,
  ]);

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
  const draftAllDay = tab === "point" ? !pointHasTime : allDay;
  const draftDueAnchor = tab === "point"
    ? (pointDate ? fromZonedDateTime(pointDate, pointHasTime ? pointTime || "00:00" : "00:00", timeZone) : null)
    : (endDate ? fromZonedDateTime(endDate, allDay ? "23:59" : (endTime || "00:00"), timeZone) : null);
  const reminderPresets = draftAllDay
    ? ALL_DAY_REMINDER_PRESETS
    : [
        ...TIMED_REMINDER_PRESETS,
        ...(tab === "range" ? [endReminderRule()] : []),
      ];
  const reminderPresetKeys = new Set(reminderPresets.map((rule) => reminderRuleKey(rule)));
  const customPanelReminders = panelReminders.filter(
    (rule) => !reminderPresetKeys.has(reminderRuleKey(rule)),
  );
  const reminderOptions = [...reminderPresets, ...customPanelReminders];
  const displayedReminders = reminderOpen ? panelReminders : reminders;
  const displayedPersistent = reminderOpen ? panelPersistent : persistent;

  function selectRecurrence(freq: RecurrenceFreq | null) {
    if (!draftDueAnchor && freq) {
      setError("请先选择到期日期再设置重复");
      return;
    }
    setRecurrence(freq ? recurrenceRule(freq) : null);
    setError("");
  }

  function openReminderPanel() {
    setPanelReminders(reminders.map((rule) => ({ ...rule })));
    setPanelPersistent(persistent);
    setCustomOpen(false);
    setReminderOpen(true);
    setRepeatOpen(false);
    setError("");
  }

  function cancelReminderPanel() {
    setReminderOpen(false);
    setCustomOpen(false);
    setPanelReminders([]);
    setPanelPersistent(false);
    setError("");
  }

  function confirmReminderPanel() {
    setReminders(panelReminders.map((rule) => ({ ...rule })));
    setPersistent(panelPersistent && panelReminders.length > 0);
    setReminderOpen(false);
    setCustomOpen(false);
    setError("");
  }

  function togglePanelReminder(rule: ReminderRule) {
    const key = reminderRuleKey(rule);
    const exists = panelReminders.some((item) => reminderRuleKey(item) === key);
    if (exists) {
      const next = panelReminders.filter((item) => reminderRuleKey(item) !== key);
      setPanelReminders(next);
      if (next.length === 0) setPanelPersistent(false);
      return;
    }
    try {
      setPanelReminders(normalizeReminderRules([...panelReminders, rule]));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "提醒设置无效");
    }
  }

  function saveCustomReminder() {
    const rule: ReminderRule = {
      anchor: draftAllDay ? "start" : customAnchor,
      offset_value: customValue,
      offset_unit: customUnit,
      local_time: draftAllDay ? customTime : null,
    };
    const key = reminderRuleKey(rule);
    if (!panelReminders.some((item) => reminderRuleKey(item) === key)) {
      togglePanelReminder(rule);
    }
    setCustomOpen(false);
  }

  function cancelCustomReminder() {
    setCustomOpen(false);
  }

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
    if (next === "point") {
      setReminders((current) => current.filter((rule) => rule.anchor === "start"));
    }
    cancelReminderPanel();
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
    if (tab === "point" && !pointHasTime) {
      const start = fromZonedDateTime(pointDate, "00:00", savedZone);
      const end = fromZonedDateTime(pointDate, "23:59", savedZone);
      end.setSeconds(59, 999);
      patch = {
        due_at: end.toISOString(),
        due_start_at: start.toISOString(),
        due_is_all_day: true,
        due_timezone: savedZone,
      };
    } else if (tab === "point") {
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
    let normalizedReminders: ReminderRule[];
    let normalizedRecurrence: TaskRecurrence | null;
    try {
      normalizedReminders = normalizeReminderRules(reminders);
      normalizedRecurrence = normalizeRecurrence(recurrence);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "日程设置无效");
      return;
    }
    if (normalizedReminders.length > 0) {
      const permission = await requestWebNotificationPermission();
      setNotificationPermission(permission);
    }
    const schedule = {
      reminders: normalizedReminders,
      persistent: persistent && normalizedReminders.length > 0,
      recurrence: normalizedRecurrence,
    };
    const hasExpiredReminder = normalizedReminders.some((rule) => {
      const trigger = reminderTriggerAt({ ...task, ...patch }, rule);
      return trigger ? new Date(trigger).getTime() <= now.getTime() : false;
    });
    setBusy(true);
    try {
      await onSave(patch, schedule);
      if (hasExpiredReminder) {
        setError("部分提醒时间已过期，规则已保留但不会补发，请调整日期或提醒");
        return;
      }
      setPopoverOpen(false);
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
      }, { reminders: [], persistent: false, recurrence: null });
      setPopoverOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="detail-due-control" ref={rootRef}>
      {showTrigger && (
        <button
          ref={triggerRef}
          type="button"
          className={status?.overdue ? "detail-due-trigger overdue" : "detail-due-trigger"}
          aria-label="设置到期时间"
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={!online}
          onClick={() => setPopoverOpen(!open)}
        >
          <CalendarDays />
          <span>{formatDueWithPreferences({ ...dueFields, due_timezone: task.due_timezone }, preferences)}</span>
          {status && <em>{status.label}</em>}
        </button>
      )}
      {open && createPortal(
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
                <select
                  value={pointHasTime ? pointTime : ""}
                  onChange={(event) => {
                    const nextHasTime = Boolean(event.target.value);
                    if (nextHasTime !== pointHasTime) {
                      setReminders([]);
                      setPersistent(false);
                      cancelReminderPanel();
                    }
                    setPointHasTime(nextHasTime);
                    if (event.target.value) setPointTime(event.target.value);
                  }}
                >
                  <option value="">不要设置时间</option>
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
                  onChange={(event) => {
                    setAllDay(event.target.checked);
                    setReminders([]);
                    setPersistent(false);
                    cancelReminderPanel();
                  }}
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
            <button
              type="button"
              aria-label="提醒"
              aria-expanded={reminderOpen}
              onClick={() => {
                if (reminderOpen) {
                  cancelReminderPanel();
                } else {
                  openReminderPanel();
                }
              }}
            >
              <AlarmClock />
              <span>{reminderSummary({ reminders: displayedReminders, persistent: displayedPersistent, recurrence: null }, draftAllDay)}</span>
              {displayedReminders.length > 0 && <em>{displayedReminders.length}</em>}
              <ChevronDown />
            </button>
            <button
              type="button"
              aria-label="重复"
              aria-expanded={repeatOpen}
              className={recurrence ? "has-value" : undefined}
              onClick={() => {
                setRepeatOpen((value) => !value);
                cancelReminderPanel();
              }}
            >
              <RotateCcw />
              <span>{recurrenceSummary(recurrence, draftDueAnchor, timeZone)}</span>
              <ChevronDown />
            </button>
          </div>
          {repeatOpen && (
            <section className="due-repeat-panel" aria-label="重复设置">
              <div className="due-reminder-options">
                {RECURRENCE_PRESETS.map((preset) => {
                  const selected = (recurrence?.freq ?? null) === preset.freq;
                  return (
                    <button
                      type="button"
                      key={preset.label}
                      aria-pressed={selected}
                      onClick={() => selectRecurrence(preset.freq)}
                    >
                      <span>
                        {preset.freq === "weekly" || preset.freq === "monthly" || preset.freq === "yearly"
                          ? recurrenceSummary(
                              preset.freq ? recurrenceRule(preset.freq) : null,
                              draftDueAnchor,
                              timeZone,
                            )
                          : preset.label}
                      </span>
                      {selected && <Check />}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          {reminderOpen && (
            <section className="due-reminder-panel" aria-label="提醒设置">
              {!customOpen ? (
                <>
                  <div className="due-reminder-options">
                    {reminderOptions.map((rule) => {
                      const selected = panelReminders.some(
                        (item) => reminderRuleKey(item) === reminderRuleKey(rule),
                      );
                      return (
                        <button
                          type="button"
                          key={reminderRuleKey(rule)}
                          aria-pressed={selected}
                          onClick={() => togglePanelReminder(rule)}
                        >
                          <span>{reminderRuleLabel(rule, draftAllDay)}</span>
                          {selected && <Check />}
                        </button>
                      );
                    })}
                    <button type="button" onClick={() => {
                      if (draftAllDay && !["day", "week"].includes(customUnit)) {
                        setCustomUnit("day");
                      }
                      setCustomOpen(true);
                    }}>
                      <span>自定义</span><ChevronRight />
                    </button>
                  </div>
                  <label className="due-persistent-row">
                    <span>
                      <strong>持续提醒</strong>
                      <small>每 2 分钟，最多 30 分钟</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={panelPersistent}
                      disabled={panelReminders.length === 0}
                      onChange={(event) => setPanelPersistent(event.target.checked)}
                    />
                    <i />
                  </label>
                  <div className="due-reminder-footer">
                    <button className="secondary" type="button" onClick={cancelReminderPanel}>取消</button>
                    <button className="primary" type="button" onClick={confirmReminderPanel}>确定</button>
                  </div>
                </>
              ) : (
                <div className="due-reminder-custom">
                  <header>
                    <button type="button" aria-label="返回提醒预设" onClick={cancelCustomReminder}>
                      <ChevronLeft />
                    </button>
                    <strong>自定义提醒</strong>
                  </header>
                  {tab === "range" && !draftAllDay && (
                    <label>
                      <span>相对</span>
                      <select value={customAnchor} onChange={(event) => setCustomAnchor(event.target.value as "start" | "end")}>
                        <option value="start">开始时间</option>
                        <option value="end">结束时间</option>
                      </select>
                    </label>
                  )}
                  <label>
                    <span>提前</span>
                    <input
                      type="number"
                      min="0"
                      max="525600"
                      value={customValue}
                      onChange={(event) => setCustomValue(Math.max(0, Number(event.target.value) || 0))}
                    />
                    <select value={customUnit} onChange={(event) => setCustomUnit(event.target.value as ReminderUnit)}>
                      {!draftAllDay && <option value="minute">分钟</option>}
                      {!draftAllDay && <option value="hour">小时</option>}
                      <option value="day">天</option>
                      <option value="week">周</option>
                    </select>
                  </label>
                  {draftAllDay && (
                    <label><span>时间</span><input type="time" value={customTime} onChange={(event) => setCustomTime(event.target.value)} /></label>
                  )}
                  <div className="due-reminder-footer">
                    <button className="secondary" type="button" onClick={cancelCustomReminder}>取消</button>
                    <button className="primary" type="button" onClick={saveCustomReminder}>保存</button>
                  </div>
                </div>
              )}
            </section>
          )}
          {notificationPermission === "denied" && reminders.length > 0 && (
            <p className="due-notification-warning">当前浏览器未授权通知；提醒会保存，但本机不会弹出通知。</p>
          )}
          {notificationPermission === "unsupported" && reminders.length > 0 && (
            <p className="due-notification-warning">当前浏览器不支持 Web Push 通知。</p>
          )}
          {error && <p className="due-error" role="alert">{error}</p>}
          <div className="due-footer">
            <button className="secondary" disabled={busy} onClick={() => void clear()}>清除</button>
            <button className="primary" disabled={busy} onClick={() => void save()}>
              {busy ? "保存中…" : "确定"}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
