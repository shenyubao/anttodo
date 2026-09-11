import { TaskStatusMenuItems } from "./TaskStatusActions";
import clsx from "clsx";
import {
  CalendarDays,
  Check,
  CheckSquare,
  Clipboard,
  Copy,
  Flag,
  List,
  Merge,
  Pin,
  RotateCcw,
  SquareStack,
  StickyNote,
  Tag,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { DueDateControl, type DueDateTarget } from "./DueDateControl";
import { FocusTaskPicker } from "./FocusTaskPicker";
import { LabelTreeMenuItems } from "./LabelTreeMenuItems";
import { getPriorityOption, PriorityControl } from "./PriorityControl";
import { formatDueExact } from "./lib/dueTime";
import { shouldDismissTaskDetailOnPointerDown } from "./lib/taskDetailDismiss";
import { orderedLabels } from "./lib/taskList";
import {
  allTasksUnlabeled,
  intersectLabelIds,
  labelSelectionState,
  sharedDueFields,
} from "./lib/taskMultiSelect";
import type {
  AiWorkSettings,
  DateTimePreferences,
  ReminderSchedule,
  Task,
  TaskPriority,
  WorkspaceBundle,
} from "./types";

const BULK_DUE_TARGET: DueDateTarget = {
  id: "bulk-due",
  due_at: null,
  due_start_at: null,
  due_is_all_day: false,
  due_timezone: null,
  reminders: [],
  reminder_persistent: false,
};

function sharedPriority(tasks: readonly Task[]): TaskPriority | null {
  const values = new Set(
    tasks.filter((task) => task.kind !== "note").map((task) => task.priority),
  );
  return values.size === 1 ? [...values][0]! : null;
}

function menuStyle(trigger: DOMRect, width: number): CSSProperties {
  const gap = 8;
  const inset = 12;
  const left = Math.min(
    Math.max(trigger.right - width, inset),
    Math.max(inset, window.innerWidth - width - inset),
  );
  const preferredTop = trigger.bottom + gap;
  const top = preferredTop + 280 <= window.innerHeight - inset
    ? preferredTop
    : Math.max(inset, trigger.top - 280 - gap);
  return { position: "fixed", left, top, width, zIndex: 1800 };
}

export function TaskMultiSelectPanel({
  tasks,
  bundle,
  online,
  now,
  dateTimePreferences,
  isTrashView,
  canEditTask,
  canOrganizeTask = canEditTask,
  canCompleteTask,
  onSaveSchedule,
  onSetPriority,
  onToggleLabel,
  onComplete,
  onDelete,
  onRestore,
  onPurge,
  onPin,
  onLinkParent,
  onMerge,
  onDuplicate,
  onConvertToNote,
  onCopyText,
  onClose,
}: {
  tasks: Task[];
  bundle: WorkspaceBundle;
  currentUserId: string;
  online: boolean;
  now: Date;
  dateTimePreferences: DateTimePreferences;
  aiWorkSettings: AiWorkSettings;
  isTrashView: boolean;
  canEditTask: (task: Task) => boolean;
  canOrganizeTask?: (task: Task) => boolean;
  canCompleteTask: (task: Task) => boolean;
  onSaveSchedule: (
    patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
    schedule: ReminderSchedule,
  ) => Promise<void>;
  onSetPriority: (priority: TaskPriority) => Promise<void>;
  onToggleLabel: (labelId: string, selected: boolean) => Promise<void>;
  onComplete: (completed: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
  onRestore: () => Promise<void>;
  onPurge: () => Promise<void>;
  onPin: () => Promise<void>;
  onLinkParent: (parentId: string) => Promise<void>;
  onMerge: () => Promise<void>;
  onDuplicate: () => Promise<void>;
  onConvertToNote: () => Promise<void>;
  onCopyText: () => Promise<void>;
  onClose: () => void;
}) {
  const [dateOpen, setDateOpen] = useState(false);
  const [dateAnchor, setDateAnchor] = useState<{ left: number; top: number } | null>(null);
  const [labelOpen, setLabelOpen] = useState(false);
  const [parentPickerOpen, setParentPickerOpen] = useState(false);
  const [parentAnchor, setParentAnchor] = useState<{ left: number; top: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const dateButtonRef = useRef<HTMLButtonElement>(null);
  const listButtonRef = useRef<HTMLButtonElement>(null);
  const tagButtonRef = useRef<HTMLButtonElement>(null);
  const linkButtonRef = useRef<HTMLButtonElement>(null);
  const labelMenuRef = useRef<HTMLDivElement>(null);
  const [labelMenuPosition, setLabelMenuPosition] = useState<CSSProperties>({});

  const editableTasks = useMemo(() => tasks.filter((task) => canEditTask(task)), [canEditTask, tasks]);
  const organizableTasks = useMemo(
    () => tasks.filter((task) => canOrganizeTask(task)),
    [canOrganizeTask, tasks],
  );
  const completableTasks = useMemo(
    () => tasks.filter((task) => task.kind !== "note" && canCompleteTask(task)),
    [canCompleteTask, tasks],
  );
  const todoTasks = useMemo(
    () => editableTasks.filter((task) => task.kind !== "note"),
    [editableTasks],
  );
  const writable = online && !busy;
  const canEditAny = writable && editableTasks.length > 0;
  const canOrganizeAny = writable && organizableTasks.length > 0;
  const canSchedule = canEditAny;
  const canSetPriority = writable && todoTasks.length > 0;
  const allCompleted = completableTasks.length > 0
    && completableTasks.every((task) => task.status === "completed");
  const canComplete = writable && completableTasks.length > 0;
  const canConvert = canEditAny && editableTasks.some((task) =>
    task.kind !== "note" && !task.parent_task_id);
  const canMerge = canEditAny && editableTasks.length >= 2;
  const labels = useMemo(
    () => orderedLabels(bundle.labels, bundle.userLabelOrder),
    [bundle.labels, bundle.userLabelOrder],
  );
  const currentPriority = sharedPriority(todoTasks);
  const dueFields = sharedDueFields(tasks);
  const dueLabel = dueFields?.due_at ? formatDueExact(dueFields) : "设置日期";
  const dueSet = Boolean(dueFields?.due_at);
  const sharedLabelIds = intersectLabelIds(tasks, bundle.labels);
  const sharedLabels = labels.filter((label) => sharedLabelIds.includes(label.id));
  const listLabel = sharedLabels[0] ?? null;
  const tagLabels = sharedLabels.slice(1);
  const inbox = allTasksUnlabeled(tasks, bundle.labels);
  const listText = listLabel?.name ?? (inbox ? "收集箱" : "清单");
  const tagText = tagLabels.length > 0 ? tagLabels.map((label) => label.name).join("、") : "标签";
  const priorityOption = currentPriority ? getPriorityOption(currentPriority) : null;
  const prioritySet = Boolean(priorityOption && priorityOption.value !== "none");
  const dueTarget = dueFields?.due_at
    ? { ...BULK_DUE_TARGET, ...dueFields }
    : BULK_DUE_TARGET;
  const selectedIdSet = useMemo(() => new Set(tasks.map((task) => task.id)), [tasks]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!shouldDismissTaskDetailOnPointerDown(event.target, event.button)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (dateOpen || labelOpen || parentPickerOpen) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [dateOpen, labelOpen, onClose, parentPickerOpen]);

  useEffect(() => {
    if (!labelOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (listButtonRef.current?.contains(target) || tagButtonRef.current?.contains(target)) return;
      if (labelMenuRef.current?.contains(target)) return;
      setLabelOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [labelOpen]);

  useLayoutEffect(() => {
    const trigger = listButtonRef.current ?? tagButtonRef.current;
    if (!labelOpen || !trigger) return;
    setLabelMenuPosition(menuStyle(trigger.getBoundingClientRect(), 220));
  }, [labelOpen]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  function openLabels(from: "list" | "tag") {
    const trigger = from === "list" ? listButtonRef.current : tagButtonRef.current;
    if (trigger) setLabelMenuPosition(menuStyle(trigger.getBoundingClientRect(), 220));
    setLabelOpen((value) => !value);
    setDateOpen(false);
    setParentPickerOpen(false);
  }

  return (
    <section
      className="task-detail task-detail-panel task-multi-select"
      aria-label={`已选择 ${tasks.length} 项`}
    >
      <header className="task-multi-select-header">
        <p className="task-multi-select-count">已选择 {tasks.length} 项</p>
        <button type="button" className="task-multi-select-cancel" onClick={onClose}>
          取消
        </button>
      </header>
      <div className="task-multi-select-body">
        {isTrashView ? null : (
          <div className="task-multi-select-fields">
            <button
              ref={dateButtonRef}
              type="button"
              className={clsx("task-multi-select-field", dueSet && "is-set")}
              disabled={!canSchedule}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                const rect = dateButtonRef.current?.getBoundingClientRect();
                setDateAnchor(rect ? { left: rect.left, top: rect.bottom + 8 } : null);
                setDateOpen((value) => !value);
                setLabelOpen(false);
                setParentPickerOpen(false);
              }}
            >
              <CalendarDays />
              <span>{dueLabel}</span>
            </button>
            <div
              className={clsx(
                "task-multi-select-field",
                "priority-field",
                prioritySet && "is-set",
                !canSetPriority && "disabled",
              )}
              style={prioritySet ? { color: priorityOption!.color } : undefined}
            >
              <Flag fill={prioritySet ? "currentColor" : "none"} />
              <span>{prioritySet ? priorityOption!.label : "优先级"}</span>
              <PriorityControl
                priority={currentPriority ?? "none"}
                online={canSetPriority}
                onChange={(priority) => run(() => onSetPriority(priority))}
              />
            </div>
            <button
              ref={listButtonRef}
              type="button"
              className={clsx("task-multi-select-field", listLabel && "is-set")}
              disabled={!canOrganizeAny}
              aria-haspopup="menu"
              aria-expanded={labelOpen}
              aria-label="清单"
              style={listLabel ? { color: listLabel.color } : undefined}
              onClick={() => openLabels("list")}
            >
              <List />
              <span>{listText}</span>
            </button>
            <button
              ref={tagButtonRef}
              type="button"
              className={clsx("task-multi-select-field", tagLabels.length > 0 && "is-set")}
              disabled={!canOrganizeAny}
              aria-haspopup="menu"
              aria-expanded={labelOpen}
              aria-label="标签"
              onClick={() => openLabels("tag")}
            >
              <Tag />
              <span>{tagText}</span>
            </button>
          </div>
        )}
        <div className="task-multi-select-actions">
          {isTrashView ? (
            <>
              <button
                type="button"
                className="task-multi-select-action restore"
                disabled={!canOrganizeAny}
                onClick={() => void run(onRestore)}
              >
                <RotateCcw />
                <span>恢复</span>
              </button>
              <button
                type="button"
                className="task-multi-select-action delete"
                disabled={!online || busy || tasks.length === 0}
                onClick={() => {
                  if (!window.confirm(`彻底删除已选择的 ${tasks.length} 项？此操作不可撤销。`)) return;
                  void run(onPurge);
                }}
              >
                <Trash2 />
                <span>彻底删除</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="task-multi-select-action complete"
                disabled={!canComplete}
                aria-label={allCompleted ? "取消完成" : "完成"}
                onClick={() => void run(() => onComplete(!allCompleted))}
              >
                <CheckSquare />
                <span>完成</span>
              </button>
              <TaskStatusMenuItems tasks={tasks} role="button" className="task-multi-select-action" />
              <button
                type="button"
                className="task-multi-select-action pin"
                disabled={!canEditAny}
                onClick={() => void run(onPin)}
              >
                <Pin fill="currentColor" />
                <span>置顶</span>
              </button>
              <button
                ref={linkButtonRef}
                type="button"
                className="task-multi-select-action link"
                disabled={!canEditAny}
                onClick={() => {
                  const rect = linkButtonRef.current?.getBoundingClientRect();
                  setParentAnchor(rect ? { left: rect.left, top: rect.bottom + 8 } : null);
                  setParentPickerOpen((value) => !value);
                  setDateOpen(false);
                  setLabelOpen(false);
                }}
              >
                <SquareStack />
                <span>关联主任务</span>
              </button>
              <button
                type="button"
                className="task-multi-select-action merge"
                disabled={!canMerge}
                onClick={() => void run(onMerge)}
              >
                <Merge />
                <span>合并</span>
              </button>
              <button
                type="button"
                className="task-multi-select-action duplicate"
                disabled={!canEditAny}
                onClick={() => void run(onDuplicate)}
              >
                <Copy />
                <span>创建副本</span>
              </button>
              <button
                type="button"
                className="task-multi-select-action convert"
                disabled={!canConvert}
                onClick={() => void run(onConvertToNote)}
              >
                <StickyNote />
                <span>转换为笔记</span>
              </button>
              <button
                type="button"
                className="task-multi-select-action copy"
                disabled={tasks.length === 0}
                onClick={() => void run(onCopyText)}
              >
                <Clipboard />
                <span>复制文本</span>
              </button>
              <button
                type="button"
                className="task-multi-select-action delete"
                disabled={!canOrganizeAny}
                aria-label="移至回收站"
                onClick={() => void run(onDelete)}
              >
                <Trash2 />
                <span>删除</span>
              </button>
            </>
          )}
        </div>
      </div>
      {dateOpen && (
        <DueDateControl
          task={dueTarget}
          online={canSchedule}
          now={now}
          preferences={dateTimePreferences}
          autoOpen
          showTrigger={false}
          allowRecurrence={false}
          anchorPoint={dateAnchor ?? undefined}
          onClose={() => setDateOpen(false)}
          onSave={async (patch, schedule) => {
            await onSaveSchedule(patch, schedule);
          }}
        />
      )}
      <FocusTaskPicker
        open={parentPickerOpen}
        tasks={bundle.tasks}
        selectedTaskId="bulk-link-parent"
        onOpenChange={setParentPickerOpen}
        anchorPoint={parentAnchor ?? undefined}
        onSelect={(taskId) => {
          if (!taskId || selectedIdSet.has(taskId)) {
            setParentPickerOpen(false);
            return;
          }
          setParentPickerOpen(false);
          void run(() => onLinkParent(taskId));
        }}
      />
      {labelOpen && createPortal(
        <div
          ref={labelMenuRef}
          className="task-label-menu task-multi-select-menu"
          role="menu"
          aria-label="批量设置标签"
          style={labelMenuPosition}
        >
          <LabelTreeMenuItems
            labels={bundle.labels}
            userLabelOrder={bundle.userLabelOrder}
            selectionFor={(label) => {
              const state = labelSelectionState(organizableTasks, label.id);
              return state === "all" ? true : state === "some" ? "mixed" : false;
            }}
            disabledFor={(label) => !writable
              || (bundle.labelPermissionLevels[label.id] ?? 0) < 2}
            onToggle={(label) => {
              const state = labelSelectionState(organizableTasks, label.id);
              void run(() => onToggleLabel(label.id, state !== "all"));
            }}
          />
          {labels.length === 0 && <p className="task-label-menu-empty">暂无可用标签</p>}
        </div>,
        document.body,
      )}
    </section>
  );
}
