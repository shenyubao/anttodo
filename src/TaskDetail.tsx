import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  Clock,
  Ellipsis,
  History,
  Inbox,
  ListTodo,
  MessageCircle,
  NotebookPen,
  RotateCcw,
  Sparkles,
  SquareTerminal,
  Trash2,
  Type,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { DueDateControl } from "./DueDateControl";
import { AiCliAvatar } from "./AiCliAvatar";
import { MemberAvatar } from "./MemberAvatar";
import { getPriorityOption, PriorityControl } from "./PriorityControl";
import { TaskComments, type CreateCommentInput } from "./TaskComments";
import { TaskActivity } from "./TaskActivity";
import { TaskCliTerminal } from "./TaskCliTerminal";
import { FLUSH_PENDING_EDITS_EVENT } from "./ShortcutProvider";
import {
  TaskRichTextEditor,
  type TaskRichTextEditorHandle,
} from "./TaskRichTextEditor";
import type { AttachmentService } from "./lib/attachments";
import {
  buildFormattedDescription,
  buildSubtaskExtrasFromSuggestion,
  formatAiSuggestedDueAt,
  isMidnightLocalDueAt,
  type AiFormatSuggestion,
  type AiSuggestedSubtask,
} from "./lib/aiSubtaskDecompose";
import { decomposeSubtasks, formatTaskWithAi } from "./lib/api";
import { systemTimeZone } from "./lib/dateTimePreferences";
import { supabase } from "./lib/supabase";
import { getAssignableMembers } from "./lib/taskAssignment";
import { orderedLabels as orderedLabelsTree } from "./lib/taskList";
import { TaskTitleTokenMenu } from "./TaskTitleTokenMenu";
import { useTaskTitleTokens } from "./useTaskTitleTokens";
import {
  aiCliLabel,
  buildSubtaskCliPrompt,
  buildTaskCliPrompt,
  isAiWorkConfigured,
  requestAiWorkSettings,
  sameAssignee,
  subtaskAssigneeTarget,
  subtaskTerminalSessionKey,
  taskAssigneeTarget,
  taskTerminalSessionKey,
} from "./lib/aiWork";
import { trackAiTerminalSession, untrackAiTerminalSession } from "./lib/aiTerminalSessions";
import {
  formatHoursDetail,
  formatHoursValue,
  normalizeHoursInput,
} from "./lib/taskHours";
import type {
  AiCliTool,
  AiWorkSettings,
  AssigneeTarget,
  DateTimePreferences,
  Member,
  ReminderSchedule,
  Subtask,
  Task,
  TaskActivityPage,
  TaskComment,
  WorkspaceBundle,
} from "./types";

const DETAIL_SUBTASKS_VISIBLE_KEY = "anttodo:detail-subtasks-visible";

function readDetailSubtasksVisible() {
  try {
    return window.localStorage.getItem(DETAIL_SUBTASKS_VISIBLE_KEY) !== "0";
  } catch {
    return true;
  }
}

function storeDetailSubtasksVisible(visible: boolean) {
  try {
    window.localStorage.setItem(DETAIL_SUBTASKS_VISIBLE_KEY, visible ? "1" : "0");
  } catch {
    // A disabled or full local storage should not block detail interaction.
  }
}

export type TaskDetailProps = {
  task: Task;
  bundle: WorkspaceBundle;
  currentUserId: string;
  online: boolean;
  editable: boolean;
  attachmentService: AttachmentService;
  now: Date;
  dateTimePreferences: DateTimePreferences;
  aiWorkSettings: AiWorkSettings;
  settingsLabelName?: string | null;
  onClose: () => void;
  onUpdate: (patch: Partial<Task>) => Promise<void>;
  onSaveSchedule: (
    patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
    schedule: ReminderSchedule,
  ) => Promise<void>;
  onAssign: (target: AssigneeTarget) => Promise<void>;
  onAssignSubtask: (subtaskId: string, target: AssigneeTarget) => Promise<void>;
  onToggleLabel: (taskId: string, labelId: string, selected: boolean) => Promise<void>;
  onToggleParticipant: (taskId: string, userId: string, selected: boolean) => Promise<void>;
  onCreateSubtask: (
    title: string,
    extras?: Partial<Pick<Subtask, "due_at" | "assignee_id" | "cli_assignee">>,
  ) => Promise<void>;
  onToggleSubtask: (subtaskId: string, completed: boolean) => Promise<void>;
  onUpdateSubtask: (
    subtaskId: string,
    patch: Partial<Pick<Subtask, "due_at" | "title" | "description" | "estimate_hours" | "actual_hours">>,
  ) => Promise<void>;
  focusedSubtaskId?: string | null;
  onClearFocusedSubtask?: () => void;
  onDeleteSubtask: (subtaskId: string) => Promise<void>;
  commentsRevision: number;
  activityRevision: number;
  onLoadActivity: (cursor?: TaskActivityPage["nextCursor"]) => Promise<TaskActivityPage>;
  onLoadComments: (scope?: { subtaskId?: string | null }) => Promise<TaskComment[]>;
  onLoadCommentCandidates: () => Promise<string[]>;
  onCreateComment: (
    input: CreateCommentInput,
    scope?: { subtaskId?: string | null },
  ) => Promise<void>;
  onUpdateComment: (comment: TaskComment, input: CreateCommentInput) => Promise<void>;
  onDeleteComment: (comment: TaskComment) => Promise<void>;
};

