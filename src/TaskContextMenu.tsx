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
import { contextMenuActionTasks, formatBulkNotice, runBulkTaskUpdates } from "./lib/taskMultiSelect";
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

async function copyTaskLinks(workspaceId: string, tasks: readonly Task[]) {
  await navigator.clipboard.writeText(
    tasks.map((item) => taskShareUrl(workspaceId, item)).join("\n"),
  );
}

export function resolveTaskContextMenuVariant(
  task: Pick<Task, "connector_id">,
  variant: "default" | "trash" = "default",
): "default" | "trash" | "external" {
  if (variant === "trash") return "trash";
  return task.connector_id ? "external" : "default";
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
  selectedTasks = [],
  onAddDependencies,
}: {
  task: Task;
  childTask?: Task | null;
  selectedTasks?: readonly Task[];
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
  const focusTask = childTask ?? task;
  const actionTasks = contextMenuActionTasks(focusTask, selectedTasks) ?? [focusTask];
  const isBulk = actionTasks.length > 1;
  const isNote = !isChildTask && task.kind === "note";
  const menuKind = resolveTaskContextMenuVariant(task, variant);
  const currentDueAt = childTask ? childTask.due_at : task.due_at;
  const menuWidth = 220;
  const estimatedHeight = menuKind === "trash"
    ? 110
    : menuKind === "external"
      ? 150
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

  async function applyToTargets(
    filter: (item: Task) => boolean,
    action: (item: Task) => Promise<void>,
    verb: string,
  ) {
    const items = actionTasks.filter(filter);
    const skipped = actionTasks.length - items.length;
    const result = await runBulkTaskUpdates(items, action);
    const notice = formatBulkNotice({ ...result, skipped, action: verb });
    if (notice) onNotice(notice);
    return result;
  }

  function canEditContent(item: Task) {
    return !item.connector_id && !item.deleted_at;
  }

  async function saveSchedule(
    item: Task,
    patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
    schedule: ReminderSchedule,
  ) {
    if (item.parent_task_id) {
      await onSaveChildTaskSchedule(item.id, patch, { ...schedule, recurrence: null });
      return;
    }
    await onSaveTaskSchedule(item.id, patch, schedule);
  }

  async function applyDuePreset(preset: DuePreset) {
    await run(async () => {
      if (!isBulk) {
        if (childTask) {
          await onSaveChildTaskSchedule(
            childTask.id,
            duePatchFromPreset(preset, true),
            childTaskScheduleFromChildTask(childTask),
          );
          return;
        }
        await onSaveTaskSchedule(task.id, duePatchFromPreset(preset), scheduleForTask(task));
        return;
      }
      await applyToTargets(
        canEditContent,
        (item) => saveSchedule(item, duePatchFromPreset(preset, Boolean(item.due_is_all_day)), scheduleForTask(item)),
        "更新日期",
      );
    });
  }

  async function clearDue() {
    await run(async () => {
      const empty = { reminders: [] as ReminderSchedule["reminders"], persistent: false, recurrence: null };
      if (!isBulk) {
        if (childTask) {
          await onSaveChildTaskSchedule(childTask.id, clearSchedulePatch(), empty);
          return;
        }
        await onSaveTaskSchedule(task.id, clearSchedulePatch(), empty);
        return;
      }
      await applyToTargets(
        (item) => canEditContent(item) && Boolean(item.due_at),
        (item) => saveSchedule(item, clearSchedulePatch(), empty),
        "清除日期",
      );
    });
  }

  async function setPriority(priority: TaskPriority) {
    if (!isBulk) {
      if (childTask) {
        if (priority === childTask.priority) return;
        await run(() => onUpdateChildTask(childTask.id, { priority }), { closeAfter: false });
        return;
      }
      if (priority === task.priority) return;
      await run(async () => {
        await onUpdateTask(task.id, { priority });
      }, { closeAfter: false });
      return;
    }
    await run(async () => {
      await applyToTargets(
        (item) => canEditContent(item) && item.kind !== "note" && item.priority !== priority,
        (item) => onUpdateTask(item.id, { priority }),
        "更新优先级",
      );
    }, { closeAfter: false });
  }

  async function addChildTask() {
    if (!isBulk) {
      if (childTask && !canAddChild(task.children, childTask.id)) return;
      await run(async () => {
        onExpandChildTasks();
        await onCreateChildTask(task.id, "新子级任务", childTask
          ? { parent_task_id: childTask.id }
          : undefined);
      });
      return;
    }
    await run(async () => {
      onExpandChildTasks();
      await applyToTargets(
        (item) => canEditContent(item) && item.kind !== "note",
        (item) => onCreateChildTask(item.id, "新子级任务"),
        "添加子级任务",
      );
    });
  }

  async function duplicateOne(item: Task) {
    if (item.parent_task_id) {
      await onCreateChildTask(item.id, item.title, {
        parent_task_id: item.parent_task_id,
        due_at: item.due_at,
        due_start_at: item.due_start_at,
        due_is_all_day: item.due_is_all_day,
        due_timezone: item.due_timezone,
        assignee_id: item.assignee_id,
        cli_assignee: item.cli_assignee,
        priority: item.priority,
      });
      return;
    }
    const created = await onCreateTask({
      title: item.title,
      labelIds: [...item.label_ids],
      kind: item.kind,
      priority: item.kind === "note" ? "none" : item.priority,
      dueAt: item.due_at,
      dueTimezone: item.due_timezone,
    });
    const createdId = typeof created === "object" && created && "id" in created
      ? String(created.id)
      : null;
    if (createdId && (item.due_start_at || item.due_is_all_day)) {
      await onSaveTaskSchedule(createdId, {
        due_at: item.due_at,
        due_start_at: item.due_start_at,
        due_is_all_day: item.due_is_all_day,
        due_timezone: item.due_timezone,
      }, scheduleForTask(item));
    }
  }

  async function duplicateTarget() {
    await run(async () => {
      if (!isBulk) {
        await duplicateOne(focusTask);
        onNotice(childTask ? "已在本任务下创建副本" : "已创建副本");
        return;
      }
      await applyToTargets(canEditContent, duplicateOne, "创建副本");
    });
  }

  async function copyLink() {
    await run(async () => {
      await copyTaskLinks(workspaceId, actionTasks);
      onNotice(isBulk ? `已复制 ${actionTasks.length} 条链接` : "链接已复制");
    }, { requireOnline: false });
  }

  async function convertKind() {
    if (!isBulk && isChildTask) return;
    await run(async () => {
      if (!isBulk) {
        await onUpdateTask(task.id, {
          kind: isNote ? "todo" : "note",
          ...(isNote ? {} : { priority: "none" as const }),
        });
        return;
      }
      await applyToTargets(
        (item) => canEditContent(item)
          && !item.parent_task_id
          && item.kind === (isNote ? "note" : "todo"),
        (item) => onUpdateTask(item.id, isNote
          ? { kind: "todo" }
          : { kind: "note", priority: "none" }),
        isNote ? "转换为待办" : "转换为笔记",
      );
    });
  }

  async function deleteTarget() {
    if (!isBulk && childTask) {
      if (!window.confirm(`删除子级任务“${childTask.title}”？`)) return;
      await run(async () => {
        await onDeleteChildTask(childTask.id);
      });
      return;
    }
    await run(async () => {
      await applyToTargets(
        (item) => !item.deleted_at,
        (item) => onUpdateTask(item.id, { deleted_at: new Date().toISOString() }),
        "删除",
      );
    });
  }

  async function restoreTarget() {
    await run(async () => {
      if (!isBulk) {
        await onUpdateTask(task.id, { deleted_at: null });
        return;
      }
      await applyToTargets(
        (item) => Boolean(item.deleted_at),
        (item) => onUpdateTask(item.id, { deleted_at: null }),
        "还原",
      );
    });
  }

  async function purgeTarget() {
    if (!isBulk) {
      const itemName = task.kind === "note" ? "笔记" : "任务";
      if (!window.confirm(
        `彻底删除${itemName}“${task.title}”？此操作不可撤销。`,
      )) return;
      await run(async () => {
        await onPurgeTask(task.id);
      });
      return;
    }
    if (!window.confirm(`彻底删除已选择的 ${actionTasks.length} 项？此操作不可撤销。`)) return;
    await run(async () => {
      await applyToTargets(
        (item) => Boolean(item.deleted_at),
        (item) => onPurgeTask(item.id),
        "彻底删除",
      );
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
          allowRecurrence={!isBulk && !childTask}
          anchorPoint={{ left: menuLeft, top: Math.min(y, window.innerHeight - 560) }}
          onClose={onClose}
          onSave={async (patch, schedule) => {
            if (!isBulk) {
              if (childTask) await onSaveChildTaskSchedule(childTask.id, patch, schedule);
              else await onSaveTaskSchedule(task.id, patch, schedule);
              onClose();
              return;
            }
            await applyToTargets(
              canEditContent,
              (item) => saveSchedule(item, patch, schedule),
              "更新日期",
            );
            onClose();
          }}
        />
      </>
    );
  }

  if (dependencyPickerOpen && onAddDependencies) {
    const sources = actionTasks.filter((item) => item.kind !== "note");
    const sourceTargets = sources.map((item) => ({ taskId: item.id }));
    const existing = isBulk ? [] : listItemDependencies(focusTask);
    return (
      <FocusTaskPicker
        open
        mode="dependency"
        tasks={filterPickerTasksForDependency(pickerTasks, sourceTargets, existing)}
        selectedTaskId={null}
        excludeKeys={[
          ...sourceTargets.map((item) => dependencyTargetKey(item)),
          ...existing.map((row) => dependencyTargetKey({ taskId: row.depends_on_task_id })),
        ]}
        anchorPoint={{ left: menuLeft, top: menuTop }}
        onOpenChange={(nextOpen) => {
          setDependencyPickerOpen(nextOpen);
          if (!nextOpen) onClose();
        }}
        onSelect={() => undefined}
        onConfirm={(targets) => {
          void run(async () => {
            if (!isBulk) {
              await onAddDependencies(focusTask.id, targets);
              return;
            }
            await applyToTargets(
              (item) => item.kind !== "note",
              (item) => onAddDependencies(item.id, targets),
              "挂载依赖",
            );
          });
        }}
      />
    );
  }

  if (menuKind === "external") {
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
          {task.kind !== "note" && onAddDependencies && (
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
            onClick={() => void copyLink()}
          >
            <Link2 />
            <span>复制链接</span>
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
