import {
  CalendarClock,
  Check,
  CirclePlus,
  ListChecks,
  Pencil,
  RefreshCw,
  Tag,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { formatPreferenceDateTime } from "./lib/dateTimePreferences";
import type {
  DateTimePreferences,
  Member,
  Task,
  TaskActivityEvent,
  TaskActivityPage,
} from "./types";
import { aiCliLabel } from "./lib/aiWork";

type ActivityTone = "create" | "edit" | "complete" | "delete" | "assign" | "label";

export type TaskActivityPresentation = {
  action: string;
  detail: string;
  tone: ActivityTone;
  icon: ReactNode;
};

type Change = { before?: unknown; after?: unknown };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function changeMap(event: TaskActivityEvent) {
  return record(event.payload.changes) as Record<string, Change>;
}

export function activityPlainTextPreview(value: unknown, maxLength = 120) {
  const plain = String(value ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > maxLength ? `${plain.slice(0, maxLength)}…` : plain;
}

function memberName(id: unknown, members: Member[]) {
  if (typeof id !== "string" || !id) return "未指派";
  return members.find((member) => member.user_id === id)?.profile?.display_name ?? "成员";
}

function priorityName(value: unknown) {
  return ({ none: "无优先级", low: "低优先级", medium: "中优先级", high: "高优先级" })[
    String(value)
  ] ?? String(value ?? "");
}

function kindName(value: unknown) {
  return value === "note" ? "笔记" : "待办";
}

function changedFieldPresentation(
  changes: Record<string, Change>,
  preferences: DateTimePreferences,
): Omit<TaskActivityPresentation, "icon" | "tone"> {
  if (changes.deleted_at) {
    return changes.deleted_at.after
      ? { action: "移入了回收站", detail: "" }
      : { action: "恢复了任务", detail: "" };
  }
  if (changes.status) {
    const next = changes.status.after;
    if (next === "completed") return { action: "完成了任务", detail: "" };
    if (next === "cancelled") return { action: "放弃了任务", detail: "" };
    return { action: "重新打开了任务", detail: "" };
  }
  const labels: Record<string, string> = {
    title: "标题",
    description: "内容",
    kind: "类型",
    priority: "优先级",
    due_at: "日期",
    due_start_at: "日期",
    due_is_all_day: "日期",
    due_timezone: "时区",
  };
  const fields = Object.keys(changes);
  const uniqueLabels = [...new Set(fields.map((field) => labels[field] ?? field))];
  const primary = fields[0];
  const next = changes[primary]?.after;
  let detail = "";
  if (primary === "title" || primary === "description") detail = activityPlainTextPreview(next);
  else if (primary === "priority") detail = priorityName(next);
  else if (primary === "kind") detail = kindName(next);
  else if ((primary === "due_at" || primary === "due_start_at") && typeof next === "string") {
    detail = formatPreferenceDateTime(next, preferences);
  }
  return { action: `修改了${uniqueLabels.join("、")}`, detail };
}

export function taskActivityPresentation(
  event: TaskActivityEvent,
  task: Pick<Task, "title">,
  members: Member[],
  preferences: DateTimePreferences,
): TaskActivityPresentation {
  if (event.event_type === "task.created") {
    return {
      action: "创建了任务",
      detail: String(event.payload.title ?? task.title),
      tone: "create",
      icon: <CirclePlus />,
    };
  }
  if (event.event_type === "task.assignee_changed") {
    const cli = event.payload.cli_assignee;
    return {
      action: "修改了负责人",
      detail: cli === "codex" || cli === "claude"
        ? aiCliLabel(cli)
        : memberName(event.payload.assignee_id, members),
      tone: "assign",
      icon: <UserRound />,
    };
  }
  if (event.event_type === "task.participant_added" || event.event_type === "task.participant_removed") {
    return {
      action: event.event_type.endsWith("added") ? "添加了参与者" : "移除了参与者",
      detail: String(event.payload.display_name ?? memberName(event.payload.user_id, members)),
      tone: "assign",
      icon: <UsersRound />,
    };
  }
  if (event.event_type === "task.label_added" || event.event_type === "task.label_removed") {
    return {
      action: event.event_type.endsWith("added") ? "添加了标签" : "移除了标签",
      detail: String(event.payload.label_name ?? "标签"),
      tone: "label",
      icon: <Tag />,
    };
  }
  if (event.event_type === "task.childTask_created") {
    return { action: "创建了子级任务", detail: String(event.payload.title ?? ""), tone: "create", icon: <ListChecks /> };
  }
  if (event.event_type === "task.childTask_deleted") {
    return { action: "删除了子级任务", detail: String(event.payload.title ?? ""), tone: "delete", icon: <Trash2 /> };
  }
  if (event.event_type === "task.childTask_updated") {
    const changes = record(event.payload.changes) as Record<string, Change>;
    const completed = changes.completed?.after;
    if (changes.cli_assignee?.after === "codex" || changes.cli_assignee?.after === "claude") {
      const tool = changes.cli_assignee.after;
      return {
        action: "修改了子级任务负责人",
        detail: `${String(event.payload.title ?? "")} · ${aiCliLabel(tool)}`,
        tone: "assign",
        icon: <UserRound />,
      };
    }
    if (changes.assignee_id) {
      return {
        action: "修改了子级任务负责人",
        detail: `${String(event.payload.title ?? "")} · ${memberName(changes.assignee_id.after, members)}`,
        tone: "assign",
        icon: <UserRound />,
      };
    }
    if (changes.cli_assignee) {
      const value = changes.cli_assignee as { after?: unknown };
      const tool = value.after;
      return {
        action: "修改了子级任务负责人",
        detail: `${String(event.payload.title ?? "")} · ${
          tool === "codex" || tool === "claude" ? aiCliLabel(tool) : "未指派"
        }`,
        tone: "assign",
        icon: <UserRound />,
      };
    }
    if (changes.due_at) {
      const dueAt = changes.due_at.after;
      return {
        action: "修改了子级任务日期",
        detail: typeof dueAt === "string"
          ? `${String(event.payload.title ?? "")} · ${formatPreferenceDateTime(dueAt, preferences)}`
          : String(event.payload.title ?? ""),
        tone: "edit",
        icon: <CalendarClock />,
      };
    }
    if (changes.priority) {
      return {
        action: "修改了子级任务优先级",
        detail: `${String(event.payload.title ?? "")} · ${priorityName(changes.priority.after)}`,
        tone: "edit",
        icon: <Pencil />,
      };
    }
    return completed === true
      ? { action: "完成了子级任务", detail: String(event.payload.title ?? ""), tone: "complete", icon: <Check /> }
      : completed === false
        ? { action: "重新打开了子级任务", detail: String(event.payload.title ?? ""), tone: "edit", icon: <RefreshCw /> }
        : { action: "修改了子级任务", detail: String(event.payload.title ?? ""), tone: "edit", icon: <Pencil /> };
  }
  if (event.event_type === "task.reminders_changed") {
    return { action: "修改了提醒", detail: "", tone: "edit", icon: <CalendarClock /> };
  }
  if (event.event_type === "task.updated") {
    const presentation = changedFieldPresentation(changeMap(event), preferences);
    const isComplete = presentation.action === "完成了任务";
    const isDelete = presentation.action === "移入了回收站" || presentation.action === "放弃了任务";
    return {
      ...presentation,
      tone: isComplete ? "complete" : isDelete ? "delete" : "edit",
      icon: isComplete ? <Check /> : isDelete ? <Trash2 /> : <Pencil />,
    };
  }
  return { action: "更新了任务", detail: "", tone: "edit", icon: <Pencil /> };
}

export function activityTimestamp(
  createdAt: string,
  preferences: DateTimePreferences,
) {
  return formatPreferenceDateTime(createdAt, preferences);
}

export function TaskActivity({
  task,
  members,
  preferences,
  revision,
  onLoad,
  onClose,
}: {
  task: Task;
  members: Member[];
  preferences: DateTimePreferences;
  revision: number;
  onLoad: (cursor?: TaskActivityPage["nextCursor"]) => Promise<TaskActivityPage>;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<TaskActivityEvent[]>([]);
  const [cursor, setCursor] = useState<TaskActivityPage["nextCursor"]>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const page = await onLoad(null);
      setEvents(page.items);
      setCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "任务动态加载失败");
    } finally {
      setLoading(false);
    }
  }, [onLoad]);

  useEffect(() => { void reload(); }, [reload, revision, task.id]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const page = await onLoad(cursor);
      setEvents((current) => {
        const seen = new Set(current.map((event) => event.id));
        return [...current, ...page.items.filter((event) => !seen.has(event.id))];
      });
      setCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更早动态加载失败");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="task-activity" aria-labelledby={`task-activity-${task.id}`}>
      <header className="task-activity-header">
        <h2 id={`task-activity-${task.id}`}>任务动态</h2>
        <button type="button" aria-label="关闭任务动态" onClick={onClose}><X /></button>
      </header>
      {loading ? (
        <p className="task-activity-state" role="status">正在读取任务动态…</p>
      ) : error && events.length === 0 ? (
        <div className="task-activity-state" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void reload()}>重试</button>
        </div>
      ) : events.length === 0 ? (
        <p className="task-activity-state">暂无任务动态</p>
      ) : (
        <ol className="task-activity-list">
          {events.map((event) => {
            const item = taskActivityPresentation(event, task, members, preferences);
            const actor = event.actor?.display_name ?? (event.actor_id ? "成员" : "系统");
            return (
              <li key={event.id} className={`task-activity-item tone-${item.tone}`}>
                <span className="task-activity-icon" aria-hidden="true">{item.icon}</span>
                <div className="task-activity-content">
                  <p><strong>{actor}</strong><span>{item.action}</span>{item.detail && <em>{item.detail}</em>}</p>
                  <time dateTime={event.created_at}>{activityTimestamp(event.created_at, preferences)}</time>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {error && events.length > 0 && <p className="task-activity-inline-error" role="alert">{error}</p>}
      {cursor && !loading && (
        <button className="task-activity-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? "正在加载…" : "加载更早动态"}
        </button>
      )}
    </section>
  );
}
