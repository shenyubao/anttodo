import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Ellipsis,
  Flag,
  GitFork,
  History,
  Inbox,
  Link2,
  ListTodo,
  MessageCircle,
  NotebookPen,
  RotateCcw,
  Search,
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
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { shouldDismissTaskDetailOnPointerDown } from "./lib/taskDetailDismiss";
import { DueDateControl, dueTargetFromChildTask } from "./DueDateControl";
import { TaskDependencyList } from "./TaskDependencyList";
import { FocusTaskPicker } from "./FocusTaskPicker";
import { AiCliAvatar } from "./AiCliAvatar";
import { MemberAvatar } from "./MemberAvatar";
import { getPriorityOption, PRIORITY_OPTIONS, PriorityControl } from "./PriorityControl";
import { TaskComments, type CreateCommentInput } from "./TaskComments";
import { TaskActivity } from "./TaskActivity";
import { TaskCliTerminal } from "./TaskCliTerminal";
import { FLUSH_PENDING_EDITS_EVENT, useShortcutHandler } from "./ShortcutProvider";
import {
  TaskRichTextEditor,
  type TaskRichTextEditorHandle,
} from "./TaskRichTextEditor";
import type { AttachmentService } from "./lib/attachments";
import {
  buildFormattedDescription,
  buildChildTaskExtrasFromSuggestion,
  formatAiSuggestedDueAt,
  isMidnightLocalDueAt,
  type AiFormatSuggestion,
  type AiSuggestedTask,
} from "./lib/aiTaskDecompose";
import { decomposeTask, formatTaskWithAi } from "./lib/api";
import { taskShareUrl } from "./lib/appRoute";
import { formatDueWithPreferences, systemTimeZone, toDateInput } from "./lib/dateTimePreferences";
import { supabase } from "./lib/supabase";
import { getAssignableMembers } from "./lib/taskAssignment";
import { orderedLabels as orderedLabelsTree } from "./lib/taskList";
import {
  dependencyTargetKey,
  filterPickerTasksForDependency,
  listItemDependencies,
} from "./lib/taskDependencies";
import {
  ancestorChain,
  canAddChild,
  childrenOf,
  indentTaskPatch,
  outdentTaskPatch,
  taskCollectionProgress,
  visibleFlattenedTasks,
} from "./lib/taskTree";
import { TaskTitleTokenMenu } from "./TaskTitleTokenMenu";
import { useTaskTitleTokens } from "./useTaskTitleTokens";
import {
  aiCliLabel,
  buildChildTaskCliPrompt,
  buildTaskCliPrompt,
  isAiWorkConfigured,
  requestAiWorkSettings,
  sameAssignee,
  taskAssigneeTarget,
  taskTerminalSessionKey,
} from "./lib/aiWork";
import { trackAiTerminalSession, untrackAiTerminalSession } from "./lib/aiTerminalSessions";
import {
  formatContactDisplayName,
  useShowContactNames,
} from "./lib/displayPreference";
import {
  formatHoursDetail,
  formatHoursValue,
  formatPomodorosValue,
  hoursFromPomodoros,
  normalizeHoursInput,
  normalizePomodorosInput,
  sumHours,
} from "./lib/taskHours";
import {
  MOBILE_TASK_DETAIL_MEDIA,
  mobileTaskDetailRatioFromTranslateY,
  mobileTaskDetailSnapRatio,
  mobileTaskDetailTranslateY,
  resolveMobileTaskDetailRelease,
  type MobileTaskDetailSnap,
} from "./lib/mobileTaskDetailSheet";
import type {
  AiCliTool,
  AiFeatureSettings,
  AiWorkSettings,
  AssigneeTarget,
  DateTimePreferences,
  Member,
  ReminderSchedule,
  Task,
  TaskActivityPage,
  TaskComment,
  TaskDependencyTarget,
  WorkspaceBundle,
} from "./types";

const DETAIL_CHILD_TASKS_VISIBLE_KEY = "anttodo:detail-children-visible";

function readDetailChildTasksVisible() {
  try {
    return window.localStorage.getItem(DETAIL_CHILD_TASKS_VISIBLE_KEY) !== "0";
  } catch {
    return true;
  }
}

