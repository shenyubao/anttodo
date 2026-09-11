import * as Dialog from "@radix-ui/react-dialog";
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarDays,
  ChevronDown,
  Circle,
  Ellipsis,
  GripVertical,
  Menu,
  NotebookPen,
  Plus,
  RotateCcw,
  Settings2,
  Tag,
  UserRound,
  X,
} from "lucide-react";
import { useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { TaskStatusIcon } from "./TaskStatusIcon";
import { formatPreferenceDate } from "./lib/dateTimePreferences";
import { taskUserLabelIds, userLabels } from "./lib/labels";
import {
  MATRIX_QUADRANT_COLORS,
  MATRIX_QUADRANT_KEYS,
  defaultMatrixPreference,
  defaultTaskKindForMatrixRule,
  dueAtForMatrixBucket,
  groupMatrixTasks,
  resolveMatrixPreferences,
  resolveTaskForMatrixRule,
  taskMatchesMatrixRule,
} from "./lib/taskMatrix";
import type {
  DateTimePreferences,
  Label,
  MatrixDueBucket,
  MatrixGrouping,
  MatrixQuadrantKey,
  MatrixQuadrantPreference,
  MatrixRuleDefinition,
  MatrixSort,
  ReminderSchedule,
  Task,
  AssigneeTarget,
  TaskKind,
  TaskPriority,
  WorkspaceBundle,
} from "./types";

type CreateTaskInput = {
  title: string;
  labelIds: string[];
  dueAt?: string | null;
  dueTimezone?: string | null;
  priority?: TaskPriority;
  kind?: TaskKind;
  assigneeId?: string | null;
};

type MatrixWorkspaceProps = {
  workspaceId: string;
  currentUserId: string;
  bundle: WorkspaceBundle;
  online: boolean;
  now: Date;
  dateTimePreferences: DateTimePreferences;
  selectedTaskId: string | null;
  tasksHasMore: boolean;
  tasksLoadingMore: boolean;
  onMenu: () => void;
  onSelectTask: (taskId: string, anchor: DOMRect) => void;
  onCreateTask: (input: CreateTaskInput) => Promise<unknown>;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => Promise<void>;
  onSaveTaskSchedule: (
    taskId: string,
    patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
    schedule: ReminderSchedule,
  ) => Promise<void>;
  onToggleTaskLabel: (taskId: string, labelId: string, selected: boolean) => Promise<void>;
  onAssignTask: (taskId: string, target: AssigneeTarget) => Promise<void>;
  onSavePreference: (preference: MatrixQuadrantPreference) => Promise<void>;
  onLoadMoreTasks: () => Promise<void>;
  canEditTask: (task: Task) => boolean;
  onNotice: (message: string) => void;
};

const GROUP_OPTIONS: Array<{ value: MatrixGrouping; label: string }> = [
  { value: "due", label: "按时间分组" },
  { value: "label", label: "按标签分组" },
  { value: "priority", label: "按优先级分组" },
  { value: "none", label: "不分组" },
];

const SORT_OPTIONS: Array<{ value: MatrixSort; label: string }> = [
  { value: "due", label: "按时间排序" },
  { value: "title", label: "按标题排序" },
  { value: "priority", label: "按优先级排序" },
  { value: "created", label: "按创建时间排序" },
];

const DUE_OPTIONS: Array<{ value: MatrixDueBucket; label: string }> = [
  { value: "overdue", label: "已过期" },
  { value: "today", label: "今天" },
  { value: "tomorrow", label: "明天" },
  { value: "later", label: "更远" },
  { value: "none", label: "无日期" },
];

const PRIORITY_OPTIONS: Array<{ value: TaskPriority; label: string }> = [
  { value: "high", label: "高" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" },
  { value: "none", label: "无" },
];

function taskSchedule(task: Task): ReminderSchedule {
  return {
    reminders: task.reminders.map((reminder) => ({
      anchor: reminder.anchor,
      offset_value: reminder.offset_value,
      offset_unit: reminder.offset_unit,
      local_time: reminder.local_time,
    })),
    persistent: task.reminder_persistent,
    recurrence: task.recurrence,
  };
}

function createdTaskId(value: unknown) {
  return value && typeof value === "object" && "id" in value
    ? String((value as { id: unknown }).id)
    : null;
}

function QuadrantRuleDialog({
  open,
  preference,
  labels,
  members,
  currentUserId,
  online,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  preference: MatrixQuadrantPreference;
  labels: Label[];
  members: WorkspaceBundle["members"];
  currentUserId: string;
  online: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (preference: MatrixQuadrantPreference) => Promise<void>;
}) {
  const [draft, setDraft] = useState(preference);
  const [saving, setSaving] = useState(false);

  const updateRule = (patch: Partial<MatrixRuleDefinition>) => {
    setDraft((current) => ({
      ...current,
      definition: { ...current.definition, ...patch },
    }));
  };

  const toggleRuleValue = <T extends string>(
    key: "due" | "priorities" | "kinds",
    value: T,
  ) => {
    const current = draft.definition[key] as "all" | T[];
    const selected = current === "all" ? [] : current;
    const next = selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value];
    updateRule({ [key]: next.length ? next : "all" });
  };

  const toggleLabel = (labelId: string) => {
    const current = draft.definition.labels === "all" ? [] : draft.definition.labels;
    const next = current.includes(labelId)
      ? current.filter((item) => item !== labelId)
      : [...current, labelId];
    updateRule({ labels: next.length ? next : "all" });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!online || !draft.name.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({ ...draft, name: draft.name.trim() });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="matrix-rule-overlay" />
        <Dialog.Content className="matrix-rule-dialog" aria-describedby={undefined}>
          <form onSubmit={submit}>
            <div className="matrix-rule-titlebar">
              <Dialog.Title>编辑象限</Dialog.Title>
              <Dialog.Close className="icon-button" aria-label="关闭"><X size={18} /></Dialog.Close>
            </div>
            <div className="matrix-rule-body">
              <label className="matrix-rule-name">
                <span>名称</span>
                <input
                  value={draft.name}
                  maxLength={80}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                />
              </label>
              <RuleRow icon={<Tag size={16} />} label="标签">
                <button type="button" className={clsx(draft.definition.labels === "all" && "active")} onClick={() => updateRule({ labels: "all" })}>全部</button>
                <button type="button" className={clsx(draft.definition.labels !== "all" && draft.definition.labels.includes("inbox") && "active")} onClick={() => toggleLabel("inbox")}>收集箱</button>
                {labels.map((label) => (
                  <button
                    type="button"
                    key={label.id}
                    className={clsx(draft.definition.labels !== "all" && draft.definition.labels.includes(label.id) && "active")}
                    onClick={() => toggleLabel(label.id)}
                  >{label.name}</button>
                ))}
              </RuleRow>
              <RuleRow icon={<CalendarDays size={16} />} label="日期">
                <button type="button" className={clsx(draft.definition.due === "all" && "active")} onClick={() => updateRule({ due: "all" })}>全部</button>
                {DUE_OPTIONS.map((option) => (
                  <button type="button" key={option.value} className={clsx(draft.definition.due !== "all" && draft.definition.due.includes(option.value) && "active")} onClick={() => toggleRuleValue("due", option.value)}>{option.label}</button>
                ))}
              </RuleRow>
              <RuleRow icon={<Circle size={16} />} label="优先级">
                <button type="button" className={clsx(draft.definition.priorities === "all" && "active")} onClick={() => updateRule({ priorities: "all" })}>全部</button>
                {PRIORITY_OPTIONS.map((option) => (
                  <button type="button" key={option.value} className={clsx(draft.definition.priorities !== "all" && draft.definition.priorities.includes(option.value) && "active")} onClick={() => toggleRuleValue("priorities", option.value)}>{option.label}</button>
                ))}
              </RuleRow>
              <RuleRow icon={<NotebookPen size={16} />} label="类型">
                <button type="button" className={clsx(draft.definition.kinds === "all" && "active")} onClick={() => updateRule({ kinds: "all" })}>全部</button>
                <button type="button" className={clsx(draft.definition.kinds !== "all" && draft.definition.kinds.includes("todo") && "active")} onClick={() => toggleRuleValue("kinds", "todo")}>任务</button>
                <button type="button" className={clsx(draft.definition.kinds !== "all" && draft.definition.kinds.includes("note") && "active")} onClick={() => toggleRuleValue("kinds", "note")}>笔记</button>
              </RuleRow>
              <RuleRow icon={<UserRound size={16} />} label="指派用户">
                <button
                  type="button"
                  aria-pressed={draft.definition.assignee === "all"}
                  className={clsx(draft.definition.assignee === "all" && "active")}
                  onClick={() => updateRule({ assignee: "all" })}
                >不限</button>
                <button
                  type="button"
                  aria-pressed={draft.definition.assignee === currentUserId}
                  className={clsx(draft.definition.assignee === currentUserId && "active")}
                  onClick={() => updateRule({ assignee: currentUserId })}
                >我</button>
                {members.filter((member) => member.user_id !== currentUserId).map((member) => (
                  <button
                    type="button"
                    key={member.user_id}
                    aria-pressed={draft.definition.assignee === member.user_id}
                    className={clsx(draft.definition.assignee === member.user_id && "active")}
                    onClick={() => updateRule({ assignee: member.user_id })}
                  >{member.profile?.display_name?.trim() || "团队成员"}</button>
                ))}
              </RuleRow>
            </div>
            <div className="matrix-rule-actions">
              <button type="button" className="matrix-rule-reset" disabled={!online || saving} onClick={() => setDraft(defaultMatrixPreference(preference.quadrant_key, preference.user_id, preference.workspace_id))}>
                <RotateCcw size={15} />恢复默认
              </button>
              <span />
              <Dialog.Close className="secondary-button" type="button">取消</Dialog.Close>
              <button className="primary-button" disabled={!online || saving || !draft.name.trim()}>{saving ? "保存中…" : "保存"}</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RuleRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="matrix-rule-row">
      <div className="matrix-rule-row-label">{icon}<span>{label}</span></div>
      <div className="matrix-rule-options">{children}</div>
    </div>
  );
}

function MatrixTaskRow({
  task,
  quadrantKey,
  selected,
  online,
  editable,
  labels,
  bundle,
  now,
  dateTimePreferences,
  onSelect,
  onToggle,
}: {
  task: Task;
  quadrantKey: MatrixQuadrantKey;
  selected: boolean;
  online: boolean;
  editable: boolean;
  labels: Label[];
  bundle: WorkspaceBundle;
  now: Date;
  dateTimePreferences: DateTimePreferences;
  onSelect: (rect: DOMRect) => void;
  onToggle: () => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `matrix-task:${task.id}:${quadrantKey}`,
    data: { taskId: task.id, quadrantKey },
    disabled: !online || !editable,
  });
  const taskLabels = userLabels(labels).filter((label) => task.label_ids.includes(label.id)).slice(0, 2);
  const member = bundle.members.find((item) => item.user_id === task.assignee_id);
  const due = task.due_at ? formatPreferenceDate(task.due_at, dateTimePreferences, task.due_timezone) : null;
  const overdue = task.status === "open" && task.due_at && new Date(task.due_at).getTime() < now.getTime();
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={clsx("matrix-task-row", selected && "selected", task.status !== "open" && "completed", isDragging && "dragging")}
      onClick={(event) => onSelect(event.currentTarget.getBoundingClientRect())}
    >
      <button
        type="button"
        className="matrix-task-grip"
        aria-label="拖动任务"
        disabled={!online || !editable}
        onClick={(event) => event.stopPropagation()}
        {...listeners}
        {...attributes}
      ><GripVertical size={14} /></button>
      {task.kind === "note" ? (
        <span className="matrix-note-icon"><NotebookPen size={15} /></span>
      ) : (
        <button
          type="button"
          className="matrix-task-status"
          aria-label={task.status === "open" ? "完成任务" : "恢复任务"}
          disabled={!online || !editable}
          onClick={(event) => { event.stopPropagation(); void onToggle(); }}
        ><TaskStatusIcon status={task.status} /></button>
      )}
      <span className="matrix-task-title">{task.title}</span>
      <span className="matrix-task-meta">
        {taskLabels.map((label) => <span className="matrix-task-label" key={label.id} style={{ "--matrix-label-color": label.color } as CSSProperties}>{label.name}</span>)}
        {due && <span className={clsx("matrix-task-due", overdue && "overdue")}>{due}</span>}
        {task.recurrence && <span className="matrix-task-recurrence">↻</span>}
        {member && <span className="matrix-task-assignee" title={member.profile?.display_name ?? "负责人"}>{(member.profile?.display_name ?? "?").slice(0, 1)}</span>}
      </span>
    </div>
  );
}

