import {
  CalendarDays,
  CalendarPlus,
  CalendarX2,
  Copy,
  Flag,
  Link2,
  ListPlus,
  ListTodo,
  NotebookPen,
  RotateCcw,
  Sun,
  Sunrise,
  Trash2,
} from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import clsx from "clsx";
import { DueDateControl } from "./DueDateControl";
import { PRIORITY_OPTIONS } from "./PriorityControl";
import { appRoutePath } from "./lib/appRoute";
import { clearSchedulePatch } from "./lib/calendarScheduling";
import { systemTimeZone } from "./lib/dateTimePreferences";
import { getPresetDate, type DuePreset } from "./lib/dueTime";
import type {
  DateTimePreferences,
  ReminderSchedule,
  Subtask,
  Task,
  TaskPriority,
} from "./types";

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

function duePatchFromPreset(preset: DuePreset) {
  const dueAt = getPresetDate(preset);
  return {
    due_at: dueAt.toISOString(),
    due_start_at: null,
    due_is_all_day: false,
    due_timezone: systemTimeZone(),
  };
}

function subtaskDueFromPreset(preset: DuePreset) {
  const date = getPresetDate(preset);
  const endOfDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  );
  return endOfDay.toISOString();
}

async function copyTaskLink(workspaceId: string, task: Task) {
  const path = appRoutePath({
    workspaceId,
    kind: "task",
    taskId: task.id,
    itemKind: task.kind === "note" ? "note" : "task",
  });
  let url = new URL(path, window.location.origin).toString();
  if (window.location.protocol === "file:" && import.meta.env.VITE_PUBLIC_APP_URL) {
    url = new URL(path, import.meta.env.VITE_PUBLIC_APP_URL).toString();
  }
  await navigator.clipboard.writeText(url);
}