function storeDetailChildTasksVisible(visible: boolean) {
  try {
    window.localStorage.setItem(DETAIL_CHILD_TASKS_VISIBLE_KEY, visible ? "1" : "0");
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
  pomodoroMinutes: number;
  aiFeatureSettings: AiFeatureSettings;
  aiWorkSettings: AiWorkSettings;
  settingsLabelName?: string | null;
  onClose: () => void;
  onOpenTask?: (taskId: string) => void;
  onUpdate: (
    patch: Partial<Task>,
    options?: { mentionedUserIds?: string[] },
  ) => Promise<void>;
  onSaveSchedule: (
    patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
    schedule: ReminderSchedule,
  ) => Promise<void>;
  onSaveChildTaskSchedule: (
    targetTaskId: string,
    patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
    schedule: ReminderSchedule,
  ) => Promise<void>;
  onAssign: (target: AssigneeTarget) => Promise<void>;
  onAssignChildTask: (targetTaskId: string, target: AssigneeTarget) => Promise<void>;
  onToggleLabel: (taskId: string, labelId: string, selected: boolean) => Promise<void>;
  onToggleParticipant: (taskId: string, userId: string, selected: boolean) => Promise<void>;
  onCreateChildTask: (
    title: string,
    extras?: Partial<Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone" | "assignee_id" | "cli_assignee" | "priority" | "parent_task_id">>,
  ) => Promise<void>;
  onToggleChildTask: (targetTaskId: string, completed: boolean) => Promise<void>;
  onUpdateChildTask: (
    targetTaskId: string,
    patch: Partial<Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone" | "title" | "description" | "estimate_hours" | "actual_hours" | "estimate_pomodoros" | "actual_pomodoros" | "priority" | "parent_task_id" | "position">>,
  ) => Promise<void>;
  onDeleteChildTask: (targetTaskId: string) => Promise<void>;
  onAddDependencies: (taskId: string, targets: TaskDependencyTarget[]) => Promise<void>;
  onRemoveDependency: (dependencyId: string) => Promise<void>;
  onOpenDependency: (taskId: string) => void;
  commentsRevision: number;
  activityRevision: number;
  onLoadActivity: (cursor?: TaskActivityPage["nextCursor"]) => Promise<TaskActivityPage>;
  onLoadComments: (taskId: string) => Promise<TaskComment[]>;
  onLoadCommentCandidates: () => Promise<string[]>;
  onCreateComment: (
    taskId: string,
    input: CreateCommentInput,
  ) => Promise<void>;
  onUpdateComment: (comment: TaskComment, input: CreateCommentInput) => Promise<void>;
  onDeleteComment: (comment: TaskComment) => Promise<void>;
  onNotice?: (message: string) => void;
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
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const showContactNames = useShowContactNames();
  const assignee = target.kind === "user"
    ? bundle.members.find((member) => member.user_id === target.userId)
    : undefined;
  const cliTools = window.anttodoDesktop?.aiWork ? aiWorkSettings.cli_tools : [];
  // Local member cache filtered by the task's current label ACLs / groups.
  const candidates = useMemo(
    () => getAssignableMembers(bundle, task, currentUserId),
    [bundle, currentUserId, task],
  );
  const needle = query.trim().toLowerCase();
  const matchesQuery = (labels: string[]) =>
    !needle || labels.some((label) => label.toLowerCase().includes(needle));
  const showUnassigned = matchesQuery(["不指派"]);
  const filteredCliTools = cliTools.filter((tool) => matchesQuery([aiCliLabel(tool), tool]));
  const filteredCandidates = candidates.filter((member) => {
    const displayName = member.profile?.display_name ?? "团队成员";
    const labels = member.user_id === currentUserId
      ? [displayName, "我"]
      : [displayName];
    return matchesQuery(labels);
  });
  const pinnedCandidate = target.kind === "user"
    ? filteredCandidates.find((member) => member.user_id === target.userId)
    : undefined;
  const restCandidates = pinnedCandidate
    ? filteredCandidates.filter((member) => member.user_id !== pinnedCandidate.user_id)
    : filteredCandidates;
  const hasMatches = showUnassigned || filteredCliTools.length > 0 || filteredCandidates.length > 0;

  useEffect(() => {
    setOpen(false);
    setError("");
  }, [task.id]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      searchRef.current?.focus();
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
  const showAssigneeName = showContactNames && Boolean(assignee);

  function renderMemberOption(member: (typeof candidates)[number]) {
    return (
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
    );
  }

  return (
    <div
      className={clsx(
        "task-assignee-control",
        compact && "childTask-assignee-control",
        showAssigneeName && "has-contact-name",
      )}
      ref={rootRef}
    >
      <button
        ref={triggerRef}
        type="button"
        className={clsx(
          "task-assignee-trigger",
          open && "active",
          showAssigneeName && "has-contact-name",
        )}
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
        {showAssigneeName && assignee ? (
          <span className="task-assignee-name">
            {formatContactDisplayName(assignee.profile?.display_name ?? "团队成员")}
          </span>
        ) : null}
      </button>
      {open && (
        <div
          className="task-assignee-menu"
          role="menu"
          aria-label="选择负责人"
          onKeyDown={moveMenuFocus}
        >
          <label className="task-assignee-search">
            <Search aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="搜索"
              aria-label="搜索负责人"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Escape") {
                  return;
                }
                event.stopPropagation();
              }}
            />
          </label>
          <div className="task-assignee-menu-list">
            {showUnassigned && (
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
            )}
            {pinnedCandidate && renderMemberOption(pinnedCandidate)}
            {filteredCliTools.map((tool) => (
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
            {filteredCliTools.length > 0 && <div className="task-assignee-divider" aria-hidden="true" />}
            {restCandidates.map((member) => renderMemberOption(member))}
            {!needle && candidates.length === 0 && (
              <p className="task-assignee-status">暂无可指派成员</p>
            )}
            {needle && !hasMatches && (
              <p className="task-assignee-status">未找到匹配成员</p>
            )}
            {error && <p className="task-assignee-error" role="alert">{error}</p>}
          </div>
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
  estimatePomodoros,
  actualPomodoros,
  pomodoroMinutes,
  resetKey,
  online,
  onOpenChange,
  onUpdate,
}: {
  open: boolean;
  estimateHours: number | null;
  actualHours: number | null;
  estimatePomodoros: number | null;
  actualPomodoros: number | null;
  pomodoroMinutes: number;
  resetKey: string;
  online: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (patch: {
    estimate_hours: number | null;
    actual_hours: number | null;
    estimate_pomodoros: number | null;
    actual_pomodoros: number | null;
  }) => Promise<void>;
}) {
  const [estimate, setEstimate] = useState("");
  const [actual, setActual] = useState("");
  const [unit, setUnit] = useState<"hours" | "pomodoros">("hours");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setEstimate(estimateHours == null ? "" : formatHoursValue(estimateHours));
    setActual(actualHours == null ? "" : formatHoursValue(actualHours));
    setUnit("hours");
    setSaving(false);
    setError("");
  }, [open, actualHours, estimateHours, resetKey]);

  function changeUnit(nextUnit: "hours" | "pomodoros") {
    setUnit(nextUnit);
    if (nextUnit === "hours") {
      setEstimate(estimateHours == null ? "" : formatHoursValue(estimateHours));
      setActual(actualHours == null ? "" : formatHoursValue(actualHours));
      return;
    }
    setEstimate(
      estimatePomodoros == null ? "" : formatPomodorosValue(estimatePomodoros),
    );
    setActual(
      actualPomodoros == null ? "" : formatPomodorosValue(actualPomodoros),
    );
  }

  async function save() {
    if (!online || saving) return;
    setSaving(true);
    setError("");
    try {
      if (unit === "hours") {
        const nextEstimate = normalizeHoursInput(estimate);
        const nextActual = normalizeHoursInput(actual);
        await onUpdate({
          estimate_hours: nextEstimate,
          actual_hours: nextActual,
          estimate_pomodoros: null,
          actual_pomodoros: null,
        });
      } else {
        const nextEstimate = normalizePomodorosInput(estimate);
        const nextActual = normalizePomodorosInput(actual);
        await onUpdate({
          estimate_hours: nextEstimate == null
            ? null
            : hoursFromPomodoros(nextEstimate, pomodoroMinutes),
          actual_hours: nextActual == null
            ? null
            : hoursFromPomodoros(nextActual, pomodoroMinutes),
          estimate_pomodoros: nextEstimate,
          actual_pomodoros: nextActual,
        });
      }
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
            <div className="task-hours-unit">
              <span>单位</span>
              <select
                value={unit}
                disabled={!online || saving}
                onChange={(event) => changeUnit(event.target.value as "hours" | "pomodoros")}
              >
                <option value="hours">小时</option>
                <option value="pomodoros">番茄数</option>
              </select>
            </div>
            <label>
              <span>预计工时</span>
              <div className="task-hours-field">
                <input
                  type="number"
                  inputMode={unit === "hours" ? "decimal" : "numeric"}
                  min={0}
                  step={unit === "hours" ? 0.1 : 1}
                  value={estimate}
                  disabled={!online || saving}
                  placeholder="可选"
                  onChange={(event) => setEstimate(event.target.value)}
                />
                <em>{unit === "hours" ? "小时" : "番茄"}</em>
              </div>
            </label>
            <label>
              <span>实际工时</span>
              <div className="task-hours-field">
                <input
                  type="number"
                  inputMode={unit === "hours" ? "decimal" : "numeric"}
                  min={0}
                  step={unit === "hours" ? 0.1 : 1}
                  value={actual}
                  disabled={!online || saving}
                  placeholder="可选"
                  onChange={(event) => setActual(event.target.value)}
                />
                <em>{unit === "hours" ? "小时" : "番茄"}</em>
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
  pomodoroMinutes,
  onUpdate,
  onShowActivity,
  onNotice,
  onMountDependencies,
}: Pick<TaskDetailProps, "task" | "online" | "pomodoroMinutes" | "onUpdate" | "onNotice"> & {
  onShowActivity: () => void;
  onMountDependencies?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useShortcutHandler("task.logHours", () => {
    if (!online) return false;
    setHoursOpen(true);
  });

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

  async function copyLink() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await navigator.clipboard.writeText(taskShareUrl(task.workspace_id, task));
      setOpen(false);
      triggerRef.current?.focus();
      onNotice?.("链接已复制");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "复制链接失败，请检查剪贴板权限");
    } finally {
      setSaving(false);
    }
  }

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
            disabled={saving}
            onClick={() => void copyLink()}
          >
            <Link2 />
            <span>复制链接</span>
          </button>
          {task.kind !== "note" && onMountDependencies && (
            <button
              type="button"
              role="menuitem"
              disabled={!online || saving}
              onClick={() => {
                setOpen(false);
                onMountDependencies();
              }}
            >
              <GitFork />
              <span>挂载依赖任务</span>
            </button>
          )}
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
        estimatePomodoros={task.estimate_pomodoros}
        actualPomodoros={task.actual_pomodoros}
        pomodoroMinutes={pomodoroMinutes}
        resetKey={task.id}
        online={online}
        onOpenChange={setHoursOpen}
        onUpdate={onUpdate}
      />
    </div>
  );
}