function MatrixQuadrant({
  preference,
  tasks,
  props,
  menuOpen,
  onMenuOpen,
  onEditRule,
}: {
  preference: MatrixQuadrantPreference;
  tasks: Task[];
  props: MatrixWorkspaceProps;
  menuOpen: boolean;
  onMenuOpen: (open: boolean) => void;
  onEditRule: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `matrix-quadrant:${preference.quadrant_key}`,
    data: { quadrantKey: preference.quadrant_key },
    disabled: !props.online,
  });
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => groupMatrixTasks(
    tasks,
    preference.grouping,
    preference.sort,
    preference.direction,
    props.bundle.labels,
    props.now,
  ), [tasks, preference, props.bundle.labels, props.now]);
  const editableLabelIds = useMemo(() => new Set(Object.entries(props.bundle.labelPermissionLevels)
    .filter(([, level]) => level === 2).map(([id]) => id)), [props.bundle.labelPermissionLevels]);
  const assignableUserIds = useMemo(
    () => new Set(props.bundle.members.map((member) => member.user_id)),
    [props.bundle.members],
  );
  const quickDraft = useMemo(() => resolveTaskForMatrixRule({
    kind: defaultTaskKindForMatrixRule(preference.definition),
    priority: "low",
    due_at: null,
    due_timezone: null,
    label_ids: [],
    assignee_id: null,
  }, preference.definition, props.now, editableLabelIds, assignableUserIds, props.bundle.labels), [assignableUserIds, editableLabelIds, preference.definition, props.bundle.labels, props.now]);
  const quickDisabledReason = "error" in quickDraft ? quickDraft.error : null;

  const savePresentation = (patch: Partial<Pick<MatrixQuadrantPreference, "grouping" | "sort" | "direction">>) => {
    if (!props.online) return;
    void props.onSavePreference({ ...preference, ...patch }).catch((cause) => {
      props.onNotice(cause instanceof Error ? cause.message : "象限设置保存失败");
    });
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || !props.online || busy || "error" in quickDraft) return;
    setBusy(true);
    try {
      const { resolution } = quickDraft;
      const dueAt = resolution.dueBucket
        ? dueAtForMatrixBucket(resolution.dueBucket, props.now)
        : null;
      const created = await props.onCreateTask({
        title: trimmed,
        labelIds: resolution.addLabelId ? [resolution.addLabelId] : [],
        dueAt,
        dueTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        priority: resolution.priority ?? "low",
        kind: defaultTaskKindForMatrixRule(preference.definition),
        assigneeId: resolution.assigneeId ?? null,
      });
      const taskId = createdTaskId(created);
      if (taskId && resolution.dueBucket) {
        await props.onSaveTaskSchedule(taskId, {
          due_at: dueAt,
          due_start_at: null,
          due_is_all_day: true,
          due_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }, { reminders: [], persistent: false, recurrence: null });
      }
      setTitle("");
      setCreating(false);
    } catch (cause) {
      props.onNotice(cause instanceof Error ? cause.message : "创建任务失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article ref={setNodeRef} className={clsx("matrix-quadrant", isOver && "drop-target")} style={{ "--quadrant-color": MATRIX_QUADRANT_COLORS[preference.quadrant_key] } as CSSProperties}>
      <header className="matrix-quadrant-header">
        <span className="matrix-quadrant-dot" />
        <h2>{preference.name}</h2>
        <span className="matrix-quadrant-count">{tasks.length}</span>
        <div className="matrix-quadrant-actions">
          <button
            className="icon-button"
            type="button"
            aria-label={`在${preference.name}新增任务`}
            title={quickDisabledReason ?? undefined}
            disabled={!props.online || Boolean(quickDisabledReason)}
            onClick={() => setCreating((value) => !value)}
          ><Plus size={17} /></button>
          <button className="icon-button" type="button" aria-label={`${preference.name}菜单`} onClick={() => onMenuOpen(!menuOpen)}><Ellipsis size={18} /></button>
          {menuOpen && (
            <div className="matrix-quadrant-menu" onClick={(event) => event.stopPropagation()}>
              <button type="button" disabled={!props.online} onClick={() => { onMenuOpen(false); onEditRule(); }}><Settings2 size={15} />编辑规则</button>
              <label><span>分组</span><select value={preference.grouping} disabled={!props.online} onChange={(event) => savePresentation({ grouping: event.target.value as MatrixGrouping })}>{GROUP_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><ChevronDown size={13} /></label>
              <label><span>排序</span><select value={preference.sort} disabled={!props.online} onChange={(event) => savePresentation({ sort: event.target.value as MatrixSort })}>{SORT_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><ChevronDown size={13} /></label>
              <button type="button" disabled={!props.online} onClick={() => savePresentation({ direction: preference.direction === "asc" ? "desc" : "asc" })}>
                {preference.direction === "asc" ? <ArrowUpAZ size={15} /> : <ArrowDownAZ size={15} />}
                {preference.direction === "asc" ? "升序" : "降序"}
              </button>
            </div>
          )}
        </div>
      </header>
      <div className="matrix-quadrant-scroll">
        {creating && (
          <form className="matrix-quick-create" onSubmit={create}>
            <Circle size={16} />
            <input autoFocus value={title} placeholder="添加任务" disabled={busy} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setCreating(false); }} />
            <button type="submit" disabled={!title.trim() || busy}>{busy ? "…" : "添加"}</button>
          </form>
        )}
        {groups.length === 0 && !creating ? <div className="matrix-empty">暂无任务</div> : groups.map((group) => (
          <section className="matrix-task-group" key={group.id}>
            {group.title && <h3>{group.title}<span>{group.tasks.length}</span></h3>}
            {group.tasks.map((task) => (
              <MatrixTaskRow
                key={task.id}
                task={task}
                quadrantKey={preference.quadrant_key}
                selected={props.selectedTaskId === task.id}
                online={props.online}
                editable={props.canEditTask(task)}
                labels={props.bundle.labels}
                bundle={props.bundle}
                now={props.now}
                dateTimePreferences={props.dateTimePreferences}
                onSelect={(anchor) => props.onSelectTask(task.id, anchor)}
                onToggle={async () => props.onUpdateTask(task.id, task.status === "open"
                  ? { status: "completed", completed_at: new Date().toISOString() }
                  : { status: "open", completed_at: null })}
              />
            ))}
          </section>
        ))}
        {props.tasksHasMore && (
          <button className="matrix-load-more" type="button" disabled={props.tasksLoadingMore} onClick={() => void props.onLoadMoreTasks()}>{props.tasksLoadingMore ? "加载中…" : "查看更多"}</button>
        )}
      </div>
    </article>
  );
}

