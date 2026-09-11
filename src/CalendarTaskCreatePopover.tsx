import clsx from "clsx";
import { Inbox } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { DueDateControl, type DueDateTarget } from "./DueDateControl";
import { LabelTreeMenuItems } from "./LabelTreeMenuItems";
import {
  fromZonedDateTime,
  systemTimeZone,
  toDateInput,
} from "./lib/dateTimePreferences";
import { PriorityControl } from "./PriorityControl";
import type {
  DateTimePreferences,
  ReminderSchedule,
  Task,
  TaskPriority,
  WorkspaceBundle,
} from "./types";

type TaskSchedulePatch = Pick<
  Task,
  "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone"
>;

export type CalendarTaskDraft = {
  title: string;
  description: string;
  priority: TaskPriority;
  labelIds: string[];
  schedulePatch: TaskSchedulePatch;
  schedule: ReminderSchedule;
};

export type CalendarTaskCreatePopoverHandle = {
  close: () => Promise<void>;
};

function defaultTodaySchedule(now: Date): TaskSchedulePatch {
  const timeZone = systemTimeZone();
  const date = toDateInput(now, timeZone);
  const start = fromZonedDateTime(date, "00:00", timeZone);
  const end = fromZonedDateTime(date, "23:59", timeZone);
  end.setSeconds(59, 999);
  return {
    due_at: end.toISOString(),
    due_start_at: start.toISOString(),
    due_is_all_day: true,
    due_timezone: timeZone,
  };
}

