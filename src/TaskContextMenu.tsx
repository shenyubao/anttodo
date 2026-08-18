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
import { DueDateControl, dueTargetFromChildTask } from "./DueDateControl";
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
import { canAddChild } from "./lib/taskTree";
import type {
  DateTimePreferences,
  ReminderSchedule,
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

function childTaskScheduleFromChildTask(childTask: Task): ReminderSchedule {
  return {
    reminders: childTask.reminders.map((reminder) => ({
      anchor: reminder.anchor,
      offset_value: reminder.offset_value,
      offset_unit: reminder.offset_unit,
      local_time: reminder.local_time,
    })),
    persistent: childTask.reminder_persistent,
    recurrence: null,
  };
}

async function copyTaskLink(workspaceId: string, task: Task) {
  await navigator.clipboard.writeText(taskShareUrl(workspaceId, task));
}

export function TaskContextMenu({
  task,
  childTask = null,
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
  onSaveChildTaskSchedule,
  onCreateTask,
  onCreateChildTask,
  onUpdateChildTask,
  onDeleteChildTask,
  onPurgeTask,
  onExpandChildTasks,
  onNotice,
  pickerTasks = [],
  onAddDependencies,
}: {
  task: Task;
  childTask?: Task | null;
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
  onSaveChildTaskSchedule: (
    targetTaskId: string,
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
  onCreateChildTask: (
    taskId: string,
    title: string,
    extras?: Partial<Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone" | "assignee_id" | "cli_assignee" | "priority" | "parent_task_id">>,
  ) => Promise<void>;
  onUpdateChildTask: (
    targetTaskId: string,
    patch: Partial<Pick<Task, "due_at" | "title" | "priority">>,
  ) => Promise<void>;
  onDeleteChildTask: (targetTaskId: string) => Promise<void>;
  onPurgeTask: (taskId: string) => Promise<void>;
  onExpandChildTasks: () => void;
  onNotice: (message: string) => void;
  pickerTasks?: Task[];
  onAddDependencies?: (taskId: string, targets: TaskDependencyTarget[]) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [duePickerOpen, setDuePickerOpen] = useState(false);
  const [dependencyPickerOpen, setDependencyPickerOpen] = useState(false);
  const writable = online && !busy;
  const isChildTask = Boolean(childTask);
  const isNote = !isChildTask && task.kind === "note";
  const currentDueAt = childTask ? childTask.due_at : task.due_at;
  const menuWidth = 220;
  const estimatedHeight = variant === "trash"
    ? 110
    : isNote ? 300 : isChildTask ? 340 : 360;
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
      if (childTask) {
        await onSaveChildTaskSchedule(childTask.id, duePatchFromPreset(preset, true), childTaskScheduleFromChildTask(childTask));
        return;
      }
      await onSaveTaskSchedule(task.id, duePatchFromPreset(preset), scheduleForTask(task));
    });
  }

  async function clearDue() {
    await run(async () => {
      if (childTask) {
        await onSaveChildTaskSchedule(childTask.id, clearSchedulePatch(), {
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
    if (childTask) {
      if (priority === childTask.priority) return;
      await run(() => onUpdateChildTask(childTask.id, { priority }), { closeAfter: false });
      return;
    }
    if (priority === task.priority) return;
    await run(async () => {
      await onUpdateTask(task.id, { priority });
    }, { closeAfter: false });
  }

  async function addChildTask() {
    if (childTask && !canAddChild(task.children, childTask.id)) return;
    await run(async () => {
      onExpandChildTasks();
      await onCreateChildTask(task.id, "新子级任务", childTask
        ? { parent_task_id: childTask.id }
        : undefined);
    });
  }

  async function duplicateTarget() {
    await run(async () => {
      if (childTask) {
        await onCreateChildTask(task.id, childTask.title, {
          parent_task_id: childTask.parent_task_id,
          due_at: childTask.due_at,
          due_start_at: childTask.due_start_at,
          due_is_all_day: childTask.due_is_all_day,
          due_timezone: childTask.due_timezone,
          assignee_id: childTask.assignee_id,
          cli_assignee: childTask.cli_assignee,
          priority: childTask.priority,
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
    if (isChildTask) return;
    await run(async () => {
      await onUpdateTask(task.id, {
        kind: isNote ? "todo" : "note",
        ...(isNote ? {} : { priority: "none" as const }),
      });
    });
  }

  async function deleteTarget() {
    if (childTask) {
      if (!window.confirm(`删除子级任务“${childTask.title}”？`)) return;
      await run(async () => {
        await onDeleteChildTask(childTask.id);
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
          task={childTask ? dueTargetFromChildTask(childTask) : task}
          online={online}
          now={now}
          preferences={dateTimePreferences}
          autoOpen
          showTrigger={false}
          allowRecurrence={!childTask}
          anchorPoint={{ left: menuLeft, top: Math.min(y, window.innerHeight - 560) }}
          onClose={onClose}
          onSave={async (patch, schedule) => {
            if (childTask) await onSaveChildTaskSchedule(childTask.id, patch, schedule);
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
          { taskId: childTask?.id ?? task.id },
          listItemDependencies(childTask ?? task),
        )}
        selectedTaskId={null}
        excludeKeys={[
          dependencyTargetKey({ taskId: childTask?.id ?? task.id }),
          ...listItemDependencies(childTask ?? task).map((row) =>
            dependencyTargetKey({ taskId: row.depends_on_task_id })),
        ]}
        anchorPoint={{ left: menuLeft, top: menuTop }}
        onOpenChange={(nextOpen) => {
          setDependencyPickerOpen(nextOpen);
          if (!nextOpen) onClose();
        }}
        onSelect={() => undefined}
        onConfirm={(targets) => {
          void onAddDependencies(childTask?.id ?? task.id, targets);
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
                  aria-pressed={(childTask?.priority ?? task.priority) === option.value}
                  data-priority={option.value}
                  className={clsx((childTask?.priority ?? task.priority) === option.value && "selected")}
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
            disabled={!writable || (childTask ? !canAddChild(task.children, childTask.id) : false)}
            onClick={() => void addChildTask()}
          >
            <ListPlus />
            <span>添加子级任务</span>
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
          disabled={!writable || isChildTask}
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
