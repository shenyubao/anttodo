import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import {
  CalendarDays,
  Check,
  Ellipsis,
  History,
  Inbox,
  ListTodo,
  MessageCircle,
  NotebookPen,
  Plus,
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
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { DueDateControl } from "./DueDateControl";
import { MemberAvatar } from "./MemberAvatar";
import { PriorityControl } from "./PriorityControl";
import { TaskComments, type CreateCommentInput } from "./TaskComments";
import { TaskActivity } from "./TaskActivity";
import {
  TaskRichTextEditor,
  type TaskRichTextEditorHandle,
} from "./TaskRichTextEditor";
import type { AttachmentService } from "./lib/attachments";
import { getAssignableMembers } from "./lib/taskAssignment";
import type {
  DateTimePreferences,
  ReminderSchedule,
  Subtask,
  Task,
  TaskActivityPage,
  TaskComment,
  WorkspaceBundle,
} from "./types";

export type TaskDetailProps = {
  task: Task;
  bundle: WorkspaceBundle;
  currentUserId: string;
  online: boolean;
  editable: boolean;
  attachmentService: AttachmentService;
  now: Date;
  dateTimePreferences: DateTimePreferences;
  onClose: () => void;
  onUpdate: (patch: Partial<Task>) => Promise<void>;
  onSaveSchedule: (
    patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
    schedule: ReminderSchedule,
  ) => Promise<void>;
  onLoadAssignees: () => Promise<string[]>;
  onAssign: (assigneeId: string | null) => Promise<void>;
  onToggleLabel: (taskId: string, labelId: string, selected: boolean) => Promise<void>;
  onToggleParticipant: (taskId: string, userId: string, selected: boolean) => Promise<void>;
  onCreateSubtask: (title: string) => Promise<void>;
  onToggleSubtask: (subtaskId: string, completed: boolean) => Promise<void>;
  onUpdateSubtask: (
    subtaskId: string,
    patch: Partial<Pick<Subtask, "due_at" | "assignee_id">>,
  ) => Promise<void>;
  onDeleteSubtask: (subtaskId: string) => Promise<void>;
  commentsRevision: number;
  activityRevision: number;
  onLoadActivity: (cursor?: TaskActivityPage["nextCursor"]) => Promise<TaskActivityPage>;
  onLoadComments: () => Promise<TaskComment[]>;
  onLoadCommentCandidates: () => Promise<string[]>;
  onCreateComment: (input: CreateCommentInput) => Promise<void>;
  onUpdateComment: (comment: TaskComment, input: CreateCommentInput) => Promise<void>;
  onDeleteComment: (comment: TaskComment) => Promise<void>;
};

function TaskAssigneeControl({
  task,
  bundle,
  currentUserId,
  online,
  onLoad,
  onAssign,
  assigneeId = task.assignee_id,
  compact = false,
}: {
  task: Task;
  bundle: WorkspaceBundle;
  currentUserId: string;
  online: boolean;
  onLoad: () => Promise<string[]>;
  onAssign: (assigneeId: string | null) => Promise<void>;
  assigneeId?: string | null;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [candidateIds, setCandidateIds] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const onLoadRef = useRef(onLoad);
  const assignee = bundle.members.find((member) => member.user_id === assigneeId);
  const candidates = useMemo(
    () => getAssignableMembers(bundle, task, currentUserId, candidateIds ?? []),
    [bundle, candidateIds, currentUserId, task],
  );

  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);

  useEffect(() => {
    setOpen(false);
    setCandidateIds(null);
    setError("");
  }, [task.id]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void onLoadRef.current()
      .then((ids) => {
        if (!cancelled) setCandidateIds(ids);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "负责人列表加载失败，请重试");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, task.id]);

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

  async function choose(nextAssigneeId: string | null) {
    if (saving || !online) return;
    if (assigneeId === nextAssigneeId) {
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onAssign(nextAssigneeId);
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

  const assigneeName = assignee?.profile?.display_name ?? "未指派";
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
        {assignee ? (
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
            aria-checked={assigneeId === null}
            disabled={saving}
            onClick={() => void choose(null)}
          >
            <UserRound className="assignee-none-icon" />
            <span>不指派</span>
            <Check className="assignee-selected-icon" />
          </button>
          {loading && <p className="task-assignee-status" role="status">正在读取成员…</p>}
          {!loading && candidates.map((member) => (
            <button
              key={member.user_id}
              type="button"
              role="menuitemradio"
              aria-checked={assigneeId === member.user_id}
              disabled={saving}
              onClick={() => void choose(member.user_id)}
            >
              <MemberAvatar member={member} className="assignee-menu-avatar" />
              <span>{member.user_id === currentUserId ? "我" : member.profile?.display_name ?? "团队成员"}</span>
              <Check className="assignee-selected-icon" />
            </button>
          ))}
          {!loading && candidateIds && candidates.length === 0 && (
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
  onLoadAssignees,
  onToggleParticipant,
}: {
  task: Task;
  bundle: WorkspaceBundle;
  currentUserId: string;
  online: boolean;
  onLoadAssignees: () => Promise<string[]>;
  onToggleParticipant: (taskId: string, userId: string, selected: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [candidateIds, setCandidateIds] = useState<string[] | null>(null);
  const [draftParticipantIds, setDraftParticipantIds] = useState(
    () => new Set(task.participant_ids),
  );
  const [loading, setLoading] = useState(false);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const onLoadRef = useRef(onLoadAssignees);

  useEffect(() => {
    onLoadRef.current = onLoadAssignees;
  }, [onLoadAssignees]);

  useEffect(() => {
    setDraftParticipantIds(new Set(task.participant_ids));
  }, [task.id, task.participant_ids]);

  useEffect(() => {
    setOpen(false);
    setCandidateIds(null);
    setError("");
  }, [task.id]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void onLoadRef.current()
      .then((ids) => {
        if (!cancelled) setCandidateIds(ids);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "参与者列表加载失败，请重试");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, task.id]);

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
    () => getAssignableMembers(bundle, task, currentUserId, candidateIds ?? []),
    [bundle, candidateIds, currentUserId, task],
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
          {loading && <p className="task-participants-status" role="status">正在读取成员…</p>}
          {!loading && menuMembers.map((member) => {
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
          {!loading && candidateIds && menuMembers.length === 0 && (
            <p className="task-participants-status">暂无可选成员</p>
          )}
          {error && <p className="task-participants-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

function SubtaskDueDateControl({
  subtask,
  online,
  onSave,
}: {
  subtask: Subtask;
  online: boolean;
  onSave: (dueAt: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const initial = subtask.due_at ? new Date(subtask.due_at) : new Date();
    const offset = initial.getTimezoneOffset() * 60_000;
    setDate(new Date(initial.getTime() - offset).toISOString().slice(0, 10));
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, subtask.due_at]);

  const dueDate = subtask.due_at ? new Date(subtask.due_at) : null;
  const formatted = dueDate
    ? `${dueDate.getMonth() + 1}月${dueDate.getDate()}日`
    : "";
  const overdue = Boolean(
    subtask.due_at
    && !subtask.completed
    && new Date(subtask.due_at).getTime() < Date.now(),
  );

  async function save(value: string | null) {
    setSaving(true);
    try {
      const dueAt = value
        ? new Date(`${value}T23:59:59.999`).toISOString()
        : null;
      await onSave(dueAt);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="subtask-date-control" ref={rootRef}>
      <button
        type="button"
        className={clsx("subtask-date-trigger", subtask.due_at && "has-date", overdue && "overdue")}
        aria-label={subtask.due_at ? `截止时间：${formatted}` : "设置子任务截止时间"}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!online || saving}
        onClick={() => setOpen((value) => !value)}
      >
        <CalendarDays />
        {formatted && <span>{formatted}</span>}
      </button>
      {open && (
        <div className="subtask-date-popover" role="dialog" aria-label="设置子任务截止时间">
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
        </div>
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
  const orderedLabels = [...bundle.labels].sort(
    (left, right) => left.position - right.position || left.name.localeCompare(right.name, "zh-CN"),
  );

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

function TaskMoreMenu({
  task,
  online,
  onUpdate,
  onShowActivity,
}: Pick<TaskDetailProps, "task" | "online" | "onUpdate"> & {
  onShowActivity: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setOpen(false);
    setError("");
  }, [task.id]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });
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
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

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
      {open && (
        <div className="task-more-menu" role="menu" aria-label="更多操作">
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
            onClick={() => void switchKind()}
          >
            {task.kind === "note" ? <ListTodo /> : <NotebookPen />}
            <span>{task.kind === "note" ? "切换为待办" : "切换为笔记"}</span>
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
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
  onClose,
  onUpdate,
  onSaveSchedule,
  onLoadAssignees,
  onAssign,
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
  const [draftTitle, setDraftTitle] = useState(task.title);
  const [newSubtask, setNewSubtask] = useState("");
  const [subtasksOpen, setSubtasksOpen] = useState(task.subtasks.length > 0);
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [immersive, setImmersive] = useState(false);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentComposerOpen, setCommentComposerOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const editorRef = useRef<TaskRichTextEditorHandle>(null);
  const closingRef = useRef(false);
  const writable = online && editable;

  useEffect(() => setDraftTitle(task.title), [task.id, task.title]);
  useEffect(() => {
    setImmersive(false);
    setSubtasksOpen(task.subtasks.length > 0);
    setNewSubtask("");
    setToolbarOpen(false);
    setActivityOpen(false);
    setCommentComposerOpen(false);
  }, [task.id]);
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
    void onLoadComments()
      .then((items) => {
        if (!cancelled) setComments(items);
      });
    return () => { cancelled = true; };
  }, [commentsRevision, onLoadComments, task.id]);

  function scheduleSave(patch: Partial<Task>) {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (writable) void onUpdate(patch);
    }, 500);
  }

  async function closeDetail() {
    if (closingRef.current) return;
    closingRef.current = true;
    window.clearTimeout(saveTimer.current);
    if (writable && draftTitle !== task.title) {
      await onUpdate({ title: draftTitle }).catch(() => undefined);
    }
    await editorRef.current?.flush().catch(() => undefined);
    onClose();
  }

  useImperativeHandle(forwardedRef, () => ({ close: closeDetail }));

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

  return (
    <div className={clsx("task-detail", `task-detail-${presentation}`, immersive && "rich-editor-immersive")}>
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
        <TaskAssigneeControl
          task={task}
          bundle={bundle}
          currentUserId={currentUserId}
          online={writable}
          onLoad={onLoadAssignees}
          onAssign={onAssign}
        />
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
            setCommentComposerOpen(false);
            setActivityOpen(true);
          }}
        />
      </header>
      <div className="detail-body">
        <div className="detail-caption">
          <textarea
            className="detail-title"
            value={draftTitle}
            disabled={!writable}
            aria-label={task.kind === "note" ? "笔记标题" : "任务标题"}
            onChange={(event) => {
              setDraftTitle(event.target.value);
              scheduleSave({ title: event.target.value });
            }}
            rows={2}
          />
          {task.kind !== "note" && (
            <button
              className={clsx("switch-mode", subtasksOpen && "active")}
              type="button"
              title={subtasksOpen ? "收起子任务" : "展开子任务"}
              aria-label={subtasksOpen ? "收起子任务" : "展开子任务"}
              aria-expanded={subtasksOpen}
              onClick={() => setSubtasksOpen((open) => !open)}
            >
              <ListTodo />
            </button>
          )}
        </div>
        <TaskRichTextEditor
          key={task.id}
          ref={editorRef}
          attachmentContext={{ workspaceId: task.workspace_id, taskId: task.id }}
          attachmentService={attachmentService}
          immersive={immersive}
          initialMarkdown={task.description}
          online={writable}
          onImmersiveChange={setImmersive}
          onSave={(description) => onUpdate({ description })}
          toolbarHost={toolbarHost}
          toolbarOpen={toolbarOpen}
        />
        {task.kind !== "note" && subtasksOpen && (
          <section className="detail-section">
            <div className="detail-section-title">
              <span>子任务</span>
              <em>{task.subtasks.filter((item) => item.completed).length}/{task.subtasks.length}</em>
            </div>
            <div className="subtask-list">
            {task.subtasks.map((subtask) => (
              <div className="subtask-row" key={subtask.id}>
                <input
                  type="checkbox"
                  aria-label={`完成子任务：${subtask.title}`}
                  checked={subtask.completed}
                  disabled={!writable}
                  onChange={(event) => void onToggleSubtask(subtask.id, event.target.checked)}
                />
                <span className={clsx("subtask-title", subtask.completed && "completed")}>{subtask.title}</span>
                <div className="subtask-actions">
                  <TaskAssigneeControl
                    task={task}
                    bundle={bundle}
                    currentUserId={currentUserId}
                    online={writable}
                    onLoad={onLoadAssignees}
                    onAssign={(assigneeId) => onUpdateSubtask(subtask.id, { assignee_id: assigneeId })}
                    assigneeId={subtask.assignee_id}
                    compact
                  />
                  <SubtaskDueDateControl
                    subtask={subtask}
                    online={writable}
                    onSave={(dueAt) => onUpdateSubtask(subtask.id, { due_at: dueAt })}
                  />
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
            </div>
            <form
              className="subtask-add"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!newSubtask.trim() || !writable) return;
                await onCreateSubtask(newSubtask.trim());
                setNewSubtask("");
              }}
            >
              <Plus />
              <input
                value={newSubtask}
                onChange={(event) => setNewSubtask(event.target.value)}
                placeholder="添加子任务"
                disabled={!writable}
              />
            </form>
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
      </div>
      {!immersive && !activityOpen && (comments.length > 0 || commentComposerOpen) && (
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
      <div ref={setToolbarHost} className={clsx("detail-editor-toolbar-dock", toolbarOpen && "open")} />
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
          onLoadAssignees={onLoadAssignees}
          onToggleParticipant={onToggleParticipant}
        />
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
        <button
          type="button"
          title="移至垃圾桶"
          aria-label="移至垃圾桶"
          disabled={!writable}
          onClick={() => void onUpdate({ deleted_at: new Date().toISOString() })}
        >
          <Trash2 />
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
              ".due-popover, .task-detail-dialog .priority-menu, .task-detail-dialog .task-assignee-menu, .task-detail-dialog .task-label-menu, .task-detail-dialog .task-more-menu, .task-detail-dialog .task-activity, .task-detail-dialog .rich-editor-immersive, .task-detail-dialog .rich-toolbar-more[open]",
            )) return;
            void contentRef.current?.close();
          }}
          onPointerDownOutside={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest(".due-popover")) {
              event.preventDefault();
              return;
            }
            event.preventDefault();
            void contentRef.current?.close();
          }}
          onFocusOutside={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest(".due-popover")) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest(".due-popover")) event.preventDefault();
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
