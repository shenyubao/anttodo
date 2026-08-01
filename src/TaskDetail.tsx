import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import {
  Check,
  Ellipsis,
  Inbox,
  ListTodo,
  Plus,
  Trash2,
  Type,
  UserRound,
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
import {
  TaskRichTextEditor,
  type TaskRichTextEditorHandle,
} from "./TaskRichTextEditor";
import type { AttachmentService } from "./lib/attachments";
import { getAssignableMembers } from "./lib/taskAssignment";
import type { DateTimePreferences, Task, WorkspaceBundle } from "./types";

export type TaskDetailProps = {
  task: Task;
  bundle: WorkspaceBundle;
  currentUserId: string;
  online: boolean;
  attachmentService: AttachmentService;
  now: Date;
  dateTimePreferences: DateTimePreferences;
  onClose: () => void;
  onUpdate: (patch: Partial<Task>) => Promise<void>;
  onLoadAssignees: () => Promise<string[]>;
  onAssign: (assigneeId: string | null) => Promise<void>;
  onToggleLabel: (taskId: string, labelId: string, selected: boolean) => Promise<void>;
  onCreateSubtask: (title: string) => Promise<void>;
  onToggleSubtask: (subtaskId: string, completed: boolean) => Promise<void>;
};

function TaskAssigneeControl({
  task,
  bundle,
  currentUserId,
  online,
  onLoad,
  onAssign,
}: {
  task: Task;
  bundle: WorkspaceBundle;
  currentUserId: string;
  online: boolean;
  onLoad: () => Promise<string[]>;
  onAssign: (assigneeId: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [candidateIds, setCandidateIds] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const onLoadRef = useRef(onLoad);
  const assignee = bundle.members.find((member) => member.user_id === task.assignee_id);
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

  async function choose(assigneeId: string | null) {
    if (saving || !online) return;
    if (task.assignee_id === assigneeId) {
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onAssign(assigneeId);
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
    <div className="task-assignee-control" ref={rootRef}>
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
            aria-checked={task.assignee_id === null}
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
              aria-checked={task.assignee_id === member.user_id}
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
                disabled={Boolean(savingLabelId)}
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

const TaskDetailContent = forwardRef<TaskDetailContentHandle, TaskDetailProps & {
  presentation: "panel" | "dialog";
}>(function TaskDetailContent({
  presentation,
  task,
  bundle,
  currentUserId,
  online,
  attachmentService,
  now,
  dateTimePreferences,
  onClose,
  onUpdate,
  onLoadAssignees,
  onAssign,
  onToggleLabel,
  onCreateSubtask,
  onToggleSubtask,
}, forwardedRef) {
  const [draftTitle, setDraftTitle] = useState(task.title);
  const [newSubtask, setNewSubtask] = useState("");
  const [subtasksOpen, setSubtasksOpen] = useState(task.subtasks.length > 0);
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [immersive, setImmersive] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const editorRef = useRef<TaskRichTextEditorHandle>(null);
  const closingRef = useRef(false);

  useEffect(() => setDraftTitle(task.title), [task.id, task.title]);
  useEffect(() => {
    setImmersive(false);
    setSubtasksOpen(task.subtasks.length > 0);
    setNewSubtask("");
    setToolbarOpen(false);
  }, [task.id]);
  useEffect(() => {
    if (!immersive) return;
    const exitImmersive = (event: KeyboardEvent) => {
      if (event.key === "Escape") setImmersive(false);
    };
    window.addEventListener("keydown", exitImmersive);
    return () => window.removeEventListener("keydown", exitImmersive);
  }, [immersive]);
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  function scheduleSave(patch: Partial<Task>) {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (online) void onUpdate(patch);
    }, 500);
  }

  async function closeDetail() {
    if (closingRef.current) return;
    closingRef.current = true;
    window.clearTimeout(saveTimer.current);
    if (online && draftTitle !== task.title) {
      await onUpdate({ title: draftTitle }).catch(() => undefined);
    }
    await editorRef.current?.flush().catch(() => undefined);
    onClose();
  }

  useImperativeHandle(forwardedRef, () => ({ close: closeDetail }));

  const toolbarLeading: ReactNode = presentation === "dialog" ? (
    <>
      <button
        className="detail-complete-trigger"
        type="button"
        disabled={!online}
        aria-label={task.status === "completed" ? "标记未完成" : "完成任务"}
        onClick={() => void onUpdate({
          status: task.status === "completed" ? "open" : "completed",
          completed_at: task.status === "completed" ? null : new Date().toISOString(),
        })}
      >
        {task.status === "completed" && <Check />}
      </button>
      <span className="detail-toolbar-divider" aria-hidden="true" />
    </>
  ) : (
    <button type="button" onClick={() => void closeDetail()} aria-label="关闭详情"><X /></button>
  );

  return (
    <div className={clsx("task-detail", `task-detail-${presentation}`, immersive && "rich-editor-immersive")}>
      <header className="detail-toolbar">
        {toolbarLeading}
        <DueDateControl
          task={task}
          online={online}
          now={now}
          preferences={dateTimePreferences}
          onSave={onUpdate}
        />
        <div className="detail-toolbar-spacer" />
        <TaskAssigneeControl
          task={task}
          bundle={bundle}
          currentUserId={currentUserId}
          online={online}
          onLoad={onLoadAssignees}
          onAssign={onAssign}
        />
        <PriorityControl
          priority={task.priority}
          online={online}
          onChange={(priority) => onUpdate({ priority })}
        />
        <button type="button" aria-label="更多任务操作"><Ellipsis /></button>
      </header>
      <div className="detail-body">
        <div className="detail-caption">
          <textarea
            className="detail-title"
            value={draftTitle}
            disabled={!online}
            aria-label="任务标题"
            onChange={(event) => {
              setDraftTitle(event.target.value);
              scheduleSave({ title: event.target.value });
            }}
            rows={2}
          />
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
        </div>
        <TaskRichTextEditor
          key={task.id}
          ref={editorRef}
          attachmentContext={{ workspaceId: task.workspace_id, taskId: task.id }}
          attachmentService={attachmentService}
          immersive={immersive}
          initialMarkdown={task.description}
          online={online}
          onImmersiveChange={setImmersive}
          onSave={(description) => onUpdate({ description })}
          toolbarHost={toolbarHost}
          toolbarOpen={toolbarOpen}
        />
        {subtasksOpen && (
          <section className="detail-section">
            <div className="detail-section-title">
              <span>子任务</span>
              <em>{task.subtasks.filter((item) => item.completed).length}/{task.subtasks.length}</em>
            </div>
            {task.subtasks.map((subtask) => (
              <label className="subtask-row" key={subtask.id}>
                <input
                  type="checkbox"
                  checked={subtask.completed}
                  disabled={!online}
                  onChange={(event) => void onToggleSubtask(subtask.id, event.target.checked)}
                />
                <span className={subtask.completed ? "completed" : ""}>{subtask.title}</span>
              </label>
            ))}
            <form
              className="subtask-add"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!newSubtask.trim() || !online) return;
                await onCreateSubtask(newSubtask.trim());
                setNewSubtask("");
              }}
            >
              <Plus />
              <input
                value={newSubtask}
                onChange={(event) => setNewSubtask(event.target.value)}
                placeholder="添加子任务"
                disabled={!online}
              />
            </form>
          </section>
        )}
      </div>
      <div ref={setToolbarHost} className={clsx("detail-editor-toolbar-dock", toolbarOpen && "open")} />
      <footer className="detail-footer">
        <TaskLabelControl
          task={task}
          bundle={bundle}
          online={online}
          onToggleLabel={onToggleLabel}
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
          type="button"
          title="移至垃圾桶"
          aria-label="移至垃圾桶"
          disabled={!online}
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
              ".task-detail-dialog .due-popover, .task-detail-dialog .priority-menu, .task-detail-dialog .task-assignee-menu, .task-detail-dialog .task-label-menu, .task-detail-dialog .rich-editor-immersive, .task-detail-dialog .rich-toolbar-more[open]",
            )) return;
            void contentRef.current?.close();
          }}
          onPointerDownOutside={(event) => {
            event.preventDefault();
            void contentRef.current?.close();
          }}
        >
          <Dialog.Title className="sr-only">任务详情：{props.task.title}</Dialog.Title>
          <TaskDetailContent ref={contentRef} {...props} presentation="dialog" />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