function TaskAssigneeControl({
  task,
  bundle,
  currentUserId,
  aiWorkSettings,
  online,
  onAssign,
  target = taskAssigneeTarget(task),
  compact = false,
}: {
  task: Task;
  bundle: WorkspaceBundle;
  currentUserId: string;
  aiWorkSettings: AiWorkSettings;
  online: boolean;
  onAssign: (target: AssigneeTarget) => Promise<void>;
  target?: AssigneeTarget;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const assignee = target.kind === "user"
    ? bundle.members.find((member) => member.user_id === target.userId)
    : undefined;
  const cliTools = window.anttodoDesktop?.aiWork ? aiWorkSettings.cli_tools : [];
  // Local member cache filtered by the task's current label ACLs / groups.
  const candidates = useMemo(
    () => getAssignableMembers(bundle, task, currentUserId),
    [bundle, currentUserId, task],
  );

  useEffect(() => {
    setOpen(false);
    setError("");
  }, [task.id]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  async function choose(nextTarget: AssigneeTarget) {
    if (saving || !online) return;
    if (sameAssignee(target, nextTarget)) {
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onAssign(nextTarget);
      setOpen(false);
      triggerRef.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "负责人保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  function moveMenuFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]:not(:disabled)',
      ),
    );
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : items.length - 1
      : (currentIndex + direction + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  const assigneeName = target.kind === "cli"
    ? aiCliLabel(target.tool)
    : assignee?.profile?.display_name ?? "未指派";
  return (
    <div className={clsx("task-assignee-control", compact && "subtask-assignee-control")} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={clsx("task-assignee-trigger", open && "active")}
        aria-label={`负责人：${assigneeName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!online || saving}
        onClick={() => setOpen((value) => !value)}
      >
        {target.kind === "cli" ? (
          <AiCliAvatar tool={target.tool} className="detail-assignee-avatar" />
        ) : assignee ? (
          <MemberAvatar member={assignee} className="detail-assignee-avatar" />
        ) : (
          <UserRound />
        )}
      </button>
      {open && (
        <div
          className="task-assignee-menu"
          role="menu"
          aria-label="选择负责人"
          onKeyDown={moveMenuFocus}
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={target.kind === "none"}
            disabled={saving}
            onClick={() => void choose({ kind: "none" })}
          >
            <UserRound className="assignee-none-icon" />
            <span>不指派</span>
            <Check className="assignee-selected-icon" />
          </button>
          {cliTools.map((tool) => (
            <button
              key={tool}
              type="button"
              role="menuitemradio"
              aria-checked={target.kind === "cli" && target.tool === tool}
              disabled={saving}
              onClick={() => void choose({ kind: "cli", tool })}
            >
              <AiCliAvatar tool={tool} className="assignee-menu-avatar" />
              <span>{aiCliLabel(tool)}</span>
              <Check className="assignee-selected-icon" />
            </button>
          ))}
          {cliTools.length > 0 && <div className="task-assignee-divider" aria-hidden="true" />}
          {candidates.map((member) => (
            <button
              key={member.user_id}
              type="button"
              role="menuitemradio"
              aria-checked={target.kind === "user" && target.userId === member.user_id}
              disabled={saving}
              onClick={() => void choose({ kind: "user", userId: member.user_id })}
            >
              <MemberAvatar member={member} className="assignee-menu-avatar" />
              <span>{member.user_id === currentUserId ? "我" : member.profile?.display_name ?? "团队成员"}</span>
              <Check className="assignee-selected-icon" />
            </button>
          ))}
          {candidates.length === 0 && (
            <p className="task-assignee-status">暂无可指派成员</p>
          )}
          {error && <p className="task-assignee-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

function TaskParticipantsControl({
  task,
  bundle,
  currentUserId,
  online,
  onToggleParticipant,
}: {
  task: Task;
  bundle: WorkspaceBundle;
  currentUserId: string;
  online: boolean;
  onToggleParticipant: (taskId: string, userId: string, selected: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draftParticipantIds, setDraftParticipantIds] = useState(
    () => new Set(task.participant_ids),
  );
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setDraftParticipantIds(new Set(task.participant_ids));
  }, [task.id, task.participant_ids]);

  useEffect(() => {
    setOpen(false);
    setError("");
  }, [task.id]);

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

  const candidates = useMemo(
    () => getAssignableMembers(bundle, task, currentUserId),
    [bundle, currentUserId, task],
  );

  const menuMembers = useMemo(() => {
    const selected = candidates.filter((member) => draftParticipantIds.has(member.user_id));
    const unselected = candidates.filter((member) => !draftParticipantIds.has(member.user_id));
    const selectedMissing = [...draftParticipantIds]
      .filter((userId) => !candidates.some((member) => member.user_id === userId))
      .map((userId) => bundle.members.find((member) => member.user_id === userId))
      .filter((member): member is NonNullable<typeof member> => Boolean(member));
    return [...selected, ...selectedMissing, ...unselected];
  }, [bundle.members, candidates, draftParticipantIds]);

  async function toggle(userId: string) {
    if (!online || savingUserId) return;
    const previous = new Set(draftParticipantIds);
    const selected = !previous.has(userId);
    const next = new Set(previous);
    if (selected) next.add(userId);
    else next.delete(userId);
    setDraftParticipantIds(next);
    setSavingUserId(userId);
    setError("");
    try {
      await onToggleParticipant(task.id, userId, selected);
    } catch (cause) {
      setDraftParticipantIds(previous);
      setError(cause instanceof Error ? cause.message : "参与者保存失败，请重试");
    } finally {
      setSavingUserId(null);
    }
  }

  const participantCount = draftParticipantIds.size;

  return (
    <div className="task-participants-control" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={clsx(
          "detail-participants-trigger",
          open && "active",
          participantCount > 0 && "has-participants",
        )}
        title="参与者"
        aria-label={participantCount > 0 ? `参与者：${participantCount} 人` : "参与者"}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!online}
        onClick={() => {
          setOpen((value) => !value);
          setError("");
        }}
      >
        <UsersRound />
        {participantCount > 0 && (
          <span className="detail-participants-count">{participantCount}</span>
        )}
      </button>
      {open && (
        <div className="task-participants-menu" role="menu" aria-label="管理参与者">
          {menuMembers.map((member) => {
            const selected = draftParticipantIds.has(member.user_id);
            return (
              <button
                key={member.user_id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={selected}
                disabled={Boolean(savingUserId)}
                onClick={() => void toggle(member.user_id)}
              >
                <MemberAvatar member={member} className="participants-menu-avatar" />
                <span>
                  {member.user_id === currentUserId
                    ? "我"
                    : member.profile?.display_name ?? "团队成员"}
                </span>
                {selected && <Check className="participants-selected-icon" />}
              </button>
            );
          })}
          {menuMembers.length === 0 && (
            <p className="task-participants-status">暂无可选成员</p>
          )}
          {error && <p className="task-participants-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

function SubtaskDueDateControl({
  dueAt,
  completed = false,
  online,
  onSave,
}: {
  dueAt: string | null;
  completed?: boolean;
  online: boolean;
  onSave: (dueAt: string | null) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const initial = dueAt ? new Date(dueAt) : new Date();
    const offset = initial.getTimezoneOffset() * 60_000;
    setDate(new Date(initial.getTime() - offset).toISOString().slice(0, 10));
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
      triggerRef.current?.focus();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, dueAt]);

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
    window.addEventListener("scroll", positionPopover, true);
    return () => {
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
    };
  }, [open, date]);

  const dueDate = dueAt ? new Date(dueAt) : null;
  const formatted = dueDate
    ? `${dueDate.getMonth() + 1}月${dueDate.getDate()}日`
    : "";
  const overdue = Boolean(
    dueAt
    && !completed
    && new Date(dueAt).getTime() < Date.now(),
  );

  async function save(value: string | null) {
    setSaving(true);
    try {
      const nextDueAt = value
        ? new Date(`${value}T23:59:59.999`).toISOString()
        : null;
      await onSave(nextDueAt);
      setOpen(false);
      triggerRef.current?.focus();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="subtask-date-control" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={clsx("subtask-date-trigger", dueAt && "has-date", overdue && "overdue")}
        aria-label={dueAt ? `截止时间：${formatted}` : "设置子任务截止时间"}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!online || saving}
        onClick={() => setOpen((value) => !value)}
      >
        <CalendarDays />
        {formatted && <span>{formatted}</span>}
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          className="subtask-date-popover"
          role="dialog"
          aria-label="设置子任务截止时间"
          style={position}
        >
          <strong>截止时间</strong>
          <input
            type="date"
            aria-label="子任务截止日期"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <div className="subtask-date-quick-actions">
            <button type="button" onClick={() => {
              const today = new Date();
              const offset = today.getTimezoneOffset() * 60_000;
              setDate(new Date(today.getTime() - offset).toISOString().slice(0, 10));
            }}>今天</button>
            <button type="button" onClick={() => {
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              const offset = tomorrow.getTimezoneOffset() * 60_000;
              setDate(new Date(tomorrow.getTime() - offset).toISOString().slice(0, 10));
            }}>明天</button>
          </div>
          <div className="subtask-date-footer">
            <button type="button" disabled={saving} onClick={() => void save(null)}>清除</button>
            <button type="button" disabled={saving || !date} onClick={() => void save(date)}>确定</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function TaskLabelControl({
  task,
  bundle,
  online,
  onToggleLabel,
}: Pick<TaskDetailProps, "task" | "bundle" | "online" | "onToggleLabel">) {
  const [open, setOpen] = useState(false);
  const [draftLabelIds, setDraftLabelIds] = useState(() => new Set(task.label_ids));
  const [savingLabelId, setSavingLabelId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setDraftLabelIds(new Set(task.label_ids));
  }, [task.id, task.label_ids]);

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

  const selectedLabels = bundle.labels.filter((label) => draftLabelIds.has(label.id));
  const orderedLabels = orderedLabelsTree(bundle.labels, bundle.userLabelOrder);

  async function toggle(labelId: string) {
    if (!online || savingLabelId) return;
    const previous = new Set(draftLabelIds);
    const selected = !previous.has(labelId);
    const next = new Set(previous);
    if (selected) next.add(labelId);
    else next.delete(labelId);
    setDraftLabelIds(next);
    setSavingLabelId(labelId);
    setError("");
    try {
      await onToggleLabel(task.id, labelId, selected);
    } catch (cause) {
      setDraftLabelIds(previous);
      setError(cause instanceof Error ? cause.message : "标签保存失败，请重试");
    } finally {
      setSavingLabelId(null);
    }
  }

  return (
    <div className="task-label-control" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={clsx("task-label-trigger", open && "active")}
        aria-label="管理任务标签"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!online}
        onClick={() => {
          setOpen((value) => !value);
          setError("");
        }}
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
          {orderedLabels.map((label) => {
            const selected = draftLabelIds.has(label.id);
            return (
              <button
                key={label.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={selected}
                disabled={Boolean(savingLabelId) || (bundle.labelPermissionLevels[label.id] ?? 0) < 2}
                onClick={() => void toggle(label.id)}
              >
                <i style={{ background: label.color }} />
                <span>{label.name}</span>
                {selected && <Check />}
              </button>
            );
          })}
          {orderedLabels.length === 0 && <p className="task-label-menu-empty">暂无可用标签</p>}
          {error && <p className="task-label-menu-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

type TaskDetailContentHandle = {
  close: () => Promise<void>;
};

type ActiveCliTerminal = {
  sessionId: string;
  tool: import("./types").AiCliTool;
  targetLabel: string;
  prompt: string;
};

function TaskHoursDialog({
  open,
  estimateHours,
  actualHours,
  resetKey,
  online,
  onOpenChange,
  onUpdate,
}: {
  open: boolean;
  estimateHours: number | null;
  actualHours: number | null;
  resetKey: string;
  online: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (patch: {
    estimate_hours: number | null;
    actual_hours: number | null;
  }) => Promise<void>;
}) {
  const [estimate, setEstimate] = useState("");
  const [actual, setActual] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setEstimate(estimateHours == null ? "" : formatHoursValue(estimateHours));
    setActual(actualHours == null ? "" : formatHoursValue(actualHours));
    setSaving(false);
    setError("");
  }, [open, actualHours, estimateHours, resetKey]);

  async function save() {
    if (!online || saving) return;
    setSaving(true);
    setError("");
    try {
      const nextEstimate = normalizeHoursInput(estimate);
      const nextActual = normalizeHoursInput(actual);
      await onUpdate({
        estimate_hours: nextEstimate,
        actual_hours: nextActual,
      });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "工时保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog-content task-hours-dialog"
          aria-describedby={undefined}
        >
          <header>
            <Dialog.Title>登记工时</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="关闭">
                <X />
              </button>
            </Dialog.Close>
          </header>
          <div className="task-hours-dialog-body">
            <label>
              <span>预计工时</span>
              <div className="task-hours-field">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.1}
                  value={estimate}
                  disabled={!online || saving}
                  placeholder="可选"
                  onChange={(event) => setEstimate(event.target.value)}
                />
                <em>小时</em>
              </div>
            </label>
            <label>
              <span>实际工时</span>
              <div className="task-hours-field">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.1}
                  value={actual}
                  disabled={!online || saving}
                  placeholder="可选"
                  onChange={(event) => setActual(event.target.value)}
                />
                <em>小时</em>
              </div>
            </label>
            {error && <p role="alert">{error}</p>}
          </div>
          <footer>
            <button
              type="button"
              className="button secondary"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="button primary"
              disabled={!online || saving}
              onClick={() => void save()}
            >
              保存
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TaskMoreMenu({
  task,
  online,
  onUpdate,
  onShowActivity,
}: Pick<TaskDetailProps, "task" | "online" | "onUpdate"> & {
  onShowActivity: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
    setHoursOpen(false);
    setError("");
  }, [task.id]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
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

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;

    const positionMenu = () => {
      const trigger = triggerRef.current!.getBoundingClientRect();
      const menu = menuRef.current!;
      const gap = 8;
      const inset = 12;
      const width = Math.min(164, window.innerWidth - inset * 2);
      const height = menu.offsetHeight;
      const left = Math.min(
        Math.max(trigger.right - width, inset),
        Math.max(inset, window.innerWidth - width - inset),
      );
      const preferredTop = trigger.bottom + gap;
      const top = preferredTop + height <= window.innerHeight - inset
        ? preferredTop
        : Math.max(inset, trigger.top - height - gap);
      setPosition({ width, left, top });
    };

    positionMenu();
    menuRef.current.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [error, open]);

  async function switchKind() {
    if (!online || saving) return;
    setSaving(true);
    setError("");
    try {
      await onUpdate({ kind: task.kind === "note" ? "todo" : "note" });
      setOpen(false);
      triggerRef.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "类型切换失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="task-more-control" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={task.kind === "note" ? "更多笔记操作" : "更多任务操作"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setError("");
        }}
      >
        <Ellipsis />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="task-more-menu"
          role="menu"
          aria-label="更多操作"
          style={position}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onShowActivity();
            }}
          >
            <History />
            <span>任务动态</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!online || saving}
            onClick={() => {
              setOpen(false);
              setHoursOpen(true);
            }}
          >
            <Clock />
            <span>登记工时</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!online || saving}
            onClick={() => void switchKind()}
          >
            {task.kind === "note" ? <ListTodo /> : <NotebookPen />}
            <span>{task.kind === "note" ? "切换为待办" : "切换为笔记"}</span>
          </button>
          {error && <p role="alert">{error}</p>}
        </div>,
        document.body,
      )}
      <TaskHoursDialog
        open={hoursOpen}
        estimateHours={task.estimate_hours}
        actualHours={task.actual_hours}
        resetKey={task.id}
        online={online}
        onOpenChange={setHoursOpen}
        onUpdate={onUpdate}
      />
    </div>
  );
}

function SubtaskMoreMenu({
  subtask,
  online,
  onUpdate,
}: {
  subtask: Subtask;
  online: boolean;
  onUpdate: (patch: Partial<Pick<Subtask, "estimate_hours" | "actual_hours">>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
    setHoursOpen(false);
  }, [subtask.id]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
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

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;

    const positionMenu = () => {
      const trigger = triggerRef.current!.getBoundingClientRect();
      const menu = menuRef.current!;
      const gap = 8;
      const inset = 12;
      const width = Math.min(164, window.innerWidth - inset * 2);
      const height = menu.offsetHeight;
      const left = Math.min(
        Math.max(trigger.right - width, inset),
        Math.max(inset, window.innerWidth - width - inset),
      );
      const preferredTop = trigger.bottom + gap;
      const top = preferredTop + height <= window.innerHeight - inset
        ? preferredTop
        : Math.max(inset, trigger.top - height - gap);
      setPosition({ width, left, top });
    };

    positionMenu();
    menuRef.current.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open]);

  return (
    <div className="task-more-control" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="更多子任务操作"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Ellipsis />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="task-more-menu"
          role="menu"
          aria-label="更多操作"
          style={position}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!online}
            onClick={() => {
              setOpen(false);
              setHoursOpen(true);
            }}
          >
            <Clock />
            <span>登记工时</span>
          </button>
        </div>,
        document.body,
      )}
      <TaskHoursDialog
        open={hoursOpen}
        estimateHours={subtask.estimate_hours}
        actualHours={subtask.actual_hours}
        resetKey={subtask.id}
        online={online}
        onOpenChange={setHoursOpen}
        onUpdate={onUpdate}
      />
    </div>
  );
}

function memberDisplayName(member: Member | undefined) {
  return member?.profile?.display_name?.trim() || "团队成员";
}

type AiSuggestListItem = AiSuggestedSubtask & { clientKey: string };
type AiSmartPanel = "menu" | "decompose" | "format" | null;

function scheduleFromTask(task: Task): ReminderSchedule {
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

function AiSmartProcessControl({
  task,
  bundle,
  currentUserId,
  online,
  editable,
  onCreateSubtask,
  onEnsureSubtasksVisible,
  onUpdate,
  onSaveSchedule,
  onFormatApplied,
}: {
  task: Task;
  bundle: WorkspaceBundle;
  currentUserId: string;
  online: boolean;
  editable: boolean;
  onCreateSubtask: (
    title: string,
    extras?: Partial<Pick<Subtask, "due_at" | "assignee_id" | "cli_assignee">>,
  ) => Promise<void>;
  onEnsureSubtasksVisible?: () => void;
  onUpdate: (patch: Partial<Task>) => Promise<void>;
  onSaveSchedule: (
    patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
    schedule: ReminderSchedule,
  ) => Promise<void>;
  onFormatApplied: (title: string, description: string) => void;
}) {
  const writable = online && editable;
  const [panel, setPanel] = useState<AiSmartPanel>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<AiSuggestListItem[]>([]);
  const [formatSuggestion, setFormatSuggestion] = useState<AiFormatSuggestion | null>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  const assignableMembers = useMemo(
    () => getAssignableMembers(bundle, task, currentUserId),
    [bundle, currentUserId, task],
  );
  const assignableIds = useMemo(
    () => assignableMembers.map((member) => member.user_id),
    [assignableMembers],
  );
  const membersById = useMemo(() => {
    const map = new Map<string, Member>();
    for (const member of bundle.members) {
      map.set(member.user_id, member);
    }
    return map;
  }, [bundle.members]);

  const busy = loading || adding || applying;
  const open = panel !== null;

  function closePanel() {
    setPanel(null);
    setLoading(false);
    setAdding(false);
    setApplying(false);
    setError("");
    setItems([]);
    setFormatSuggestion(null);
  }

  useEffect(() => {
    closePanel();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when switching tasks
  }, [task.id]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      if (busy) return;
      closePanel();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (busy) return;
      event.stopPropagation();
      closePanel();
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, busy]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !panelRef.current) return;

    const positionPanel = () => {
      const trigger = triggerRef.current!.getBoundingClientRect();
      const panelEl = panelRef.current!;
      const gap = 8;
      const inset = 12;
      const isMenu = panel === "menu";
      const width = isMenu
        ? Math.min(164, window.innerWidth - inset * 2)
        : Math.min(410, window.innerWidth - inset * 2);
      const maxHeight = isMenu
        ? Math.min(200, window.innerHeight - inset * 2)
        : Math.min(574, window.innerHeight - inset * 2);
      const height = Math.min(panelEl.scrollHeight || maxHeight, maxHeight);
      let left = trigger.right - width;
      left = Math.min(
        Math.max(left, inset),
        Math.max(inset, window.innerWidth - width - inset),
      );
      let top = trigger.bottom + gap;
      if (top + height > window.innerHeight - inset) {
        top = Math.max(inset, trigger.top - height - gap);
      }
      if (top + height > window.innerHeight - inset) {
        top = Math.max(inset, window.innerHeight - height - inset);
      }
      setPosition(
        isMenu
          ? { width, left, top }
          : {
              width,
              height: maxHeight,
              maxHeight,
              left,
              top,
            },
      );
    };

    positionPanel();
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    return () => {
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
    };
  }, [open, panel, items, formatSuggestion, loading, error]);

  async function requestDecompose() {
    if (!writable || adding) return;
    const requestId = ++requestIdRef.current;
    setPanel("decompose");
    setLoading(true);
    setError("");
    setItems([]);
    setFormatSuggestion(null);

    if (!supabase) {
      setError("服务未配置，无法分解任务。");
      setLoading(false);
      return;
    }

    try {
      const result = await decomposeSubtasks(supabase, {
        workspaceId: task.workspace_id,
        taskId: task.id,
        nowIso: new Date().toISOString(),
        timeZone: systemTimeZone(),
        assignableUserIds: assignableIds,
      });
      if (requestId !== requestIdRef.current) return;
      setItems(
        result.subtasks.map((item, index) => ({
          ...item,
          clientKey: `${Date.now()}-${index}-${item.title}`,
        })),
      );
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : "AI 分解失败，请稍后重试。");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  async function requestFormat() {
    if (!writable || applying) return;
    const requestId = ++requestIdRef.current;
    setPanel("format");
    setLoading(true);
    setError("");
    setItems([]);
    setFormatSuggestion(null);

    if (!supabase) {
      setError("服务未配置，无法格式化任务。");
      setLoading(false);
      return;
    }

    try {
      const suggestion = await formatTaskWithAi(supabase, {
        workspaceId: task.workspace_id,
        taskId: task.id,
        nowIso: new Date().toISOString(),
        timeZone: systemTimeZone(),
      });
      if (requestId !== requestIdRef.current) return;
      setFormatSuggestion(suggestion);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : "智能格式化失败，请稍后重试。");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  async function addOne(item: AiSuggestListItem) {
    if (!writable || adding || loading) return;
    setAdding(true);
    setError("");
    try {
      const extras = buildSubtaskExtrasFromSuggestion(item, assignableIds);
      onEnsureSubtasksVisible?.();
      await onCreateSubtask(item.title, extras);
      const remaining = items.filter((row) => row.clientKey !== item.clientKey);
      setItems(remaining);
      if (remaining.length === 0) closePanel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加子任务失败");
    } finally {
      setAdding(false);
    }
  }

  async function addAll() {
    if (!writable || adding || loading || items.length === 0) return;
    setAdding(true);
    setError("");
    try {
      onEnsureSubtasksVisible?.();
      for (const item of items) {
        const extras = buildSubtaskExtrasFromSuggestion(item, assignableIds);
        await onCreateSubtask(item.title, extras);
      }
      closePanel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加子任务失败");
    } finally {
      setAdding(false);
    }
  }

  async function adoptFormat() {
    if (!writable || loading || applying || !formatSuggestion) return;
    setApplying(true);
    setError("");
    try {
      const description = buildFormattedDescription(formatSuggestion);
      await onUpdate({ title: formatSuggestion.title, description });
      if (formatSuggestion.due_at) {
        const timeZone = systemTimeZone();
        await onSaveSchedule(
          {
            due_at: formatSuggestion.due_at,
            due_start_at: null,
            due_is_all_day: isMidnightLocalDueAt(formatSuggestion.due_at, timeZone),
            due_timezone: timeZone,
          },
          scheduleFromTask(task),
        );
      }
      onFormatApplied(formatSuggestion.title, description);
      closePanel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "采纳失败，请稍后重试");
    } finally {
      setApplying(false);
    }
  }

  function suggestionMeta(item: AiSuggestedSubtask) {
    const parts: string[] = [];
    if (item.assignee_user_id) {
      parts.push(memberDisplayName(membersById.get(item.assignee_user_id)));
    }
    const dueLabel = formatAiSuggestedDueAt(item.due_at);
    if (dueLabel) parts.push(dueLabel);
    return parts.join(" · ");
  }

  const formatDueLabel = formatSuggestion
    ? formatAiSuggestedDueAt(formatSuggestion.due_at)
    : null;

  return (
    <div className="ai-smart-process" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={clsx("switch-mode", (open || loading) && "active")}
        title="智能处理"
        aria-label="智能处理"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!writable || adding || applying}
        onClick={() => {
          if (!writable) return;
          if (panel === "menu") {
            closePanel();
            return;
          }
          if (busy && panel !== null) return;
          requestIdRef.current += 1;
          setError("");
          setItems([]);
          setFormatSuggestion(null);
          setLoading(false);
          setPanel("menu");
        }}
      >
        <Sparkles />
      </button>
      {panel === "menu" && createPortal(
        <div
          ref={panelRef}
          className="ai-smart-process-menu"
          role="menu"
          aria-label="智能处理"
          style={position}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!writable}
            onClick={() => {
              void requestDecompose();
            }}
          >
            智能分解子任务
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!writable}
            onClick={() => {
              void requestFormat();
            }}
          >
            智能格式化
          </button>
        </div>,
        document.body,
      )}
      {panel === "decompose" && createPortal(
        <div
          ref={panelRef}
          className="ai-subtask-suggest-panel"
          role="dialog"
          aria-label="推荐子任务"
          style={position}
        >
          <div className="ai-subtask-suggest-header">
            <strong>推荐子任务</strong>
            <button
              type="button"
              className="ai-subtask-suggest-add-all"
              disabled={!writable || loading || adding || items.length === 0}
              onClick={() => {
                void addAll();
              }}
            >
              全部添加
            </button>
          </div>
          <div className="ai-subtask-suggest-body">
            {loading && (
              <p className="ai-subtask-suggest-status">正在分解…</p>
            )}
            {!loading && error && (
              <p className="ai-subtask-suggest-error">{error}</p>
            )}
            {!loading && !error && items.length === 0 && (
              <p className="ai-subtask-suggest-status">暂无推荐</p>
            )}
            {!loading && items.length > 0 && (
              <ul className="ai-subtask-suggest-list">
                {items.map((item) => {
                  const meta = suggestionMeta(item);
                  return (
                    <li key={item.clientKey} className="ai-subtask-suggest-row">
                      <div className="ai-subtask-suggest-main">
                        <span className="ai-subtask-suggest-title">{item.title}</span>
                        {meta && (
                          <span className="ai-subtask-suggest-meta">{meta}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="ai-subtask-suggest-add"
                        disabled={!writable || adding}
                        aria-label={`添加子任务：${item.title}`}
                        onClick={() => {
                          void addOne(item);
                        }}
                      >
                        添加
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>,
        document.body,
      )}
      {panel === "format" && createPortal(
        <div
          ref={panelRef}
          className="ai-format-suggest-panel"
          role="dialog"
          aria-label="格式化推荐"
          style={position}
        >
          <div className="ai-subtask-suggest-header">
            <strong>格式化推荐</strong>
            <button
              type="button"
              className="ai-subtask-suggest-add-all"
              disabled={!writable || loading || applying || !formatSuggestion}
              onClick={() => {
                void adoptFormat();
              }}
            >
              采纳
            </button>
          </div>
          <div className="ai-format-suggest-body">
            {loading && (
              <p className="ai-subtask-suggest-status">正在格式化…</p>
            )}
            {!loading && error && (
              <p className="ai-subtask-suggest-error">{error}</p>
            )}
            {!loading && !error && !formatSuggestion && (
              <p className="ai-subtask-suggest-status">暂无推荐</p>
            )}
            {!loading && formatSuggestion && (
              <div className="ai-format-suggest-content">
                <section className="ai-format-suggest-field">
                  <span className="ai-format-suggest-label">标题</span>
                  <p className="ai-format-suggest-title">{formatSuggestion.title}</p>
                </section>
                {formatDueLabel && (
                  <section className="ai-format-suggest-field">
                    <span className="ai-format-suggest-label">截止时间</span>
                    <p className="ai-format-suggest-meta">{formatDueLabel}</p>
                  </section>
                )}
                {formatSuggestion.description && (
                  <section className="ai-format-suggest-field">
                    <span className="ai-format-suggest-label">描述</span>
                    <p className="ai-format-suggest-text">{formatSuggestion.description}</p>
                  </section>
                )}
                {formatSuggestion.acceptance_criteria && (
                  <section className="ai-format-suggest-field">
                    <span className="ai-format-suggest-label">验收标准</span>
                    <p className="ai-format-suggest-text">{formatSuggestion.acceptance_criteria}</p>
                  </section>
                )}
                {formatSuggestion.references && (
                  <section className="ai-format-suggest-field">
                    <span className="ai-format-suggest-label">参考资料</span>
                    <p className="ai-format-suggest-text">{formatSuggestion.references}</p>
                  </section>
                )}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

const TaskDetailContent = forwardRef<TaskDetailContentHandle, TaskDetailProps & {
  presentation: "panel" | "dialog";
}>(function TaskDetailContent({
  presentation,
  task,
  bundle,
  currentUserId,
  online,
  editable,
  attachmentService,
  now,
  dateTimePreferences,
  aiWorkSettings,
  settingsLabelName = null,
  focusedSubtaskId = null,
  onClearFocusedSubtask,
  onClose,
  onUpdate,
  onSaveSchedule,
  onAssign,
  onAssignSubtask,
  onToggleLabel,
  onToggleParticipant,
  onCreateSubtask,
  onToggleSubtask,
  onUpdateSubtask,
  onDeleteSubtask,
  commentsRevision,
  activityRevision,
  onLoadActivity,
  onLoadComments,
  onLoadCommentCandidates,
  onCreateComment,
  onUpdateComment,
  onDeleteComment,
}, forwardedRef) {
  const focusedSubtask = focusedSubtaskId
    ? task.subtasks.find((subtask) => subtask.id === focusedSubtaskId) ?? null
    : null;
  const [draftTitle, setDraftTitle] = useState(
    focusedSubtask?.title ?? task.title,
  );
  const [descriptionRevision, setDescriptionRevision] = useState(0);
  const [descriptionSeed, setDescriptionSeed] = useState<string | null>(null);
  const [activeTerminal, setActiveTerminal] = useState<ActiveCliTerminal | null>(null);
  const subtaskInputRef = useRef<HTMLInputElement>(null);
  const focusedSubtaskTitleRef = useRef<HTMLTextAreaElement>(null);
  const [subtaskTitleEditing, setSubtaskTitleEditing] = useState(false);
  const [subtaskTitleEditingForId, setSubtaskTitleEditingForId] = useState<string | null>(null);
  const focusedSubtaskKey = focusedSubtask?.id ?? null;
  if (focusedSubtaskKey !== subtaskTitleEditingForId) {
    setSubtaskTitleEditingForId(focusedSubtaskKey);
    setSubtaskTitleEditing(Boolean(focusedSubtask && online && editable));
  }
  const editingSubtaskInputRef = useRef<HTMLInputElement>(null);
  const skipSubtaskTitleCommitRef = useRef(false);
  const committingDraftSubtaskRef = useRef(false);
  const commitDraftSubtaskRef = useRef<() => Promise<void>>(async () => undefined);
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [editingSubtaskTitle, setEditingSubtaskTitle] = useState("");
  const [draftSubtaskDueAt, setDraftSubtaskDueAt] = useState<string | null>(null);
  const [draftSubtaskCli, setDraftSubtaskCli] = useState<AiCliTool | null>(null);
  const assignableMembers = useMemo(
    () => getAssignableMembers(bundle, task, currentUserId),
    [bundle, currentUserId, task],
  );
  const subtaskTokens = useTaskTitleTokens({
    members: assignableMembers,
    labels: [],
    labelPermissionLevels: {},
    currentUserId,
    features: { assignee: true, labels: false },
    inputRef: subtaskInputRef,
  });
  const draftSubtaskAssignee: AssigneeTarget = draftSubtaskCli
    ? { kind: "cli", tool: draftSubtaskCli }
    : subtaskTokens.assigneeId
      ? { kind: "user", userId: subtaskTokens.assigneeId }
      : { kind: "none" };
  const [cliPickerOpen, setCliPickerOpen] = useState(false);
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [immersive, setImmersive] = useState(false);
  const [showSubtasks, setShowSubtasks] = useState(readDetailSubtasksVisible);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentComposerOpen, setCommentComposerOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const editorRef = useRef<TaskRichTextEditorHandle>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const closingRef = useRef(false);
  const activeTerminalRef = useRef<ActiveCliTerminal | null>(null);
  const startedTerminalsRef = useRef(new Map<string, AiCliTool>());
  const preferredTerminalByTaskRef = useRef(new Map<string, ActiveCliTerminal>());
  const cliPickerRef = useRef<HTMLDivElement>(null);
  const writable = online && editable;
  const hoursLabel = formatHoursDetail(
    focusedSubtask ? focusedSubtask.estimate_hours : task.estimate_hours,
    focusedSubtask ? focusedSubtask.actual_hours : task.actual_hours,
  );
  const desktopAiAvailable = Boolean(window.anttodoDesktop?.aiWork);
  activeTerminalRef.current = activeTerminal;

  useEffect(() => {
    setDraftTitle(focusedSubtask?.title ?? task.title);
  }, [focusedSubtask?.id, focusedSubtask?.title, task.id, task.title]);
  useEffect(() => {
    setDescriptionSeed(null);
    setDescriptionRevision(0);
  }, [task.id]);
  useLayoutEffect(() => {
    if (focusedSubtask) return;
    const title = titleRef.current;
    if (!title) return;
    title.style.height = "0px";
    title.style.height = `${title.scrollHeight}px`;
  }, [draftTitle, focusedSubtask, presentation, task.id]);
  useLayoutEffect(() => {
    if (!focusedSubtask || !writable || !subtaskTitleEditing) return;
    const input = focusedSubtaskTitleRef.current;
    if (!input) return;
    input.focus();
  }, [focusedSubtask?.id, writable, subtaskTitleEditing]);
  useLayoutEffect(() => {
    if (!focusedSubtask || !writable || !subtaskTitleEditing) return;
    const input = focusedSubtaskTitleRef.current;
    if (!input) return;
    input.select();
  }, [focusedSubtask?.id, writable]);
  useLayoutEffect(() => {
    if (!focusedSubtask || !subtaskTitleEditing) return;
    const title = focusedSubtaskTitleRef.current;
    if (!title) return;
    const maxHeight = 48; // 2 lines × 24px line-height
    title.style.height = "0px";
    title.style.height = `${Math.min(title.scrollHeight, maxHeight)}px`;
  }, [draftTitle, focusedSubtask, subtaskTitleEditing]);
  useEffect(() => {
    if (!editingSubtaskId) return;
    if (task.subtasks.some((subtask) => subtask.id === editingSubtaskId)) return;
    skipSubtaskTitleCommitRef.current = true;
    setEditingSubtaskId(null);
    setEditingSubtaskTitle("");
  }, [editingSubtaskId, task.subtasks]);
  useLayoutEffect(() => {
    if (!editingSubtaskId) return;
    const input = editingSubtaskInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [editingSubtaskId]);
  useEffect(() => {
    // Keep CLI processes running across todo switches; restore the view if this
    // task still has a remembered terminal session.
    setImmersive(false);
    setCliPickerOpen(false);
    skipSubtaskTitleCommitRef.current = true;
    setEditingSubtaskId(null);
    setEditingSubtaskTitle("");
    subtaskTokens.reset();
    setDraftSubtaskDueAt(null);
    setDraftSubtaskCli(null);
    setToolbarOpen(false);
    setActivityOpen(false);
    setCommentComposerOpen(false);
    const preferred = preferredTerminalByTaskRef.current.get(task.id);
    setActiveTerminal(
      preferred && startedTerminalsRef.current.has(preferred.sessionId)
        ? preferred
        : null,
    );
  }, [task.id, focusedSubtask?.id]);
  useEffect(() => {
    if (!cliPickerOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!cliPickerRef.current?.contains(event.target as Node)) setCliPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCliPickerOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [cliPickerOpen]);
  useEffect(() => {
    if (task.status !== "completed") return;
    preferredTerminalByTaskRef.current.delete(task.id);
    setActiveTerminal(null);
    const sessionIds = [
      taskTerminalSessionKey(task.id),
      ...task.subtasks.map((subtask) => subtaskTerminalSessionKey(subtask.id)),
    ];
    for (const sessionId of sessionIds) {
      startedTerminalsRef.current.delete(sessionId);
      untrackAiTerminalSession(sessionId);
    }
  }, [task.id, task.status, task.subtasks]);
  useEffect(() => {
    const terminalBridge = window.anttodoDesktop?.aiWork?.terminal;
    if (!terminalBridge) return;
    for (const [sessionId, expectedTool] of startedTerminalsRef.current) {
      const currentTool = sessionId === taskTerminalSessionKey(task.id)
        ? task.cli_assignee
        : task.subtasks.find(
            (subtask) => sessionId === subtaskTerminalSessionKey(subtask.id),
          )?.cli_assignee ?? null;
      if (currentTool === expectedTool) continue;
      void terminalBridge.stop(sessionId);
      startedTerminalsRef.current.delete(sessionId);
      untrackAiTerminalSession(sessionId);
      for (const [taskId, terminal] of preferredTerminalByTaskRef.current) {
        if (terminal.sessionId === sessionId) {
          preferredTerminalByTaskRef.current.delete(taskId);
        }
      }
      setActiveTerminal((current) => current?.sessionId === sessionId ? null : current);
    }
  }, [task.cli_assignee, task.id, task.subtasks]);
  useEffect(() => {
    if (!activityOpen) return;
    const closeActivity = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActivityOpen(false);
    };
    window.addEventListener("keydown", closeActivity);
    return () => window.removeEventListener("keydown", closeActivity);
  }, [activityOpen]);
  useEffect(() => {
    if (!immersive) return;
    const exitImmersive = (event: KeyboardEvent) => {
      if (event.key === "Escape") setImmersive(false);
    };
    window.addEventListener("keydown", exitImmersive);
    return () => window.removeEventListener("keydown", exitImmersive);
  }, [immersive]);
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  useEffect(() => {
    let cancelled = false;
    void onLoadComments(focusedSubtask ? { subtaskId: focusedSubtask.id } : undefined)
      .then((items) => {
        if (!cancelled) setComments(items);
      });
    return () => { cancelled = true; };
  }, [commentsRevision, focusedSubtask?.id, onLoadComments, task.id]);

  function scheduleSave(patch: Partial<Task>) {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (writable) void onUpdate(patch);
    }, 500);
  }

  function scheduleSubtaskSave(
    subtaskId: string,
    patch: Partial<Pick<Subtask, "due_at" | "title" | "description" | "estimate_hours" | "actual_hours">>,
  ) {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (writable) void onUpdateSubtask(subtaskId, patch);
    }, 500);
  }

  function beginEditSubtask(subtask: Subtask) {
    if (!writable) return;
    skipSubtaskTitleCommitRef.current = false;
    setEditingSubtaskId(subtask.id);
    setEditingSubtaskTitle(subtask.title);
  }

  function cancelEditSubtask() {
    skipSubtaskTitleCommitRef.current = true;
    setEditingSubtaskId(null);
    setEditingSubtaskTitle("");
  }

  function commitEditSubtask() {
    if (skipSubtaskTitleCommitRef.current) {
      skipSubtaskTitleCommitRef.current = false;
      return;
    }
    if (!editingSubtaskId) return;
    const subtask = task.subtasks.find((item) => item.id === editingSubtaskId);
    const nextTitle = editingSubtaskTitle.trim();
    setEditingSubtaskId(null);
    setEditingSubtaskTitle("");
    if (!subtask || !nextTitle || nextTitle === subtask.title) return;
    void onUpdateSubtask(subtask.id, { title: nextTitle }).catch(() => undefined);
  }

  async function commitDraftSubtask() {
    if (committingDraftSubtaskRef.current || subtaskTokens.token || !writable) return;
    const payload = subtaskTokens.toSubmitPayload();
    if (!payload.title) return;
    committingDraftSubtaskRef.current = true;
    const assigneeId = draftSubtaskAssignee.kind === "user"
      ? draftSubtaskAssignee.userId
      : null;
    const cliAssignee = draftSubtaskAssignee.kind === "cli"
      ? draftSubtaskAssignee.tool
      : null;
    const dueAt = draftSubtaskDueAt;
    subtaskTokens.reset();
    setDraftSubtaskDueAt(null);
    setDraftSubtaskCli(null);
    try {
      await onCreateSubtask(payload.title, {
        assignee_id: assigneeId,
        cli_assignee: cliAssignee,
        due_at: dueAt,
      });
    } finally {
      committingDraftSubtaskRef.current = false;
    }
  }
  commitDraftSubtaskRef.current = commitDraftSubtask;

  function handleDraftSubtaskFormBlur(event: FocusEvent<HTMLFormElement>) {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    if (next instanceof Element && next.closest(".subtask-date-popover")) return;
    void commitDraftSubtask().catch(() => undefined);
  }

  function stopTerminalSession(sessionId: string) {
    const bridge = window.anttodoDesktop?.aiWork?.terminal;
    if (bridge) void bridge.stop(sessionId);
    startedTerminalsRef.current.delete(sessionId);
    untrackAiTerminalSession(sessionId);
    for (const [taskId, terminal] of preferredTerminalByTaskRef.current) {
      if (terminal.sessionId === sessionId) {
        preferredTerminalByTaskRef.current.delete(taskId);
      }
    }
  }

  function leaveCliView() {
    const current = activeTerminalRef.current;
    if (current) stopTerminalSession(current.sessionId);
    preferredTerminalByTaskRef.current.delete(task.id);
    setActiveTerminal(null);
  }

  function openTerminalView(terminal: ActiveCliTerminal) {
    preferredTerminalByTaskRef.current.set(task.id, terminal);
    setToolbarOpen(false);
    setCommentComposerOpen(false);
    setActivityOpen(false);
    setCliPickerOpen(false);
    setActiveTerminal(terminal);
  }

  async function showTaskTerminal(tool: AiCliTool | null = task.cli_assignee) {
    if (!tool || !desktopAiAvailable) return;
    const description = editorRef.current?.getMarkdown() ?? task.description;
    await editorRef.current?.flush().catch(() => undefined);
    const sessionId = taskTerminalSessionKey(task.id);
    startedTerminalsRef.current.set(sessionId, tool);
    trackAiTerminalSession(task.id, sessionId);
    openTerminalView({
      sessionId,
      tool,
      targetLabel: `待办：${task.title}`,
      prompt: buildTaskCliPrompt({ ...task, description }),
    });
  }

  async function showSubtaskTerminal(subtask: Subtask) {
    if (!subtask.cli_assignee || !desktopAiAvailable) return;
    const description = editorRef.current?.getMarkdown() ?? task.description;
    await editorRef.current?.flush().catch(() => undefined);
    const sessionId = subtaskTerminalSessionKey(subtask.id);
    startedTerminalsRef.current.set(sessionId, subtask.cli_assignee);
    trackAiTerminalSession(task.id, sessionId);
    openTerminalView({
      sessionId,
      tool: subtask.cli_assignee,
      targetLabel: `子任务：${subtask.title}`,
      prompt: buildSubtaskCliPrompt({ ...task, description }, subtask),
    });
  }

  async function handleAssign(target: AssigneeTarget) {
    await onAssign(target);
    if (target.kind === "cli") {
      await showTaskTerminal(target.tool);
    }
  }

  async function handleAssignSubtask(subtaskId: string, target: AssigneeTarget) {
    await onAssignSubtask(subtaskId, target);
    if (target.kind !== "cli") return;
    const subtask = task.subtasks.find((item) => item.id === subtaskId);
    if (!subtask) return;
    await showSubtaskTerminal({ ...subtask, cli_assignee: target.tool });
  }

  async function closeDetail() {
    if (closingRef.current) return;
    closingRef.current = true;
    window.clearTimeout(saveTimer.current);
    if (writable && focusedSubtask && draftTitle !== focusedSubtask.title) {
      await onUpdateSubtask(focusedSubtask.id, { title: draftTitle }).catch(() => undefined);
    } else if (writable && !focusedSubtask && draftTitle !== task.title) {
      await onUpdate({ title: draftTitle }).catch(() => undefined);
    }
    await editorRef.current?.flush().catch(() => undefined);
    await commitDraftSubtaskRef.current().catch(() => undefined);
    // Closing the panel while the CLI view is open counts as leaving the view.
    if (activeTerminalRef.current) leaveCliView();
    onClose();
  }

  useEffect(() => {
    const flushPending = () => {
      if (!writable) return;
      window.clearTimeout(saveTimer.current);
      if (focusedSubtask && draftTitle !== focusedSubtask.title) {
        void onUpdateSubtask(focusedSubtask.id, { title: draftTitle }).catch(() => undefined);
      } else if (!focusedSubtask && draftTitle !== task.title) {
        void onUpdate({ title: draftTitle }).catch(() => undefined);
      }
      void editorRef.current?.flush().catch(() => undefined);
      void commitDraftSubtaskRef.current().catch(() => undefined);
    };
    window.addEventListener(FLUSH_PENDING_EDITS_EVENT, flushPending);
    return () => window.removeEventListener(FLUSH_PENDING_EDITS_EVENT, flushPending);
  }, [
    draftTitle,
    focusedSubtask,
    onUpdate,
    onUpdateSubtask,
    task.title,
    writable,
  ]);

  useImperativeHandle(forwardedRef, () => ({ close: closeDetail }));

  if (focusedSubtask) {
    const subtaskToolbarLeading: ReactNode = (
      <>
        {presentation === "panel" && (
          <button type="button" onClick={() => void closeDetail()} aria-label="关闭详情">
            <X />
          </button>
        )}
        <button
          type="button"
          className="detail-back-to-parent"
          aria-label="返回父任务"
          onClick={() => onClearFocusedSubtask?.()}
        >
          <ChevronLeft />
          <span>返回父任务</span>
        </button>
        <button
          className="detail-complete-trigger"
          type="button"
          disabled={!writable}
          aria-label={focusedSubtask.completed ? "重新打开子任务" : "完成子任务"}
          onClick={() => void onToggleSubtask(focusedSubtask.id, !focusedSubtask.completed).catch(() => {})}
        >
          {focusedSubtask.completed && <Check />}
        </button>
        {presentation === "dialog" && (
          <span className="detail-toolbar-divider" aria-hidden="true" />
        )}
      </>
    );

    return (
      <div className={clsx("task-detail", `task-detail-${presentation}`, "task-detail-subtask")}>
        <header className="detail-toolbar">
          {subtaskToolbarLeading}
          <SubtaskDueDateControl
            dueAt={focusedSubtask.due_at}
            completed={focusedSubtask.completed}
            online={writable}
            onSave={(dueAt) => onUpdateSubtask(focusedSubtask.id, { due_at: dueAt })}
          />
          <div className="detail-toolbar-spacer" />
          <TaskAssigneeControl
            task={task}
            bundle={bundle}
            currentUserId={currentUserId}
            aiWorkSettings={aiWorkSettings}
            online={writable}
            onAssign={(target) => onAssignSubtask(focusedSubtask.id, target)}
            target={subtaskAssigneeTarget(focusedSubtask)}
          />
          <SubtaskMoreMenu
            subtask={focusedSubtask}
            online={writable}
            onUpdate={(patch) => onUpdateSubtask(focusedSubtask.id, patch)}
          />
        </header>
        <div className="detail-body">
          <div className="detail-caption">
            {subtaskTitleEditing && writable ? (
              <textarea
                ref={focusedSubtaskTitleRef}
                className="detail-title subtask-detail-title"
                value={draftTitle}
                aria-label="子任务标题"
                rows={1}
                onChange={(event) => {
                  setDraftTitle(event.target.value);
                  scheduleSubtaskSave(focusedSubtask.id, { title: event.target.value });
                }}
                onBlur={() => setSubtaskTitleEditing(false)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
              />
            ) : (
              <div
                className="detail-title subtask-detail-title subtask-detail-title-clamp"
                role={writable ? "textbox" : undefined}
                tabIndex={writable ? 0 : undefined}
                aria-label="子任务标题"
                aria-readonly={!writable}
                onClick={() => {
                  if (writable) setSubtaskTitleEditing(true);
                }}
                onKeyDown={(event) => {
                  if (!writable) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSubtaskTitleEditing(true);
                  }
                }}
              >
                {draftTitle}
              </div>
            )}
            <button
              type="button"
              className="detail-parent-task"
              onClick={() => onClearFocusedSubtask?.()}
            >
              所属任务：{task.title}
            </button>
          </div>
          <TaskRichTextEditor
            key={focusedSubtask.id}
            ref={editorRef}
            attachmentContext={{ workspaceId: task.workspace_id, taskId: task.id }}
            attachmentService={attachmentService}
            immersive={immersive}
            initialMarkdown={focusedSubtask.description}
            online={writable}
            onImmersiveChange={setImmersive}
            onSave={(description) => onUpdateSubtask(focusedSubtask.id, { description })}
            toolbarHost={toolbarHost}
            toolbarOpen={toolbarOpen}
          />
        </div>
        {!immersive && (comments.length > 0 || commentComposerOpen) && (
          <TaskComments
            task={task}
            comments={comments}
            members={bundle.members}
            currentUserId={currentUserId}
            online={writable}
            attachmentService={attachmentService}
            showComposer={commentComposerOpen}
            onLoadCandidates={onLoadCommentCandidates}
            onCreate={async (input) => {
              await onCreateComment(input, { subtaskId: focusedSubtask.id });
              setComments(await onLoadComments({ subtaskId: focusedSubtask.id }));
            }}
            onUpdate={async (comment, input) => {
              await onUpdateComment(comment, input);
              setComments(await onLoadComments({ subtaskId: focusedSubtask.id }));
            }}
            onDelete={async (comment) => {
              await onDeleteComment(comment);
              setComments((current) => current.filter((item) => item.id !== comment.id));
            }}
          />
        )}
        <div
          ref={setToolbarHost}
          className={clsx("detail-editor-toolbar-dock", toolbarOpen && "open")}
        />
        {!immersive && hoursLabel && (
          <p className="detail-hours">{hoursLabel}</p>
        )}
        <footer className="detail-footer">
          <button
            className={clsx("detail-text-style-trigger", toolbarOpen && "active")}
            type="button"
            title="文本样式"
            aria-label="文本样式"
            aria-expanded={toolbarOpen}
            onClick={() => setToolbarOpen((open) => !open)}
          >
            <Type />
          </button>
          <button
            className={clsx("detail-comment-trigger", commentComposerOpen && "active")}
            type="button"
            title="评论"
            aria-label="评论"
            aria-expanded={commentComposerOpen}
            onClick={() => {
              setToolbarOpen(false);
              setCommentComposerOpen((open) => !open);
            }}
          >
            <MessageCircle />
          </button>
        </footer>
      </div>
    );
  }

  const toolbarLeading: ReactNode = presentation === "dialog" ? (
    <>
      {task.kind === "note" ? (
        <span className="detail-note-icon" aria-label="笔记"><NotebookPen /></span>
      ) : (
        <button
          className="detail-complete-trigger"
          type="button"
          disabled={!writable}
          aria-label={task.status === "completed" ? "标记未完成" : "完成任务"}
          style={{
            "--priority-color": getPriorityOption(task.priority).color,
          } as CSSProperties}
          onClick={() => void onUpdate({
            status: task.status === "completed" ? "open" : "completed",
            completed_at: task.status === "completed" ? null : new Date().toISOString(),
          })}
        >
          {task.status === "completed" && <Check />}
        </button>
      )}
      <span className="detail-toolbar-divider" aria-hidden="true" />
    </>
  ) : (
    <button type="button" onClick={() => void closeDetail()} aria-label="关闭详情"><X /></button>
  );

  const aiWorkConfigured = isAiWorkConfigured(aiWorkSettings);
  const cliTools = aiWorkSettings.cli_tools;
  const settingsTitle = settingsLabelName?.trim()
    || bundle.labels.find((label) => task.label_ids.includes(label.id))?.name
    || "设置 AI CLI";
  const cliTerminalLabel = activeTerminal
    ? "显示待办内容"
    : !aiWorkConfigured
      ? "设置 AI CLI"
      : !task.cli_assignee
        ? "选择 CLI 并打开终端"
        : `打开 ${aiCliLabel(task.cli_assignee)} 终端`;

  async function assignCliAndOpenTerminal(tool: AiCliTool) {
    setCliPickerOpen(false);
    await handleAssign({ kind: "cli", tool });
  }

  return (
    <div className={clsx(
      "task-detail",
      `task-detail-${presentation}`,
      immersive && "rich-editor-immersive",
      activeTerminal && "task-detail-cli",
    )}>
      <header className="detail-toolbar">
        {toolbarLeading}
        {presentation === "panel" && task.kind === "note" && (
          <span className="detail-note-icon" aria-label="笔记"><NotebookPen /></span>
        )}
        <DueDateControl
          task={task}
          online={writable}
          now={now}
          preferences={dateTimePreferences}
          onSave={onSaveSchedule}
        />
        <div className="detail-toolbar-spacer" />
        {task.kind !== "note" && (
          <TaskAssigneeControl
            task={task}
            bundle={bundle}
            currentUserId={currentUserId}
            aiWorkSettings={aiWorkSettings}
            online={writable}
            onAssign={handleAssign}
          />
        )}
        {task.kind !== "note" && desktopAiAvailable && (
          <div className="detail-terminal-control" ref={cliPickerRef}>
            <button
              className={clsx(
                "detail-terminal-trigger",
                (activeTerminal || cliPickerOpen) && "active",
              )}
              type="button"
              title={cliTerminalLabel}
              aria-label={cliTerminalLabel}
              aria-pressed={Boolean(activeTerminal)}
              aria-haspopup={aiWorkConfigured && !task.cli_assignee ? "menu" : undefined}
              aria-expanded={aiWorkConfigured && !task.cli_assignee ? cliPickerOpen : undefined}
              onClick={() => {
                if (activeTerminal) {
                  leaveCliView();
                  return;
                }
                if (!aiWorkConfigured) {
                  requestAiWorkSettings({ title: settingsTitle });
                  return;
                }
                if (!task.cli_assignee) {
                  if (cliTools.length === 1) {
                    void assignCliAndOpenTerminal(cliTools[0]);
                    return;
                  }
                  setCliPickerOpen((open) => !open);
                  return;
                }
                void showTaskTerminal();
              }}
            >
              <SquareTerminal />
            </button>
            {cliPickerOpen && !task.cli_assignee && cliTools.length > 0 && (
              <div className="detail-cli-picker" role="menu" aria-label="选择 CLI">
                {cliTools.map((tool) => (
                  <button
                    key={tool}
                    type="button"
                    role="menuitem"
                    onClick={() => void assignCliAndOpenTerminal(tool)}
                  >
                    <SquareTerminal />
                    <span>{aiCliLabel(tool)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {task.kind !== "note" && (
          <PriorityControl
            priority={task.priority}
            online={writable}
            onChange={(priority) => onUpdate({ priority })}
          />
        )}
        <TaskMoreMenu
          task={task}
          online={writable}
          onUpdate={onUpdate}
          onShowActivity={() => {
            leaveCliView();
            setCliPickerOpen(false);
            setCommentComposerOpen(false);
            setActivityOpen(true);
          }}
        />
      </header>
      <div className="detail-body">
        {!activeTerminal && (
          <div className="detail-caption">
            <textarea
              ref={titleRef}
              className="detail-title"
              value={draftTitle}
              disabled={!writable}
              aria-label={task.kind === "note" ? "笔记标题" : "任务标题"}
              onChange={(event) => {
                setDraftTitle(event.target.value);
                scheduleSave({ title: event.target.value });
              }}
              rows={1}
            />
            {task.kind !== "note" && (
              <>
                <button
                  type="button"
                  className={clsx("switch-mode", showSubtasks && "active")}
                  title={showSubtasks ? "收起子任务" : "展开子任务"}
                  aria-label={showSubtasks ? "收起子任务" : "展开子任务"}
                  aria-pressed={showSubtasks}
                  onClick={() => {
                    setShowSubtasks((current) => {
                      const next = !current;
                      storeDetailSubtasksVisible(next);
                      return next;
                    });
                  }}
                >
                  <ListTodo />
                </button>
                <AiSmartProcessControl
                  task={task}
                  bundle={bundle}
                  currentUserId={currentUserId}
                  online={online}
                  editable={editable}
                  onCreateSubtask={onCreateSubtask}
                  onEnsureSubtasksVisible={() => {
                    setShowSubtasks(true);
                    storeDetailSubtasksVisible(true);
                  }}
                  onUpdate={onUpdate}
                  onSaveSchedule={onSaveSchedule}
                  onFormatApplied={(title, description) => {
                    setDraftTitle(title);
                    setDescriptionSeed(description);
                    setDescriptionRevision((value) => value + 1);
                  }}
                />
              </>
            )}
          </div>
        )}
        {activeTerminal ? (
          <TaskCliTerminal
            taskId={task.id}
            sessionId={activeTerminal.sessionId}
            tool={activeTerminal.tool}
            cwd={aiWorkSettings.default_working_path ?? ""}
            prompt={activeTerminal.prompt}
            targetLabel={activeTerminal.targetLabel}
          />
        ) : (
          <>
        <TaskRichTextEditor
          key={`${task.id}:${descriptionRevision}`}
          ref={editorRef}
          attachmentContext={{ workspaceId: task.workspace_id, taskId: task.id }}
          attachmentService={attachmentService}
          immersive={immersive}
          initialMarkdown={descriptionSeed ?? task.description}
          online={writable}
          onImmersiveChange={setImmersive}
          onSave={(description) => onUpdate({ description })}
          toolbarHost={toolbarHost}
          toolbarOpen={toolbarOpen}
        />
        {task.kind !== "note" && showSubtasks && (
          <section className="detail-section">
            <div className="detail-section-title">
              <span>子任务</span>
              <em>{task.subtasks.filter((item) => item.completed).length}/{task.subtasks.length}</em>
            </div>
            <div className="subtask-list">
              {task.subtasks.map((subtask) => (
                <div
                  className={clsx("subtask-row", editingSubtaskId === subtask.id && "editing")}
                  key={subtask.id}
                >
                  <input
                    type="checkbox"
                    aria-label={`完成子任务：${subtask.title}`}
                    checked={subtask.completed}
                    disabled={!writable}
                    onChange={(event) => void onToggleSubtask(subtask.id, event.target.checked).catch(() => {})}
                  />
                  {editingSubtaskId === subtask.id ? (
                    <input
                      ref={editingSubtaskInputRef}
                      className="subtask-title-input"
                      value={editingSubtaskTitle}
                      disabled={!writable}
                      aria-label={`编辑子任务：${subtask.title}`}
                      onChange={(event) => setEditingSubtaskTitle(event.target.value)}
                      onBlur={() => commitEditSubtask()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitEditSubtask();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          cancelEditSubtask();
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className={clsx("subtask-title", subtask.completed && "completed")}
                      disabled={!writable}
                      onClick={() => beginEditSubtask(subtask)}
                    >
                      {subtask.title}
                    </button>
                  )}
                  <div className="subtask-actions">
                    <TaskAssigneeControl
                      task={task}
                      bundle={bundle}
                      currentUserId={currentUserId}
                      aiWorkSettings={aiWorkSettings}
                      online={writable}
                      onAssign={(target) => handleAssignSubtask(subtask.id, target)}
                      target={subtaskAssigneeTarget(subtask)}
                      compact
                    />
                    <SubtaskDueDateControl
                      dueAt={subtask.due_at}
                      completed={subtask.completed}
                      online={writable}
                      onSave={(dueAt) => onUpdateSubtask(subtask.id, { due_at: dueAt })}
                    />
                    {desktopAiAvailable && subtask.cli_assignee && (
                      <button
                        type="button"
                        className="subtask-terminal-trigger"
                        aria-label={`打开 ${aiCliLabel(subtask.cli_assignee)} 终端：${subtask.title}`}
                        title={`打开 ${aiCliLabel(subtask.cli_assignee)} 终端`}
                        onClick={() => void showSubtaskTerminal(subtask)}
                      >
                        <SquareTerminal />
                      </button>
                    )}
                    <button
                      type="button"
                      className="subtask-delete"
                      aria-label={`删除子任务：${subtask.title}`}
                      disabled={!writable}
                      onClick={() => void onDeleteSubtask(subtask.id)}
                    >
                      <Trash2 />
                    </button>
                  </div>
                </div>
              ))}
              <form
                className={clsx(
                  "subtask-add",
                  (
                    Boolean(subtaskTokens.title.trim())
                    || Boolean(draftSubtaskDueAt)
                    || draftSubtaskAssignee.kind !== "none"
                  ) && "has-draft",
                )}
                onSubmit={(event) => {
                  event.preventDefault();
                  void commitDraftSubtask().catch(() => undefined);
                }}
                onBlur={handleDraftSubtaskFormBlur}
              >
                <span
                  className="subtask-add-check"
                  aria-hidden="true"
                  onClick={() => subtaskInputRef.current?.focus()}
                />
                <div className="subtask-add-field task-title-token-field">
                  <input
                    ref={subtaskInputRef}
                    value={subtaskTokens.title}
                    onChange={subtaskTokens.handleChange}
                    onKeyDown={(event) => {
                      if (subtaskTokens.handleKeyDown(event)) return;
                    }}
                    placeholder="回车添加下一项"
                    disabled={!writable}
                    aria-label="添加子任务"
                  />
                  {subtaskTokens.token && (
                    <TaskTitleTokenMenu
                      kind={subtaskTokens.token.kind}
                      assigneeCandidates={subtaskTokens.assigneeCandidates}
                      labelCandidates={subtaskTokens.labelCandidates}
                      activeIndex={subtaskTokens.activeIndex}
                      onSelectAssignee={(member) => {
                        setDraftSubtaskCli(null);
                        subtaskTokens.selectAssignee(member);
                      }}
                      onSelectLabel={subtaskTokens.selectLabel}
                    />
                  )}
                </div>
                <div className="subtask-actions">
                  <TaskAssigneeControl
                    task={task}
                    bundle={bundle}
                    currentUserId={currentUserId}
                    aiWorkSettings={aiWorkSettings}
                    online={writable}
                    onAssign={async (target) => {
                      if (target.kind === "cli") {
                        setDraftSubtaskCli(target.tool);
                        subtaskTokens.setAssigneeId(null);
                        return;
                      }
                      setDraftSubtaskCli(null);
                      subtaskTokens.setAssigneeId(
                        target.kind === "user" ? target.userId : null,
                      );
                    }}
                    target={draftSubtaskAssignee}
                    compact
                  />
                  <SubtaskDueDateControl
                    dueAt={draftSubtaskDueAt}
                    online={writable}
                    onSave={(dueAt) => {
                      setDraftSubtaskDueAt(dueAt);
                    }}
                  />
                </div>
              </form>
            </div>
          </section>
        )}
        {activityOpen && (
          <TaskActivity
            task={task}
            members={bundle.members}
            preferences={dateTimePreferences}
            revision={activityRevision}
            onLoad={onLoadActivity}
            onClose={() => setActivityOpen(false)}
          />
        )}
          </>
        )}
      </div>
      {!activeTerminal && !immersive && !activityOpen && (comments.length > 0 || commentComposerOpen) && (
        <TaskComments
          task={task}
          comments={comments}
          members={bundle.members}
          currentUserId={currentUserId}
          online={writable}
          attachmentService={attachmentService}
          showComposer={commentComposerOpen}
          onLoadCandidates={onLoadCommentCandidates}
          onCreate={async (input) => {
            await onCreateComment(input);
            setComments(await onLoadComments());
          }}
          onUpdate={async (comment, input) => {
            await onUpdateComment(comment, input);
            setComments(await onLoadComments());
          }}
          onDelete={async (comment) => {
            await onDeleteComment(comment);
            setComments((current) => current.filter((item) => item.id !== comment.id));
          }}
        />
      )}
      <div
        ref={setToolbarHost}
        className={clsx("detail-editor-toolbar-dock", !activeTerminal && toolbarOpen && "open")}
      />
      {!activeTerminal && !immersive && !activityOpen && hoursLabel && (
        <p className="detail-hours">{hoursLabel}</p>
      )}
      <footer className="detail-footer">
        <TaskLabelControl
          task={task}
          bundle={bundle}
          online={writable}
          onToggleLabel={onToggleLabel}
        />
        <TaskParticipantsControl
          task={task}
          bundle={bundle}
          currentUserId={currentUserId}
          online={writable}
          onToggleParticipant={onToggleParticipant}
        />
        {!activeTerminal && (
          <>
        <button
          className={clsx("detail-text-style-trigger", toolbarOpen && "active")}
          type="button"
          title="文本样式"
          aria-label="文本样式"
          aria-expanded={toolbarOpen}
          onClick={() => setToolbarOpen((open) => !open)}
        >
          <Type />
        </button>
        <button
          className={clsx("detail-comment-trigger", commentComposerOpen && "active")}
          type="button"
          title="评论"
          aria-label="评论"
          aria-expanded={commentComposerOpen}
          onClick={() => {
            setToolbarOpen(false);
            setActivityOpen(false);
            setCommentComposerOpen((open) => !open);
          }}
        >
          <MessageCircle />
        </button>
          </>
        )}
        <button
          type="button"
          title={task.deleted_at ? "还原" : "移至回收站"}
          aria-label={task.deleted_at ? "还原" : "移至回收站"}
          disabled={!writable}
          onClick={() => void onUpdate({
            deleted_at: task.deleted_at ? null : new Date().toISOString(),
          })}
        >
          {task.deleted_at ? <RotateCcw /> : <Trash2 />}
        </button>
      </footer>
    </div>
  );
});

export function TaskDetailPanel(props: TaskDetailProps) {
  return <TaskDetailContent {...props} presentation="panel" />;
}

export function TaskDetailDialog(props: TaskDetailProps & { open: boolean }) {
  const contentRef = useRef<TaskDetailContentHandle>(null);
  return (
    <Dialog.Root open={props.open}>
      <Dialog.Portal>
        <Dialog.Overlay className="task-detail-dialog-overlay" />
        <Dialog.Content
          className="task-detail-dialog"
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            if (document.querySelector(
              ".due-popover, .priority-menu, .task-more-menu, .ai-smart-process-menu, .ai-subtask-suggest-panel, .ai-format-suggest-panel, .task-detail-dialog .task-assignee-menu, .task-detail-dialog .task-label-menu, .task-detail-dialog .task-activity, .task-detail-dialog .rich-editor-immersive, .task-detail-dialog .rich-toolbar-more[open]",
            )) return;
            void contentRef.current?.close();
          }}
          onPointerDownOutside={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest(".due-popover, .priority-menu, .task-more-menu, .ai-smart-process-menu, .ai-subtask-suggest-panel, .ai-format-suggest-panel")) {
              event.preventDefault();
              return;
            }
            event.preventDefault();
            void contentRef.current?.close();
          }}
          onFocusOutside={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest(".due-popover, .priority-menu, .task-more-menu, .ai-smart-process-menu, .ai-subtask-suggest-panel, .ai-format-suggest-panel")) {
              event.preventDefault();
            }
          }}
          onInteractOutside={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest(".due-popover, .priority-menu, .task-more-menu, .ai-smart-process-menu, .ai-subtask-suggest-panel, .ai-format-suggest-panel")) {
              event.preventDefault();
            }
          }}
        >
          <Dialog.Title className="sr-only">
            {props.task.kind === "note" ? "笔记详情" : "任务详情"}：{props.task.title}
          </Dialog.Title>
          <TaskDetailContent ref={contentRef} {...props} presentation="dialog" />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