export function TaskContextMenu({
  task,
  subtask = null,
  workspaceId,
  x,
  y,
  online,
  now,
  dateTimePreferences,
  variant = "default",
  onClose,
  onUpdateTask,
  onSaveTaskSchedule,
  onCreateTask,
  onCreateSubtask,
  onUpdateSubtask,
  onDeleteSubtask,
  onExpandSubtasks,
  onNotice,
}: {
  task: Task;
  subtask?: Subtask | null;
  workspaceId: string;
  x: number;
  y: number;
  online: boolean;
  now: Date;
  dateTimePreferences: DateTimePreferences;
  variant?: "default" | "trash";
  onClose: () => void;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => Promise<void>;
  onSaveTaskSchedule: (
    taskId: string,
    patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
    schedule: ReminderSchedule,
  ) => Promise<void>;
  onCreateTask: (input: {
    title: string;
    labelIds: string[];
    dueAt?: string | null;
    dueTimezone?: string | null;
    priority?: TaskPriority;
    kind?: Task["kind"];
  }) => Promise<unknown>;
  onCreateSubtask: (
    taskId: string,
    title: string,
    extras?: Partial<Pick<Subtask, "due_at" | "assignee_id" | "cli_assignee">>,
  ) => Promise<void>;
  onUpdateSubtask: (
    subtaskId: string,
    patch: Partial<Pick<Subtask, "due_at" | "title">>,
  ) => Promise<void>;
  onDeleteSubtask: (subtaskId: string) => Promise<void>;
  onExpandSubtasks: () => void;
  onNotice: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [duePickerOpen, setDuePickerOpen] = useState(false);
  const [subtaskDate, setSubtaskDate] = useState("");
  const writable = online && !busy;
  const isSubtask = Boolean(subtask);
  const isNote = !isSubtask && task.kind === "note";
  const currentDueAt = subtask ? subtask.due_at : task.due_at;
  const menuWidth = 220;
  const estimatedHeight = variant === "trash"
    ? 72
    : isNote || isSubtask ? 300 : 360;
  const menuLeft = Math.min(Math.max(12, x), window.innerWidth - menuWidth - 12);
  const menuTop = Math.min(Math.max(12, y), window.innerHeight - estimatedHeight - 12);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !duePickerOpen) onClose();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [duePickerOpen, onClose]);

  useEffect(() => {
    if (!duePickerOpen || !subtask) return;
    const initial = subtask.due_at ? new Date(subtask.due_at) : new Date();
    const offset = initial.getTimezoneOffset() * 60_000;
    setSubtaskDate(new Date(initial.getTime() - offset).toISOString().slice(0, 10));
  }, [duePickerOpen, subtask]);

  async function run(
    action: () => Promise<void>,
    options: { closeAfter?: boolean; requireOnline?: boolean } = {},
  ) {
    const closeAfter = options.closeAfter ?? true;
    const requireOnline = options.requireOnline ?? true;
    if (busy || (requireOnline && !online)) return;
    setBusy(true);
    try {
      await action();
      if (closeAfter) onClose();
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : "操作失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function applyDuePreset(preset: DuePreset) {
    await run(async () => {
      if (subtask) {
        await onUpdateSubtask(subtask.id, { due_at: subtaskDueFromPreset(preset) });
        return;
      }
      await onSaveTaskSchedule(task.id, duePatchFromPreset(preset), scheduleForTask(task));
    });
  }

  async function clearDue() {
    await run(async () => {
      if (subtask) {
        await onUpdateSubtask(subtask.id, { due_at: null });
        return;
      }
      await onSaveTaskSchedule(task.id, clearSchedulePatch(), {
        reminders: [],
        persistent: false,
        recurrence: null,
      });
    });
  }

  async function saveSubtaskDate(value: string | null) {
    await run(async () => {
      if (!subtask) return;
      const dueAt = value
        ? new Date(`${value}T23:59:59.999`).toISOString()
        : null;
      await onUpdateSubtask(subtask.id, { due_at: dueAt });
    });
  }

  async function setPriority(priority: TaskPriority) {
    if (isSubtask || priority === task.priority) return;
    await run(async () => {
      await onUpdateTask(task.id, { priority });
    }, { closeAfter: false });
  }

  async function addSubtask() {
    if (isSubtask) return;
    await run(async () => {
      onExpandSubtasks();
      await onCreateSubtask(task.id, "新子任务");
    });
  }

  async function duplicateTarget() {
    await run(async () => {
      if (subtask) {
        await onCreateSubtask(task.id, subtask.title, {
          due_at: subtask.due_at,
          assignee_id: subtask.assignee_id,
          cli_assignee: subtask.cli_assignee,
        });
        onNotice("已在本任务下创建副本");
        return;
      }
      const created = await onCreateTask({
        title: task.title,
        labelIds: [...task.label_ids],
        kind: task.kind,
        priority: isNote ? "none" : task.priority,
        dueAt: task.due_at,
        dueTimezone: task.due_timezone,
      });
      const createdId = typeof created === "object" && created && "id" in created
        ? String(created.id)
        : null;
      if (createdId && (task.due_start_at || task.due_is_all_day)) {
        await onSaveTaskSchedule(createdId, {
          due_at: task.due_at,
          due_start_at: task.due_start_at,
          due_is_all_day: task.due_is_all_day,
          due_timezone: task.due_timezone,
        }, scheduleForTask(task));
      }
      onNotice("已创建副本");
    });
  }

  async function copyLink() {
    await run(async () => {
      await copyTaskLink(workspaceId, task);
      onNotice("链接已复制");
    }, { requireOnline: false });
  }

  async function convertKind() {
    if (isSubtask) return;
    await run(async () => {
      await onUpdateTask(task.id, {
        kind: isNote ? "todo" : "note",
        ...(isNote ? {} : { priority: "none" as const }),
      });
    });
  }

  async function deleteTarget() {
    if (subtask) {
      if (!window.confirm(`删除子任务“${subtask.title}”？`)) return;
      await run(async () => {
        await onDeleteSubtask(subtask.id);
      });
      return;
    }
    const itemName = isNote ? "笔记" : "任务";
    if (!window.confirm(
      `删除${itemName}“${task.title}”？此操作会将${itemName}移入回收站。`,
    )) return;
    await run(async () => {
      await onUpdateTask(task.id, { deleted_at: new Date().toISOString() });
    });
  }

  async function restoreTarget() {
    await run(async () => {
      await onUpdateTask(task.id, { deleted_at: null });
    });
  }

  if (variant === "trash") {
    return (
      <>
        <button
          type="button"
          className="label-menu-scrim"
          aria-label="关闭任务菜单"
          onClick={onClose}
          onContextMenu={(event) => {
            event.preventDefault();
            onClose();
          }}
        />
        <div
          className="task-context-menu"
          role="menu"
          style={{ left: menuLeft, top: menuTop }}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!writable}
            onClick={() => void restoreTarget()}
          >
            <RotateCcw />
            <span>还原</span>
          </button>
        </div>
      </>
    );
  }

  if (duePickerOpen && !isSubtask) {
    return (
      <>
        <button
          type="button"
          className="label-menu-scrim"
          aria-label="关闭日期选择"
          onClick={onClose}
          onContextMenu={(event) => {
            event.preventDefault();
            onClose();
          }}
        />
        <DueDateControl
          task={task}
          online={online}
          now={now}
          preferences={dateTimePreferences}
          autoOpen
          showTrigger={false}
          anchorPoint={{ left: menuLeft, top: Math.min(y, window.innerHeight - 560) }}
          onClose={onClose}
          onSave={async (patch, schedule) => {
            await onSaveTaskSchedule(task.id, patch, schedule);
            onClose();
          }}
        />
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className="label-menu-scrim"
        aria-label="关闭任务菜单"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        className="task-context-menu"
        role="menu"
        style={{ left: menuLeft, top: menuTop }}
      >
        <div className="task-context-section">
          <span className="task-context-section-label">日期</span>
          <div className="task-context-icon-row" role="group" aria-label="快速设置日期">
            <button
              type="button"
              title="今天"
              aria-label="今天"
              disabled={!writable}
              onClick={() => void applyDuePreset("today")}
            >
              <Sun />
            </button>
            <button
              type="button"
              title="明天"
              aria-label="明天"
              disabled={!writable}
              onClick={() => void applyDuePreset("tomorrow")}
            >
              <Sunrise />
            </button>
            <button
              type="button"
              title="下周"
              aria-label="下周"
              disabled={!writable}
              onClick={() => void applyDuePreset("next-week")}
            >
              <CalendarPlus />
              <span className="task-context-plus7">+7</span>
            </button>
            <button
              type="button"
              title="选择日期"
              aria-label="选择日期"
              disabled={!writable}
              onClick={() => setDuePickerOpen(true)}
            >
              <CalendarDays />
            </button>
            <button
              type="button"
              title="清除日期"
              aria-label="清除日期"
              disabled={!writable || !currentDueAt}
              onClick={() => void clearDue()}
            >
              <CalendarX2 />
            </button>
          </div>
          {duePickerOpen && isSubtask && (
            <div className="task-context-subtask-date">
              <input
                type="date"
                aria-label="子任务截止日期"
                value={subtaskDate}
                onChange={(event) => setSubtaskDate(event.target.value)}
              />
              <div className="task-context-subtask-date-actions">
                <button
                  type="button"
                  disabled={!writable}
                  onClick={() => void saveSubtaskDate(null)}
                >
                  清除
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={!writable || !subtaskDate}
                  onClick={() => void saveSubtaskDate(subtaskDate)}
                >
                  确定
                </button>
              </div>
            </div>
          )}
        </div>

        {!isNote && !isSubtask && (
          <div className="task-context-section">
            <span className="task-context-section-label">优先级</span>
            <div className="task-context-icon-row" role="group" aria-label="设置优先级">
              {PRIORITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  title={option.label}
                  aria-label={option.label}
                  aria-pressed={task.priority === option.value}
                  data-priority={option.value}
                  className={clsx(task.priority === option.value && "selected")}
                  disabled={!writable}
                  style={{ "--priority-color": option.color } as CSSProperties}
                  onClick={() => void setPriority(option.value)}
                >
                  <Flag />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="task-context-divider" aria-hidden="true" />

        {!isNote && (
          <button
            type="button"
            role="menuitem"
            disabled={!writable || isSubtask}
            onClick={() => void addSubtask()}
          >
            <ListPlus />
            <span>添加子任务</span>
          </button>
        )}
        <button
          type="button"
          role="menuitem"
          disabled={!writable}
          onClick={() => void duplicateTarget()}
        >
          <Copy />
          <span>创建副本</span>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => void copyLink()}
        >
          <Link2 />
          <span>复制链接</span>
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={!writable || isSubtask}
          onClick={() => void convertKind()}
        >
          {isNote ? <ListTodo /> : <NotebookPen />}
          <span>{isNote ? "转换为待办" : "转换为笔记"}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="danger"
          disabled={!writable}
          onClick={() => void deleteTarget()}
        >
          <Trash2 />
          <span>删除</span>
        </button>
      </div>
    </>
  );
}