function ChildTaskMoreMenu({
  childTask,
  online,
  pomodoroMinutes,
  compact = false,
  onUpdate,
  onMountDependencies,
}: {
  childTask: Task;
  online: boolean;
  pomodoroMinutes: number;
  compact?: boolean;
  onUpdate: (patch: Partial<Pick<Task, "estimate_hours" | "actual_hours" | "estimate_pomodoros" | "actual_pomodoros" | "priority">>) => Promise<void>;
  onMountDependencies?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const currentPriority = getPriorityOption(childTask.priority ?? "none");

  useEffect(() => {
    setOpen(false);
    setHoursOpen(false);
    setPriorityOpen(false);
  }, [childTask.id]);

  useEffect(() => {
    if (!open) {
      setPriorityOpen(false);
      return;
    }
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
      if (priorityOpen) {
        setPriorityOpen(false);
        return;
      }
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, priorityOpen]);

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
  }, [open, priorityOpen]);

  return (
    <div className={clsx("task-more-control", compact && "childTask-more-control")} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={compact ? "childTask-more-trigger" : undefined}
        aria-label="更多子级任务操作"
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
          aria-label={priorityOpen ? "设置优先级" : "更多操作"}
          style={position}
        >
          {priorityOpen ? PRIORITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitem"
              disabled={!online}
              aria-checked={(childTask.priority ?? "none") === option.value}
              onClick={() => {
                void onUpdate({ priority: option.value });
                setOpen(false);
                setPriorityOpen(false);
              }}
            >
              <Flag style={{ color: option.color }} />
              <span>{option.label}</span>
            </button>
          )) : (
            <>
              <button
                type="button"
                className="has-submenu"
                role="menuitem"
                disabled={!online}
                onClick={() => setPriorityOpen(true)}
              >
                <Flag style={{ color: currentPriority.color }} />
                <span>优先级</span>
                <ChevronRight />
              </button>
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
              {onMountDependencies && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={!online}
                  onClick={() => {
                    setOpen(false);
                    onMountDependencies();
                  }}
                >
                  <GitFork />
                  <span>挂载依赖任务</span>
                </button>
              )}
            </>
          )}
        </div>,
        document.body,
      )}
      <TaskHoursDialog
        open={hoursOpen}
        estimateHours={childTask.estimate_hours}
        actualHours={childTask.actual_hours}
        estimatePomodoros={childTask.estimate_pomodoros}
        actualPomodoros={childTask.actual_pomodoros}
        pomodoroMinutes={pomodoroMinutes}
        resetKey={childTask.id}
        online={online}
        onOpenChange={setHoursOpen}
        onUpdate={async (patch) => {
          await onUpdate(patch);
        }}
      />
    </div>
  );
}

function memberDisplayName(member: Member | undefined) {
  return member?.profile?.display_name?.trim() || "团队成员";
}