export function MatrixWorkspace(props: MatrixWorkspaceProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const preferences = useMemo(() => resolveMatrixPreferences(
    props.bundle.matrixQuadrantPreferences,
    props.currentUserId,
    props.workspaceId,
  ), [props.bundle.matrixQuadrantPreferences, props.currentUserId, props.workspaceId]);
  const tasksByQuadrant = useMemo(() => Object.fromEntries(preferences.map((preference) => [
    preference.quadrant_key,
    props.bundle.tasks.filter((task) =>
      taskMatchesMatrixRule(task, preference.definition, props.now, props.bundle.labels)),
  ])) as Record<MatrixQuadrantKey, Task[]>, [preferences, props.bundle.tasks, props.now]);
  const editableLabelIds = useMemo(() => new Set(Object.entries(props.bundle.labelPermissionLevels)
    .filter(([, level]) => level === 2).map(([id]) => id)), [props.bundle.labelPermissionLevels]);
  const assignableUserIds = useMemo(
    () => new Set(props.bundle.members.map((member) => member.user_id)),
    [props.bundle.members],
  );
  const [openMenu, setOpenMenu] = useState<MatrixQuadrantKey | null>(null);
  const [editing, setEditing] = useState<MatrixQuadrantPreference | null>(null);

  const moveTask = async (event: DragEndEvent) => {
    if (!event.over || !props.online) return;
    const taskId = event.active.data.current?.taskId as string | undefined;
    const sourceKey = event.active.data.current?.quadrantKey as MatrixQuadrantKey | undefined;
    const targetKey = event.over.data.current?.quadrantKey as MatrixQuadrantKey | undefined;
    if (!taskId || !sourceKey || !targetKey || sourceKey === targetKey) return;
    const task = props.bundle.tasks.find((item) => item.id === taskId);
    const target = preferences.find((item) => item.quadrant_key === targetKey);
    if (!task || !target || !props.canEditTask(task)) {
      props.onNotice("没有修改此任务的权限");
      return;
    }
    const result = resolveTaskForMatrixRule(
      task,
      target.definition,
      props.now,
      editableLabelIds,
      assignableUserIds,
      props.bundle.labels,
    );
    if ("error" in result) {
      props.onNotice(result.error);
      return;
    }
    const { resolution } = result;
    const userLabelIds = taskUserLabelIds(task.label_ids, props.bundle.labels);
    if (resolution.clearLabels) {
      const lockedLabel = userLabelIds.find((labelId) => !editableLabelIds.has(labelId));
      if (lockedLabel) {
        props.onNotice("现有标签中包含无权移除的标签");
        return;
      }
    }
    let priorityChanged = false;
    let scheduleChanged = false;
    let labelsChanged = false;
    let assigneeChanged = false;
    try {
      if (resolution.priority) {
        await props.onUpdateTask(task.id, { priority: resolution.priority });
        priorityChanged = true;
      }
      if (resolution.dueBucket) {
        const dueAt = dueAtForMatrixBucket(resolution.dueBucket, props.now);
        await props.onSaveTaskSchedule(task.id, {
          due_at: dueAt,
          due_start_at: null,
          due_is_all_day: dueAt !== null,
          due_timezone: dueAt ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
        }, taskSchedule(task));
        scheduleChanged = true;
      }
      if (resolution.clearLabels) {
        await Promise.all(userLabelIds.map((labelId) => props.onToggleTaskLabel(task.id, labelId, false)));
        labelsChanged = true;
      }
      if (resolution.addLabelId) {
        await props.onToggleTaskLabel(task.id, resolution.addLabelId, true);
        labelsChanged = true;
      }
      if (resolution.assigneeId) {
        await props.onAssignTask(task.id, { kind: "user", userId: resolution.assigneeId });
        assigneeChanged = true;
      }
    } catch (cause) {
      if (assigneeChanged) {
        const previousAssignee: AssigneeTarget = task.cli_assignee
          ? { kind: "cli", tool: task.cli_assignee }
          : task.assignee_id
            ? { kind: "user", userId: task.assignee_id }
            : { kind: "none" };
        await props.onAssignTask(task.id, previousAssignee).catch(() => undefined);
      }
      if (labelsChanged || resolution.clearLabels || resolution.addLabelId) {
        await Promise.allSettled([
          ...task.label_ids.map((labelId) => props.onToggleTaskLabel(task.id, labelId, true)),
          ...(resolution.addLabelId && !task.label_ids.includes(resolution.addLabelId)
            ? [props.onToggleTaskLabel(task.id, resolution.addLabelId, false)]
            : []),
        ]);
      }
      if (scheduleChanged) {
        await props.onSaveTaskSchedule(task.id, {
          due_at: task.due_at,
          due_start_at: task.due_start_at,
          due_is_all_day: task.due_is_all_day,
          due_timezone: task.due_timezone,
        }, taskSchedule(task)).catch(() => undefined);
      }
      if (priorityChanged) {
        await props.onUpdateTask(task.id, { priority: task.priority }).catch(() => undefined);
      }
      props.onNotice(cause instanceof Error ? `移动失败：${cause.message}` : "移动失败，已重新同步任务");
    }
  };

  return (
    <div className="matrix-workspace">
      <header className="matrix-workspace-header">
        <button className="matrix-mobile-menu icon-button" type="button" aria-label="打开导航" onClick={props.onMenu}><Menu size={20} /></button>
        <h1>四象限</h1>
        {!props.online && <span className="matrix-offline">离线只读</span>}
      </header>
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={(event) => void moveTask(event)}>
        <div className="matrix-grid">
          {MATRIX_QUADRANT_KEYS.map((key) => {
            const preference = preferences.find((item) => item.quadrant_key === key)!;
            return (
              <MatrixQuadrant
                key={key}
                preference={preference}
                tasks={tasksByQuadrant[key]}
                props={props}
                menuOpen={openMenu === key}
                onMenuOpen={(open) => setOpenMenu(open ? key : null)}
                onEditRule={() => setEditing(preference)}
              />
            );
          })}
        </div>
      </DndContext>
      {editing && (
        <QuadrantRuleDialog
          key={`${editing.quadrant_key}:${editing.updated_at ?? "default"}`}
          open
          preference={editing}
          labels={props.bundle.labels.filter((label) => props.bundle.labelPermissionLevels[label.id] === 2)}
          members={props.bundle.members}
          currentUserId={props.currentUserId}
          online={props.online}
          onOpenChange={(open) => { if (!open) setEditing(null); }}
          onSave={props.onSavePreference}
        />
      )}
    </div>
  );
}
