import {
  CalendarDays,
  CalendarPlus,
  CalendarX2,
  Copy,
  Flag,
  GitFork,
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
import { DueDateControl, dueTargetFromSubtask } from "./DueDateControl";
import { FocusTaskPicker } from "./FocusTaskPicker";
import { PRIORITY_OPTIONS } from "./PriorityControl";
import { taskShareUrl } from "./lib/appRoute";
import { clearSchedulePatch, schedulePatchFromDrop } from "./lib/calendarScheduling";
import { systemTimeZone } from "./lib/dateTimePreferences";
import { getPresetDate, type DuePreset } from "./lib/dueTime";
import {
  dependencyTargetKey,
  filterPickerTasksForDependency,
  listItemDependencies,
} from "./lib/taskDependencies";
import { canAddChild } from "./lib/subtaskTree";
import type {
  DateTimePreferences,
  ReminderSchedule,
  Subtask,
  Task,
  TaskDependencyTarget,
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

function duePatchFromPreset(preset: DuePreset, allDay = false) {
  const dueAt = getPresetDate(preset);
  if (allDay) return schedulePatchFromDrop(dueAt, true, systemTimeZone());
  return {
    due_at: dueAt.toISOString(),
    due_start_at: null,
    due_is_all_day: false,
    due_timezone: systemTimeZone(),
  };
}

function subtaskScheduleFromSubtask(subtask: Subtask): ReminderSchedule {
  return {
    reminders: subtask.reminders.map((reminder) => ({
      anchor: reminder.anchor,
      offset_value: reminder.offset_value,
      offset_unit: reminder.offset_unit,
      local_time: reminder.local_time,
    })),
    persistent: subtask.reminder_persistent,
    recurrence: null,
  };
}

async function copyTaskLink(workspaceId: string, task: Task) {
  await navigator.clipboard.writeText(taskShareUrl(workspaceId, task));
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
  onSaveSubtaskSchedule,
  onCreateTask,
  onCreateSubtask,
  onUpdateSubtask,
  onDeleteSubtask,
  onPurgeTask,
  onExpandSubtasks,
  onNotice,
  pickerTasks = [],
  onAddDependencies,
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
  onSaveSubtaskSchedule: (
    subtaskId: string,
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
    extras?: Partial<Pick<Subtask, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone" | "assignee_id" | "cli_assignee" | "priority" | "parent_subtask_id">>,
  ) => Promise<void>;
  onUpdateSubtask: (
    subtaskId: string,
    patch: Partial<Pick<Subtask, "due_at" | "title" | "priority">>,
  ) => Promise<void>;
  onDeleteSubtask: (subtaskId: string) => Promise<void>;
  onPurgeTask: (taskId: string) => Promise<void>;
  onExpandSubtasks: () => void;
  onNotice: (message: string) => void;
  pickerTasks?: Task[];
  onAddDependencies?: (targets: TaskDependencyTarget[], subtaskId?: string | null) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [duePickerOpen, setDuePickerOpen] = useState(false);
  const [dependencyPickerOpen, setDependencyPickerOpen] = useState(false);
  const writable = online && !busy;
  const isSubtask = Boolean(subtask);
  const isNote = !isSubtask && task.kind === "note";
  const currentDueAt = subtask ? subtask.due_at : task.due_at;
  const menuWidth = 220;
  const estimatedHeight = variant === "trash"
    ? 110
    : isNote ? 300 : isSubtask ? 340 : 360;
  const menuLeft = Math.min(Math.max(12, x), window.innerWidth - menuWidth - 12);
  const menuTop = Math.min(Math.max(12, y), window.innerHeight - estimatedHeight - 12);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !duePickerOpen && !dependencyPickerOpen) onClose();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [dependencyPickerOpen, duePickerOpen, onClose]);

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
        await onSaveSubtaskSchedule(subtask.id, duePatchFromPreset(preset, true), subtaskScheduleFromSubtask(subtask));
        return;
      }
      await onSaveTaskSchedule(task.id, duePatchFromPreset(preset), scheduleForTask(task));
    });
  }

  async function clearDue() {
    await run(async () => {
      if (subtask) {
        await onSaveSubtaskSchedule(subtask.id, clearSchedulePatch(), {
          reminders: [],
          persistent: false,
          recurrence: null,
        });
        return;
      }
      await onSaveTaskSchedule(task.id, clearSchedulePatch(), {
        reminders: [],
        persistent: false,
        recurrence: null,
      });
    });
  }

  async function setPriority(priority: TaskPriority) {
    if (subtask) {
      if (priority === subtask.priority) return;
      await run(() => onUpdateSubtask(subtask.id, { priority }), { closeAfter: false });
      return;
    }
    if (priority === task.priority) return;
    await run(async () => {
      await onUpdateTask(task.id, { priority });
    }, { closeAfter: false });
  }

  async function addSubtask() {
    if (subtask && !canAddChild(task.subtasks, subtask.id)) return;
    await run(async () => {
      onExpandSubtasks();
      await onCreateSubtask(task.id, "新子任务", subtask
        ? { parent_subtask_id: subtask.id }
        : undefined);
    });
  }

  async function duplicateTarget() {
    await run(async () => {
      if (subtask) {
        await onCreateSubtask(task.id, subtask.title, {
          parent_subtask_id: subtask.parent_subtask_id,
          due_at: subtask.due_at,
          due_start_at: subtask.due_start_at,
          due_is_all_day: subtask.due_is_all_day,
          due_timezone: subtask.due_timezone,
          assignee_id: subtask.assignee_id,
          cli_assignee: subtask.cli_assignee,
          priority: subtask.priority,
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
    await run(async () => {
      await onUpdateTask(task.id, { deleted_at: new Date().toISOString() });
    });
  }

  async function restoreTarget() {
    await run(async () => {
      await onUpdateTask(task.id, { deleted_at: null });
    });
  }

  async function purgeTarget() {
    const itemName = task.kind === "note" ? "笔记" : "任务";
    if (!window.confirm(
      `彻底删除${itemName}“${task.title}”？此操作不可撤销。`,
    )) return;
    await run(async () => {
      await onPurgeTask(task.id);
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
          <button
            type="button"
            role="menuitem"
            className="danger"
            disabled={!writable}
            onClick={() => void purgeTarget()}
          >
            <Trash2 />
            <span>彻底删除</span>
          </button>
        </div>
      </>
    );
  }

  if (duePickerOpen) {
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
          task={subtask ? dueTargetFromSubtask(subtask) : task}
          online={online}
          now={now}
          preferences={dateTimePreferences}
          autoOpen
          showTrigger={false}
          allowRecurrence={!subtask}
          anchorPoint={{ left: menuLeft, top: Math.min(y, window.innerHeight - 560) }}
          onClose={onClose}
          onSave={async (patch, schedule) => {
            if (subtask) await onSaveSubtaskSchedule(subtask.id, patch, schedule);
            else await onSaveTaskSchedule(task.id, patch, schedule);
            onClose();
          }}
        />
      </>
    );
  }

  if (dependencyPickerOpen && onAddDependencies) {
    return (
      <FocusTaskPicker
        open
        mode="dependency"
        tasks={filterPickerTasksForDependency(
          pickerTasks,
          { taskId: task.id, subtaskId: subtask?.id ?? null },
          listItemDependencies(task, subtask?.id ?? null),
        )}
        selectedTaskId={null}
        excludeKeys={[
          dependencyTargetKey({ taskId: task.id, subtaskId: subtask?.id ?? null }),
          ...listItemDependencies(task, subtask?.id ?? null).map((row) =>
            dependencyTargetKey({
              taskId: row.depends_on_task_id,
              subtaskId: row.depends_on_subtask_id,
            })),
        ]}
        anchorPoint={{ left: menuLeft, top: menuTop }}
        onOpenChange={(nextOpen) => {
          setDependencyPickerOpen(nextOpen);
          if (!nextOpen) onClose();
        }}
        onSelect={() => undefined}
        onConfirm={(targets) => {
          void onAddDependencies(targets, subtask?.id ?? null);
        }}
      />
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
        </div>

        {!isNote && (
          <div className="task-context-section">
            <span className="task-context-section-label">优先级</span>
            <div className="task-context-icon-row" role="group" aria-label="设置优先级">
              {PRIORITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  title={option.label}
                  aria-label={option.label}
                  aria-pressed={(subtask?.priority ?? task.priority) === option.value}
                  data-priority={option.value}
                  className={clsx((subtask?.priority ?? task.priority) === option.value && "selected")}
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
            disabled={!writable || (subtask ? !canAddChild(task.subtasks, subtask.id) : false)}
            onClick={() => void addSubtask()}
          >
            <ListPlus />
            <span>添加子任务</span>
          </button>
        )}
        {!isNote && onAddDependencies && (
          <button
            type="button"
            role="menuitem"
            disabled={!writable}
            onClick={() => setDependencyPickerOpen(true)}
          >
            <GitFork />
            <span>挂载依赖任务</span>
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