function DraftLabelControl({
  bundle,
  labelIds,
  disabled,
  onChange,
}: {
  bundle: WorkspaceBundle;
  labelIds: string[];
  disabled: boolean;
  onChange: (labelIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedIds = useMemo(() => new Set(labelIds), [labelIds]);
  const selectedLabels = bundle.labels.filter((label) => selectedIds.has(label.id));

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function toggleLabel(labelId: string) {
    if (disabled || (bundle.labelPermissionLevels[labelId] ?? 0) < 2) return;
    const next = new Set(selectedIds);
    if (next.has(labelId)) next.delete(labelId);
    else next.add(labelId);
    onChange([...next]);
  }

  return (
    <div className="task-label-control calendar-task-create-label-control" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={clsx("task-label-trigger", open && "active")}
        aria-label="选择任务标签"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {selectedLabels.length === 0 ? (
          <span className="task-label-inbox"><Inbox />收集箱</span>
        ) : selectedLabels.map((label) => (
          <span key={label.id} className="task-detail-label">
            <i style={{ background: label.color }} />{label.name}
          </span>
        ))}
      </button>
      {open && (
        <div className="task-label-menu" role="menu" aria-label="选择任务标签">
          <LabelTreeMenuItems
            labels={bundle.labels}
            userLabelOrder={bundle.userLabelOrder}
            selectionFor={(label) => selectedIds.has(label.id)}
            disabledFor={(label) => disabled
              || (bundle.labelPermissionLevels[label.id] ?? 0) < 2}
            onToggle={(label) => toggleLabel(label.id)}
          />
          {bundle.labels.length === 0 && <p className="task-label-menu-empty">暂无可用标签</p>}
        </div>
      )}
    </div>
  );
}

export const CalendarTaskCreatePopover = forwardRef<
  CalendarTaskCreatePopoverHandle,
  {
    anchor: HTMLElement;
    bundle: WorkspaceBundle;
    online: boolean;
    now: Date;
    dateTimePreferences: DateTimePreferences;
    onCreate: (draft: CalendarTaskDraft) => Promise<void>;
    onClose: () => void;
    onNotice: (message: string) => void;
  }
>(function CalendarTaskCreatePopover({
  anchor,
  bundle,
  online,
  now,
  dateTimePreferences,
  onCreate,
  onClose,
  onNotice,
}, forwardedRef) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("low");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [schedulePatch, setSchedulePatch] = useState<TaskSchedulePatch>(() =>
    defaultTodaySchedule(now));
  const [schedule, setSchedule] = useState<ReminderSchedule>({
    reminders: [],
    persistent: false,
    recurrence: null,
  });
  const [position, setPosition] = useState<CSSProperties>({});
  const [submitting, setSubmitting] = useState(false);
  const [hiddenWhileSubmitting, setHiddenWhileSubmitting] = useState(false);
  const closingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const dueTarget = useMemo<DueDateTarget>(() => ({
    id: "calendar-task-create-draft",
    ...schedulePatch,
    reminders: schedule.reminders.map((reminder, index) => ({
      id: `calendar-task-create-reminder:${index}`,
      task_id: "calendar-task-create-draft",
      ...reminder,
      trigger_at: "",
      position: index,
      created_by: "",
      created_at: "",
      updated_at: "",
    })),
    reminder_persistent: schedule.persistent,
    recurrence: schedule.recurrence,
    status: "open",
  }), [schedule, schedulePatch]);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const updatePosition = () => {
      const bounds = anchor.getBoundingClientRect();
      const width = Math.min(400, window.innerWidth - 24);
      const left = Math.min(
        Math.max(bounds.left + bounds.width / 2 - width / 2, 12),
        Math.max(12, window.innerWidth - width - 12),
      );
      const preferredTop = bounds.bottom + 12;
      const top = preferredTop + 300 <= window.innerHeight - 12
        ? preferredTop
        : Math.max(12, bounds.top - 300 - 12);
      setPosition({ left, top, width });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchor]);

  async function close() {
    if (closingRef.current) return;
    closingRef.current = true;
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      onClose();
      return;
    }
    if (!online) {
      closingRef.current = false;
      onNotice("离线模式下不可创建任务");
      titleRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setHiddenWhileSubmitting(true);
    try {
      await onCreate({
        title: normalizedTitle,
        description: description.trim(),
        priority,
        labelIds,
        schedulePatch,
        schedule,
      });
      onClose();
    } catch (cause) {
      closingRef.current = false;
      setSubmitting(false);
      setHiddenWhileSubmitting(false);
      onNotice(cause instanceof Error ? cause.message : "创建任务失败，请重试");
      window.setTimeout(() => titleRef.current?.focus(), 0);
    }
  }

  useImperativeHandle(forwardedRef, () => ({ close }));

  useEffect(() => {
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        rootRef.current?.contains(target)
        || anchor.contains(target)
        || target?.closest(".due-popover, .priority-menu")
      ) return;
      void close();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector(".due-popover, .priority-menu, .task-label-menu")) return;
      event.preventDefault();
      void close();
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  });

  return createPortal(
    <div
      ref={rootRef}
      className={clsx(
        "task-detail-dialog",
        "calendar-task-create-popover",
        hiddenWhileSubmitting && "is-submitting",
      )}
      style={position}
      role="dialog"
      aria-label="创建任务"
      aria-busy={submitting}
    >
      <div className="task-detail calendar-task-create-detail">
        <header className="detail-toolbar">
          <DueDateControl
            task={dueTarget}
            online={online && !submitting}
            now={now}
            preferences={dateTimePreferences}
            onSave={async (patch, nextSchedule) => {
              setSchedulePatch(patch);
              setSchedule(nextSchedule);
            }}
          />
          <div className="detail-toolbar-spacer" />
          <PriorityControl
            priority={priority}
            online={online && !submitting}
            onChange={async (nextPriority) => setPriority(nextPriority)}
          />
        </header>
        <div className="detail-body">
          <div className="detail-caption">
            <textarea
              ref={titleRef}
              className="detail-title"
              value={title}
              rows={1}
              placeholder="准备做什么？"
              aria-label="任务标题"
              disabled={submitting}
              onChange={(event) => setTitle(event.target.value.replace(/[\r\n]+/g, " "))}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                descriptionRef.current?.focus();
              }}
            />
          </div>
          <textarea
            ref={descriptionRef}
            className="calendar-task-create-description"
            value={description}
            placeholder="输入描述"
            aria-label="任务描述"
            disabled={submitting}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <footer className="detail-footer">
          <DraftLabelControl
            bundle={bundle}
            labelIds={labelIds}
            disabled={!online || submitting}
            onChange={setLabelIds}
          />
        </footer>
      </div>
    </div>,
    document.body,
  );
});