type AiSuggestListItem = AiSuggestedTask & { clientKey: string };
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
  aiFeatureSettings,
  online,
  editable,
  onCreateChildTask,
  onEnsureChildTasksVisible,
  onUpdate,
  onSaveSchedule,
  onFormatApplied,
}: {
  task: Task;
  bundle: WorkspaceBundle;
  currentUserId: string;
  aiFeatureSettings: AiFeatureSettings;
  online: boolean;
  editable: boolean;
  onCreateChildTask: (
    title: string,
    extras?: Partial<Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone" | "assignee_id" | "cli_assignee" | "priority" | "parent_task_id">>,
  ) => Promise<void>;
  onEnsureChildTasksVisible?: () => void;
  onUpdate: (
    patch: Partial<Task>,
    options?: { mentionedUserIds?: string[] },
  ) => Promise<void>;
  onSaveSchedule: (
    patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
    schedule: ReminderSchedule,
  ) => Promise<void>;
  onFormatApplied: (title: string, description: string) => void;
}) {
  const writable = editable && (online || Boolean(window.anttodoDesktop?.sync));
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
    const currentFeatureDisabled =
      (panel === "format" && !aiFeatureSettings.smart_format_enabled)
      || (panel === "decompose" && !aiFeatureSettings.task_decompose_enabled)
      || (!aiFeatureSettings.smart_format_enabled
        && !aiFeatureSettings.task_decompose_enabled);
    if (!currentFeatureDisabled) return;
    requestIdRef.current += 1;
    closePanel();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to feature availability
  }, [
    aiFeatureSettings.smart_format_enabled,
    aiFeatureSettings.task_decompose_enabled,
    panel,
  ]);

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
      const result = await decomposeTask(supabase, {
        workspaceId: task.workspace_id,
        taskId: task.id,
        nowIso: new Date().toISOString(),
        timeZone: systemTimeZone(),
        assignableUserIds: assignableIds,
      });
      if (requestId !== requestIdRef.current) return;
      setItems(
        result.tasks.map((item, index) => ({
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
      const extras = buildChildTaskExtrasFromSuggestion(item, assignableIds);
      onEnsureChildTasksVisible?.();
      await onCreateChildTask(item.title, extras);
      const remaining = items.filter((row) => row.clientKey !== item.clientKey);
      setItems(remaining);
      if (remaining.length === 0) closePanel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加子级任务失败");
    } finally {
      setAdding(false);
    }
  }

  async function addAll() {
    if (!writable || adding || loading || items.length === 0) return;
    setAdding(true);
    setError("");
    try {
      onEnsureChildTasksVisible?.();
      for (const item of items) {
        const extras = buildChildTaskExtrasFromSuggestion(item, assignableIds);
        await onCreateChildTask(item.title, extras);
      }
      closePanel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加子级任务失败");
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

  function suggestionMeta(item: AiSuggestedTask) {
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

  if (!aiFeatureSettings.smart_format_enabled
    && !aiFeatureSettings.task_decompose_enabled) {
    return null;
  }

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
          {aiFeatureSettings.smart_format_enabled && (
            <button
              type="button"
              role="menuitem"
              disabled={!writable}
              onClick={() => {
                void requestFormat();
              }}
            >
              <span>格式化待办</span>
              <span className="ai-smart-process-beta">Beta</span>
            </button>
          )}
          {aiFeatureSettings.task_decompose_enabled && (
            <button
              type="button"
              role="menuitem"
              disabled={!writable}
              onClick={() => {
                void requestDecompose();
              }}
            >
              <span>智能分解子级任务</span>
              <span className="ai-smart-process-beta">Beta</span>
            </button>
          )}
        </div>,
        document.body,
      )}
      {panel === "decompose" && createPortal(
        <div
          ref={panelRef}
          className="ai-childTask-suggest-panel"
          role="dialog"
          aria-label="推荐子级任务"
          style={position}
        >
          <div className="ai-childTask-suggest-header">
            <strong>推荐子级任务</strong>
            <button
              type="button"
              className="ai-childTask-suggest-add-all"
              disabled={!writable || loading || adding || items.length === 0}
              onClick={() => {
                void addAll();
              }}
            >
              全部添加
            </button>
          </div>
          <div className="ai-childTask-suggest-body">
            {loading && (
              <p className="ai-childTask-suggest-status">正在分解…</p>
            )}
            {!loading && error && (
              <p className="ai-childTask-suggest-error">{error}</p>
            )}
            {!loading && !error && items.length === 0 && (
              <p className="ai-childTask-suggest-status">暂无推荐</p>
            )}
            {!loading && items.length > 0 && (
              <ul className="ai-childTask-suggest-list">
                {items.map((item) => {
                  const meta = suggestionMeta(item);
                  return (
                    <li key={item.clientKey} className="ai-childTask-suggest-row">
                      <div className="ai-childTask-suggest-main">
                        <span className="ai-childTask-suggest-title">{item.title}</span>
                        {meta && (
                          <span className="ai-childTask-suggest-meta">{meta}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="ai-childTask-suggest-add"
                        disabled={!writable || adding}
                        aria-label={`添加子级任务：${item.title}`}
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
          <div className="ai-childTask-suggest-header">
            <strong>格式化推荐</strong>
            <button
              type="button"
              className="ai-childTask-suggest-add-all"
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
              <p className="ai-childTask-suggest-status">正在格式化…</p>
            )}
            {!loading && error && (
              <p className="ai-childTask-suggest-error">{error}</p>
            )}
            {!loading && !error && !formatSuggestion && (
              <p className="ai-childTask-suggest-status">暂无推荐</p>
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
  pomodoroMinutes,
  aiFeatureSettings,
  aiWorkSettings,
  settingsLabelName = null,
  onClose,
  onOpenTask,
  onUpdate,
  onSaveSchedule,
  onSaveChildTaskSchedule,
  onAssign,
  onAssignChildTask,
  onToggleLabel,
  onToggleParticipant,
  onCreateChildTask,
  onToggleChildTask,
  onUpdateChildTask,
  onDeleteChildTask,
  onAddDependencies,
  onRemoveDependency,
  onOpenDependency,
  commentsRevision,
  activityRevision,
  onLoadActivity,
  onLoadComments,
  onLoadCommentCandidates,
  onCreateComment,
  onUpdateComment,
  onDeleteComment,
  onNotice,
}, forwardedRef) {
  const [draftTitle, setDraftTitle] = useState(task.title);
  const [descriptionRevision, setDescriptionRevision] = useState(0);
  const [descriptionSeed, setDescriptionSeed] = useState<string | null>(null);
  const [activeTerminal, setActiveTerminal] = useState<ActiveCliTerminal | null>(null);
  const childTaskInputRef = useRef<HTMLInputElement>(null);
  const [dependencyPickerFor, setDependencyPickerFor] = useState<string | null | undefined>(undefined);
  const editingChildTaskInputRef = useRef<HTMLInputElement>(null);
  const skipChildTaskTitleCommitRef = useRef(false);
  const committingDraftChildTaskRef = useRef(false);
  const commitDraftChildTaskRef = useRef<() => Promise<void>>(async () => undefined);
  const [editingChildTaskId, setEditingChildTaskId] = useState<string | null>(null);
  const [editingChildTaskTitle, setEditingChildTaskTitle] = useState("");
  const [draftChildTaskDue, setDraftChildTaskDue] = useState({
    due_at: null as string | null,
    due_start_at: null as string | null,
    due_is_all_day: false,
    due_timezone: null as string | null,
  });
  const [draftChildTaskPriority, setDraftChildTaskPriority] = useState<Task["priority"]>("none");
  const [draftChildTaskCli, setDraftChildTaskCli] = useState<AiCliTool | null>(null);
  const assignableMembers = useMemo(
    () => getAssignableMembers(bundle, task, currentUserId),
    [bundle, currentUserId, task],
  );
  const childTaskTokens = useTaskTitleTokens({
    members: assignableMembers,
    labels: [],
    labelPermissionLevels: {},
    currentUserId,
    features: { assignee: true, labels: false },
    inputRef: childTaskInputRef,
  });
  const draftChildTaskAssignee: AssigneeTarget = draftChildTaskCli
    ? { kind: "cli", tool: draftChildTaskCli }
    : childTaskTokens.assigneeId
      ? { kind: "user", userId: childTaskTokens.assigneeId }
      : { kind: "none" };
  const [cliPickerOpen, setCliPickerOpen] = useState(false);
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [immersive, setImmersive] = useState(false);
  const [showChildTasks, setShowChildTasks] = useState(readDetailChildTasksVisible);
  const [showChildTaskDetails, setShowChildTaskDetails] = useState(false);
  const [collapsedChildTaskIds, setCollapsedChildTaskIds] = useState<Set<string>>(new Set());
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
  const writable = editable && (online || Boolean(window.anttodoDesktop?.sync));

  function renderMenuDependencyPicker() {
    if (dependencyPickerFor === undefined || task.kind === "note") return null;
    const sourceTask = dependencyPickerFor
      ? task.children.find((item) => item.id === dependencyPickerFor) ?? task
      : task;
    const existing = listItemDependencies(sourceTask);
    const source = { taskId: sourceTask.id };
    return (
      <FocusTaskPicker
        open
        mode="dependency"
        tasks={filterPickerTasksForDependency(bundle.tasks, source, existing)}
        selectedTaskId={null}
        excludeKeys={[
          dependencyTargetKey(source),
          ...existing.map((row) => dependencyTargetKey({
            taskId: row.depends_on_task_id,
          })),
        ]}
        anchorPoint={{ left: 120, top: 96 }}
        onOpenChange={(open) => {
          if (!open) setDependencyPickerFor(undefined);
        }}
        onSelect={() => undefined}
        onConfirm={(targets) => {
          void onAddDependencies(sourceTask.id, targets);
        }}
      />
    );
  }

  const hoursLabel = formatHoursDetail(
    task.estimate_hours,
    task.actual_hours,
    task.estimate_pomodoros,
    task.actual_pomodoros,
  );
  const childTaskHoursSummary = formatHoursDetail(
    sumHours(visibleFlattenedTasks(bundle.tasks, task.id, new Set()).map(({ task: item }) => item.estimate_hours)),
    sumHours(visibleFlattenedTasks(bundle.tasks, task.id, new Set()).map(({ task: item }) => item.actual_hours)),
  );
  const desktopAiAvailable = Boolean(window.anttodoDesktop?.aiWork);
  activeTerminalRef.current = activeTerminal;

  useEffect(() => {
    setDraftTitle(task.title);
  }, [task.id, task.title]);
  useEffect(() => {
    setDescriptionSeed(null);
    setDescriptionRevision(0);
  }, [task.id]);
  useLayoutEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    title.style.height = "0px";
    title.style.height = `${title.scrollHeight}px`;
  }, [draftTitle, presentation, task.id]);
  useEffect(() => {
    if (!editingChildTaskId) return;
    if (task.children.some((childTask) => childTask.id === editingChildTaskId)) return;
    skipChildTaskTitleCommitRef.current = true;
    setEditingChildTaskId(null);
    setEditingChildTaskTitle("");
  }, [editingChildTaskId, task.children]);
  useLayoutEffect(() => {
    if (!editingChildTaskId) return;
    const input = editingChildTaskInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [editingChildTaskId]);
  useEffect(() => {
    // Keep CLI processes running across todo switches; restore the view if this
    // task still has a remembered terminal session.
    setImmersive(false);
    setCliPickerOpen(false);
    skipChildTaskTitleCommitRef.current = true;
    setEditingChildTaskId(null);
    setEditingChildTaskTitle("");
    childTaskTokens.reset();
    setDraftChildTaskDue({
      due_at: null,
      due_start_at: null,
      due_is_all_day: false,
      due_timezone: null,
    });
    setDraftChildTaskPriority("none");
    setDraftChildTaskCli(null);
    setToolbarOpen(false);
    setActivityOpen(false);
    setCommentComposerOpen(false);
    const preferred = preferredTerminalByTaskRef.current.get(task.id);
    setActiveTerminal(
      preferred && startedTerminalsRef.current.has(preferred.sessionId)
        ? preferred
        : null,
    );
  }, [task.id]);
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
      ...task.children.map((childTask) => taskTerminalSessionKey(childTask.id)),
    ];
    for (const sessionId of sessionIds) {
      startedTerminalsRef.current.delete(sessionId);
      untrackAiTerminalSession(sessionId);
    }
  }, [task.id, task.status, task.children]);
  useEffect(() => {
    const terminalBridge = window.anttodoDesktop?.aiWork?.terminal;
    if (!terminalBridge) return;
    for (const [sessionId, expectedTool] of startedTerminalsRef.current) {
      const currentTool = sessionId === taskTerminalSessionKey(task.id)
        ? task.cli_assignee
        : task.children.find(
            (childTask) => sessionId === taskTerminalSessionKey(childTask.id),
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
  }, [task.cli_assignee, task.id, task.children]);
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
    void onLoadComments(task.id)
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

  function scheduleChildTaskSave(
    targetTaskId: string,
    patch: Partial<Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone" | "title" | "description" | "estimate_hours" | "actual_hours" | "estimate_pomodoros" | "actual_pomodoros" | "priority">>,
  ) {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (writable) void onUpdateChildTask(targetTaskId, patch);
    }, 500);
  }

  function beginEditChildTask(childTask: Task) {
    if (!writable) return;
    skipChildTaskTitleCommitRef.current = false;
    setEditingChildTaskId(childTask.id);
    setEditingChildTaskTitle(childTask.title);
  }

  function cancelEditChildTask() {
    skipChildTaskTitleCommitRef.current = true;
    setEditingChildTaskId(null);
    setEditingChildTaskTitle("");
  }

  function commitEditChildTask() {
    if (skipChildTaskTitleCommitRef.current) {
      skipChildTaskTitleCommitRef.current = false;
      return;
    }
    if (!editingChildTaskId) return;
    const childTask = task.children.find((item) => item.id === editingChildTaskId);
    const nextTitle = editingChildTaskTitle.trim();
    setEditingChildTaskId(null);
    setEditingChildTaskTitle("");
    if (!childTask || !nextTitle || nextTitle === childTask.title) return;
    void onUpdateChildTask(childTask.id, { title: nextTitle }).catch(() => undefined);
  }

  async function commitDraftChildTask() {
    if (committingDraftChildTaskRef.current || childTaskTokens.token || !writable) return;
    const payload = childTaskTokens.toSubmitPayload();
    if (!payload.title) return;
    committingDraftChildTaskRef.current = true;
    const assigneeId = draftChildTaskAssignee.kind === "user"
      ? draftChildTaskAssignee.userId
      : null;
    const cliAssignee = draftChildTaskAssignee.kind === "cli"
      ? draftChildTaskAssignee.tool
      : null;
    const dueAt = draftChildTaskDue.due_at;
    const dueStartAt = draftChildTaskDue.due_start_at;
    const dueIsAllDay = draftChildTaskDue.due_is_all_day;
    const dueTimezone = draftChildTaskDue.due_timezone;
    const priority = draftChildTaskPriority;
    childTaskTokens.reset();
    setDraftChildTaskDue({
      due_at: null,
      due_start_at: null,
      due_is_all_day: false,
      due_timezone: null,
    });
    setDraftChildTaskPriority("none");
    setDraftChildTaskCli(null);
    try {
      await onCreateChildTask(payload.title, {
        parent_task_id: null,
        assignee_id: assigneeId,
        cli_assignee: cliAssignee,
        due_at: dueAt,
        due_start_at: dueStartAt,
        due_is_all_day: dueIsAllDay,
        due_timezone: dueTimezone,
        priority,
      });
    } finally {
      committingDraftChildTaskRef.current = false;
    }
  }
  commitDraftChildTaskRef.current = commitDraftChildTask;

  function handleDraftChildTaskFormBlur(event: FocusEvent<HTMLFormElement>) {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    if (next instanceof Element && next.closest(".childTask-date-popover, .due-popover")) return;
    void commitDraftChildTask().catch(() => undefined);
  }

  function toggleCollapsedChildTask(targetTaskId: string) {
    setCollapsedChildTaskIds((current) => {
      const next = new Set(current);
      if (next.has(targetTaskId)) next.delete(targetTaskId);
      else next.add(targetTaskId);
      return next;
    });
  }

  function nestChildTask(targetTaskId: string, outdent: boolean) {
    if (!writable) return;
    const patch = outdent
      ? outdentTaskPatch(bundle.tasks, targetTaskId)
      : indentTaskPatch(bundle.tasks, targetTaskId);
    if (!patch) return;
    void onUpdateChildTask(targetTaskId, patch).catch(() => undefined);
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

  async function showChildTaskTerminal(childTask: Task) {
    if (!childTask.cli_assignee || !desktopAiAvailable) return;
    const description = editorRef.current?.getMarkdown() ?? task.description;
    await editorRef.current?.flush().catch(() => undefined);
    const sessionId = taskTerminalSessionKey(childTask.id);
    startedTerminalsRef.current.set(sessionId, childTask.cli_assignee);
    trackAiTerminalSession(task.id, sessionId);
    openTerminalView({
      sessionId,
      tool: childTask.cli_assignee,
      targetLabel: `子级任务：${childTask.title}`,
      prompt: buildChildTaskCliPrompt({ ...task, description }, childTask),
    });
  }

  async function handleAssign(target: AssigneeTarget) {
    await onAssign(target);
    if (target.kind === "cli") {
      await showTaskTerminal(target.tool);
    }
  }

  async function handleAssignChildTask(targetTaskId: string, target: AssigneeTarget) {
    await onAssignChildTask(targetTaskId, target);
    if (target.kind !== "cli") return;
    const childTask = task.children.find((item) => item.id === targetTaskId);
    if (!childTask) return;
    await showChildTaskTerminal({ ...childTask, cli_assignee: target.tool });
  }

  async function closeDetail() {
    if (closingRef.current) return;
    closingRef.current = true;
    window.clearTimeout(saveTimer.current);
    if (writable && draftTitle !== task.title) {
      await onUpdate({ title: draftTitle }).catch(() => undefined);
    }
    await editorRef.current?.flush().catch(() => undefined);
    await commitDraftChildTaskRef.current().catch(() => undefined);
    // Closing the panel while the CLI view is open counts as leaving the view.
    if (activeTerminalRef.current) leaveCliView();
    onClose();
  }

  useEffect(() => {
    const flushPending = () => {
      if (!writable) return;
      window.clearTimeout(saveTimer.current);
      if (draftTitle !== task.title) {
        void onUpdate({ title: draftTitle }).catch(() => undefined);
      }
      void editorRef.current?.flush().catch(() => undefined);
      void commitDraftChildTaskRef.current().catch(() => undefined);
    };
    window.addEventListener(FLUSH_PENDING_EDITS_EVENT, flushPending);
    return () => window.removeEventListener(FLUSH_PENDING_EDITS_EVENT, flushPending);
  }, [
    draftTitle,
    onUpdate,
    task.title,
    writable,
  ]);

  useImperativeHandle(forwardedRef, () => ({ close: closeDetail }));
  const parentTask = task.parent_task_id
    ? bundle.tasks.find((item) => item.id === task.parent_task_id) ?? null
    : null;
  const parentTrigger = parentTask && onOpenTask ? (
    <button
      type="button"
      className="detail-back-to-parent"
      aria-label="返回父任务"
      onClick={() => onOpenTask(parentTask.id)}
    >
      <ChevronLeft />
    </button>
  ) : null;

  const completeTrigger = task.kind !== "note" ? (
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
  ) : null;

  const toolbarLeading: ReactNode = presentation === "dialog" ? (
    <>
      {parentTrigger}
      {task.kind === "note" ? (
        <span className="detail-note-icon" aria-label="笔记"><NotebookPen /></span>
      ) : completeTrigger}
      <span className="detail-toolbar-divider" aria-hidden="true" />
    </>
  ) : (
    <>
      <button type="button" onClick={() => void closeDetail()} aria-label="关闭详情"><X /></button>
      {parentTrigger}
      {completeTrigger}
    </>
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
          pomodoroMinutes={pomodoroMinutes}
          onUpdate={onUpdate}
          onNotice={onNotice}
          onMountDependencies={task.kind === "note" ? undefined : () => setDependencyPickerFor(null)}
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
                  className={clsx("switch-mode", showChildTasks && "active")}
                  title={showChildTasks ? "收起子级任务" : "展开子级任务"}
                  aria-label={showChildTasks ? "收起子级任务" : "展开子级任务"}
                  aria-pressed={showChildTasks}
                  onClick={() => {
                    setShowChildTasks((current) => {
                      const next = !current;
                      storeDetailChildTasksVisible(next);
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
                  aiFeatureSettings={aiFeatureSettings}
                  online={online}
                  editable={editable}
                  onCreateChildTask={onCreateChildTask}
                  onEnsureChildTasksVisible={() => {
                    setShowChildTasks(true);
                    storeDetailChildTasksVisible(true);
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
          currentUserId={currentUserId}
          immersive={immersive}
          initialMarkdown={descriptionSeed ?? task.description}
          initialMentionUserIds={(task.description_mentions ?? []).map((item) => item.user_id)}
          members={bundle.members}
          online={writable}
          onImmersiveChange={setImmersive}
          onLoadMentionCandidates={onLoadCommentCandidates}
          onSave={(description, mentionedUserIds) =>
            onUpdate(
              { description },
              mentionedUserIds ? { mentionedUserIds } : undefined,
            )}
          toolbarHost={toolbarHost}
          toolbarOpen={toolbarOpen}
        />
        {task.kind !== "note" && showChildTasks && (
          <section className="detail-section">
            <div className="detail-section-title">
              <span>子级任务</span>
              <button
                type="button"
                className="detail-section-title-toggle"
                title={showChildTaskDetails ? "隐藏子级任务详情" : "显示子级任务详情"}
                aria-label={showChildTaskDetails ? "隐藏子级任务详情" : "显示子级任务详情"}
                aria-expanded={showChildTaskDetails}
                onClick={() => setShowChildTaskDetails((current) => !current)}
              >
                {showChildTaskDetails ? <ChevronDown /> : <ChevronRight />}
              </button>
              <em>
                {taskCollectionProgress(visibleFlattenedTasks(bundle.tasks, task.id, new Set()).map((row) => row.task)).completed}/
                {taskCollectionProgress(visibleFlattenedTasks(bundle.tasks, task.id, new Set()).map((row) => row.task)).total}
              </em>
            </div>
            <div className="childTask-list">
              {visibleFlattenedTasks(bundle.tasks, task.id, collapsedChildTaskIds).map(({ task: childTask, depth }) => {
                const childCount = childrenOf(bundle.tasks, childTask.id).length;
                const collapsed = collapsedChildTaskIds.has(childTask.id);
                const childTaskHoursLabel = showChildTaskDetails
                  ? formatHoursDetail(
                    childTask.estimate_hours,
                    childTask.actual_hours,
                    childTask.estimate_pomodoros,
                    childTask.actual_pomodoros,
                  )
                  : null;
                const childTaskDueLabel = showChildTaskDetails
                  && childTask.due_at
                  && (
                    !childTask.due_is_all_day
                    || (
                      Boolean(childTask.due_start_at)
                      && toDateInput(childTask.due_start_at!, childTask.due_timezone)
                        !== toDateInput(childTask.due_at!, childTask.due_timezone)
                    )
                  )
                  ? formatDueWithPreferences(childTask, dateTimePreferences)
                  : null;
                return (
                <div
                  className={clsx("childTask-row", editingChildTaskId === childTask.id && "editing")}
                  key={childTask.id}
                  style={{ paddingLeft: 8 + (depth - 1) * 16 }}
                >
                  {childCount > 0 ? (
                    <button
                      type="button"
                      className="childTask-tree-expander"
                      aria-label={`${collapsed ? "展开" : "收起"}子级任务：${childTask.title}`}
                      aria-expanded={!collapsed}
                      onClick={() => toggleCollapsedChildTask(childTask.id)}
                    >
                      {collapsed ? <ChevronRight /> : <ChevronDown />}
                    </button>
                  ) : (
                    <span className="childTask-tree-expander-slot" aria-hidden="true" />
                  )}
                  <input
                    type="checkbox"
                    aria-label={`完成子级任务：${childTask.title}`}
                    checked={(childTask.status === "completed")}
                    disabled={!writable}
                    onChange={(event) => void onToggleChildTask(childTask.id, event.target.checked).catch(() => {})}
                  />
                  <div className="childTask-main">
                    <div className="childTask-headline">
                    {editingChildTaskId === childTask.id ? (
                      <input
                        ref={editingChildTaskInputRef}
                        className="childTask-title-input"
                        value={editingChildTaskTitle}
                        disabled={!writable}
                        aria-label={`编辑子级任务：${childTask.title}`}
                        onChange={(event) => setEditingChildTaskTitle(event.target.value)}
                        onBlur={() => commitEditChildTask()}
                        onKeyDown={(event) => {
                          if (event.key === "Tab") {
                            event.preventDefault();
                            nestChildTask(childTask.id, event.shiftKey);
                            return;
                          }
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitEditChildTask();
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            cancelEditChildTask();
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className={clsx("childTask-title", (childTask.status === "completed") && "completed")}
                        disabled={!writable}
                        onClick={() => beginEditChildTask(childTask)}
                        onKeyDown={(event) => {
                          if (event.key === "Tab" && writable) {
                            event.preventDefault();
                            nestChildTask(childTask.id, event.shiftKey);
                          }
                        }}
                      >
                        {childTask.title}
                      </button>
                    )}
                    <div className="childTask-actions">
                    <TaskAssigneeControl
                      task={task}
                      bundle={bundle}
                      currentUserId={currentUserId}
                      aiWorkSettings={aiWorkSettings}
                      online={writable}
                      onAssign={(target) => handleAssignChildTask(childTask.id, target)}
                      target={taskAssigneeTarget(childTask)}
                      compact
                    />
                    <DueDateControl
                      task={dueTargetFromChildTask(childTask)}
                      online={writable}
                      now={now}
                      preferences={dateTimePreferences}
                      allowRecurrence={false}
                      compact
                      onSave={(patch, schedule) => onSaveChildTaskSchedule(childTask.id, patch, schedule)}
                    />
                    {desktopAiAvailable && childTask.cli_assignee && (
                      <button
                        type="button"
                        className="childTask-terminal-trigger"
                        aria-label={`打开 ${aiCliLabel(childTask.cli_assignee)} 终端：${childTask.title}`}
                        title={`打开 ${aiCliLabel(childTask.cli_assignee)} 终端`}
                        onClick={() => void showChildTaskTerminal(childTask)}
                      >
                        <SquareTerminal />
                      </button>
                    )}
                    <button
                      type="button"
                      className="childTask-delete"
                      aria-label={`删除子级任务：${childTask.title}`}
                      disabled={!writable}
                      onClick={() => void onDeleteChildTask(childTask.id)}
                    >
                      <Trash2 />
                    </button>
                    <ChildTaskMoreMenu
                      childTask={childTask}
                      online={writable}
                      compact
                      pomodoroMinutes={pomodoroMinutes}
                      onUpdate={(patch) => onUpdateChildTask(childTask.id, patch)}
                      onMountDependencies={() => setDependencyPickerFor(childTask.id)}
                    />
                  </div>
                    </div>
                    {childTaskDueLabel && (
                      <p className="childTask-due">{childTaskDueLabel}</p>
                    )}
                    {childTaskHoursLabel && (
                      <p className="childTask-hours">{childTaskHoursLabel}</p>
                    )}
                  </div>
                </div>
                );
              })}
              <form
                className={clsx(
                  "childTask-add",
                  (
                    Boolean(childTaskTokens.title.trim())
                    || Boolean(draftChildTaskDue.due_at)
                    || draftChildTaskPriority !== "none"
                    || draftChildTaskAssignee.kind !== "none"
                  ) && "has-draft",
                )}
                onSubmit={(event) => {
                  event.preventDefault();
                  void commitDraftChildTask().catch(() => undefined);
                }}
                onBlur={handleDraftChildTaskFormBlur}
              >
                <span
                  className="childTask-add-check"
                  aria-hidden="true"
                  onClick={() => childTaskInputRef.current?.focus()}
                />
                <div className="childTask-add-field task-title-token-field">
                  <input
                    ref={childTaskInputRef}
                    value={childTaskTokens.title}
                    onChange={childTaskTokens.handleChange}
                    onKeyDown={(event) => {
                      if (childTaskTokens.handleKeyDown(event)) return;
                    }}
                    placeholder="回车添加下一项"
                    disabled={!writable}
                    aria-label="添加子级任务"
                  />
                  {childTaskTokens.token && (
                    <TaskTitleTokenMenu
                      kind={childTaskTokens.token.kind}
                      assigneeCandidates={childTaskTokens.assigneeCandidates}
                      labelCandidates={childTaskTokens.labelCandidates}
                      activeIndex={childTaskTokens.activeIndex}
                      onSelectAssignee={(member) => {
                        setDraftChildTaskCli(null);
                        childTaskTokens.selectAssignee(member);
                      }}
                      onSelectLabel={childTaskTokens.selectLabel}
                    />
                  )}
                </div>
                <div className="childTask-actions">
                  <TaskAssigneeControl
                    task={task}
                    bundle={bundle}
                    currentUserId={currentUserId}
                    aiWorkSettings={aiWorkSettings}
                    online={writable}
                    onAssign={async (target) => {
                      if (target.kind === "cli") {
                        setDraftChildTaskCli(target.tool);
                        childTaskTokens.setAssigneeId(null);
                        return;
                      }
                      setDraftChildTaskCli(null);
                      childTaskTokens.setAssigneeId(
                        target.kind === "user" ? target.userId : null,
                      );
                    }}
                    target={draftChildTaskAssignee}
                    compact
                  />
                  <DueDateControl
                    task={{
                      id: "draft-childTask",
                      ...draftChildTaskDue,
                      reminders: [],
                      reminder_persistent: false,
                      recurrence: null,
                      status: "open",
                    }}
                    online={writable}
                    now={now}
                    preferences={dateTimePreferences}
                    allowRecurrence={false}
                    compact
                    onSave={async (patch) => {
                      setDraftChildTaskDue(patch);
                    }}
                  />
                </div>
              </form>
            </div>
          </section>
        )}
        {task.kind !== "note" && (
          <TaskDependencyList
            task={task}
            tasks={bundle.tasks}
            writable={writable}
            dateTimePreferences={dateTimePreferences}
            onAdd={(targets) => onAddDependencies(task.id, targets)}
            onRemove={onRemoveDependency}
            onOpen={onOpenDependency}
          />
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
            await onCreateComment(task.id, input);
            try {
              setComments(await onLoadComments(task.id));
            } catch {
              // An offline comment is already queued locally.
            }
          }}
          onUpdate={async (comment, input) => {
            await onUpdateComment(comment, input);
            setComments(await onLoadComments(task.id));
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
      {!activeTerminal && !immersive && !activityOpen && (hoursLabel || childTaskHoursSummary) && (
        <div className="detail-hours">
          {hoursLabel && <p>{hoursLabel}</p>}
          {childTaskHoursSummary && <p>子级任务汇总：{childTaskHoursSummary}</p>}
        </div>
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
      {renderMenuDependencyPicker()}
    </div>
  );
});

function useMobileTaskDetailSheet() {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined"
      && window.matchMedia(MOBILE_TASK_DETAIL_MEDIA).matches);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_TASK_DETAIL_MEDIA);
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return mobile;
}

function MobileTaskDetailSheet({
  taskId,
  onClose,
  onRequestFlushClose,
  children,
}: {
  taskId: string;
  onClose: () => void;
  onRequestFlushClose: () => void;
  children: (requestClose: () => void) => ReactNode;
}) {
  const [snap, setSnap] = useState<MobileTaskDetailSnap>("peek");
  const [dragY, setDragY] = useState<number | null>(null);
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight : 0);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    startTranslateY: number;
    startTime: number;
  } | null>(null);
  const closingRef = useRef(false);

  useEffect(() => {
    setSnap("peek");
    setDragY(null);
    closingRef.current = false;
  }, [taskId]);

  useEffect(() => {
    const update = () => setViewportHeight(window.innerHeight);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const baseTranslateY = mobileTaskDetailTranslateY(
    mobileTaskDetailSnapRatio(snap),
    viewportHeight,
  );
  const translateY = dragY ?? baseTranslateY;
  const ratio = mobileTaskDetailRatioFromTranslateY(translateY, viewportHeight);
  const scrimOpacity = Math.min(0.36, 0.12 + ratio * 0.28);

  function closeSheet() {
    if (closingRef.current) return;
    closingRef.current = true;
    setDragY(viewportHeight);
    window.setTimeout(() => {
      onClose();
    }, 180);
  }

  function onHandlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || dragRef.current || closingRef.current) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startTranslateY: translateY,
      startTime: event.timeStamp,
    };
    setDragY(translateY);
  }

  function onHandlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = Math.min(
      viewportHeight,
      Math.max(0, drag.startTranslateY + (event.clientY - drag.startY)),
    );
    setDragY(next);
  }

  function onHandlePointerUp(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const deltaY = event.clientY - drag.startY;
    const velocityY = deltaY / Math.max(1, event.timeStamp - drag.startTime);
    const nextRatio = mobileTaskDetailRatioFromTranslateY(
      Math.min(
        viewportHeight,
        Math.max(0, drag.startTranslateY + deltaY),
      ),
      viewportHeight,
    );
    const release = resolveMobileTaskDetailRelease({
      ratio: nextRatio,
      velocityY,
    });
    setDragY(null);
    if (release === "close") {
      onRequestFlushClose();
      return;
    }
    setSnap(release);
  }

  function onHandlePointerCancel(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragY(null);
  }

  return (
    <div className="task-detail-sheet-root">
      <button
        type="button"
        className="task-detail-sheet-scrim"
        aria-label="关闭详情"
        style={{ opacity: scrimOpacity }}
        onClick={() => onRequestFlushClose()}
      />
      <div
        className={clsx(
          "task-detail-sheet",
          snap === "full" && "is-full",
          dragY !== null && "is-dragging",
        )}
        style={{
          transform: `translate3d(0, ${translateY}px, 0)`,
        }}
      >
        <div
          className="task-detail-sheet-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="拖拽调整详情高度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(ratio * 100)}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerCancel}
        >
          <span className="task-detail-sheet-handle-bar" aria-hidden="true" />
        </div>
        {children(closeSheet)}
      </div>
    </div>
  );
}

export function TaskDetailPanel(props: TaskDetailProps) {
  const mobileSheet = useMobileTaskDetailSheet();
  const contentRef = useRef<TaskDetailContentHandle>(null);

  useEffect(() => {
    if (mobileSheet) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!shouldDismissTaskDetailOnPointerDown(event.target, event.button)) return;
      void contentRef.current?.close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [mobileSheet]);

  if (!mobileSheet) {
    return <TaskDetailContent ref={contentRef} {...props} presentation="panel" />;
  }
  return (
    <MobileTaskDetailSheet
      taskId={props.task.id}
      onClose={props.onClose}
      onRequestFlushClose={() => {
        void contentRef.current?.close();
      }}
    >
      {(requestClose) => (
        <TaskDetailContent
          ref={contentRef}
          {...props}
          presentation="panel"
          onClose={requestClose}
        />
      )}
    </MobileTaskDetailSheet>
  );
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
              ".due-popover, .priority-menu, .task-more-menu, .ai-smart-process-menu, .ai-childTask-suggest-panel, .ai-format-suggest-panel, .task-detail-dialog .task-assignee-menu, .task-detail-dialog .task-label-menu, .task-detail-dialog .task-activity, .task-detail-dialog .rich-editor-immersive, .task-detail-dialog .rich-toolbar-more[open]",
            )) return;
            void contentRef.current?.close();
          }}
          onPointerDownOutside={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest(".due-popover, .priority-menu, .task-more-menu, .ai-smart-process-menu, .ai-childTask-suggest-panel, .ai-format-suggest-panel")) {
              event.preventDefault();
              return;
            }
            event.preventDefault();
            void contentRef.current?.close();
          }}
          onFocusOutside={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest(".due-popover, .priority-menu, .task-more-menu, .ai-smart-process-menu, .ai-childTask-suggest-panel, .ai-format-suggest-panel")) {
              event.preventDefault();
            }
          }}
          onInteractOutside={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest(".due-popover, .priority-menu, .task-more-menu, .ai-smart-process-menu, .ai-childTask-suggest-panel, .ai-format-suggest-panel")) {
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
