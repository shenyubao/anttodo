export type DingtalkNotificationCard = {
  title: string;
  markdown: string;
  buttonText: string;
  openUrl: string;
};

type NotificationKind = "task" | "note";

const DEFAULT_TIME_ZONE = "Asia/Shanghai";

function truncate(value: string, maxLength: number) {
  const characters = Array.from(value);
  if (characters.length <= maxLength) return value;
  return `${characters.slice(0, Math.max(0, maxLength - 1)).join("")}…`;
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (entity.startsWith("#")) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

export function plainNotificationText(value: unknown, maxLength = 240) {
  if (typeof value !== "string") return "";
  const normalized = decodeHtmlEntities(
    value
      .replace(/<\s*br\s*\/?\s*>/gi, " ")
      .replace(/<\/?(?:p|div|li|ul|ol|h[1-6]|blockquote|pre|table|tr)[^>]*>/gi, " ")
      .replace(/<[^>]*>/g, ""),
  ).replace(/\s+/g, " ").trim();
  return truncate(normalized, maxLength);
}

export function escapeDingtalkMarkdown(value: string) {
  return value.replace(/([\\`*_[\]{}()#+\-.!|>~=])/g, "\\$1");
}

function safeText(value: unknown, fallback: string, maxLength = 200) {
  return escapeDingtalkMarkdown(plainNotificationText(value, maxLength) || fallback);
}

function validTimeZone(timeZone?: string | null) {
  if (!timeZone) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone }).format();
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function dateParts(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour").padStart(2, "0"),
    minute: get("minute").padStart(2, "0"),
  };
}

function dateLabel(parts: NonNullable<ReturnType<typeof dateParts>>) {
  return `${parts.year}年${parts.month}月${parts.day}日`;
}

function timeLabel(parts: NonNullable<ReturnType<typeof dateParts>>) {
  return `${parts.hour}:${parts.minute}`;
}

export function formatDingtalkDue(input: {
  dueAt: string;
  dueStartAt?: string | null;
  allDay?: boolean;
  timeZone?: string | null;
}) {
  const zone = validTimeZone(input.timeZone);
  const end = dateParts(input.dueAt, zone);
  if (!end) return "时间待确认";
  const start = input.dueStartAt ? dateParts(input.dueStartAt, zone) : null;
  if (input.allDay) {
    if (!start || dateLabel(start) === dateLabel(end)) return dateLabel(end);
    return `${dateLabel(start)}–${dateLabel(end)}`;
  }
  if (!start) return `${dateLabel(end)} ${timeLabel(end)}`;
  if (dateLabel(start) === dateLabel(end)) {
    return `${dateLabel(start)} ${timeLabel(start)}–${timeLabel(end)}`;
  }
  return `${dateLabel(start)} ${timeLabel(start)}–${dateLabel(end)} ${timeLabel(end)}`;
}

export function buildDueReminderCard(input: {
  taskTitle: string;
  description?: string | null;
  dueAt: string;
  dueStartAt?: string | null;
  allDay?: boolean;
  timeZone?: string | null;
  openUrl: string;
}): DingtalkNotificationCard {
  const title = "⏰ 待办提醒";
  const taskTitle = safeText(input.taskTitle, "未命名待办");
  const description = plainNotificationText(input.description, 360);
  const lines = [
    `### ${title}`,
    `**${taskTitle}**`,
    `截止时间：${escapeDingtalkMarkdown(formatDingtalkDue(input))}`,
  ];
  if (description) lines.push(`任务描述：${escapeDingtalkMarkdown(description)}`);
  return {
    title,
    markdown: lines.join("\n\n"),
    buttonText: "查看待办",
    openUrl: input.openUrl,
  };
}

function eventCopy(input: {
  notificationType: string;
  actorName: string;
  kind: NotificationKind;
  payload?: Record<string, unknown>;
}) {
  const actor = safeText(input.actorName, "团队成员", 80);
  const object = input.kind === "note" ? "笔记" : "待办";
  switch (input.notificationType) {
    case "task_assigned":
      return { heading: "📌 待办指派", summary: `${actor} 将此待办指派给你` };
    case "task_new_comment":
      return { heading: "💬 待办评论", summary: `${actor} 评论了此待办` };
    case "note_mentioned":
      return { heading: "@ 笔记提及", summary: `${actor} 在此笔记中提及了你` };
    case "todo_mentioned":
      return { heading: "@ 待办提及", summary: `${actor} 在此待办中提及了你` };
    case "comment_mention":
      return { heading: `@ ${object}提及`, summary: `${actor} 在此${object}的评论中提及了你` };
    case "participant_added":
      return { heading: "👀 添加参与者", summary: `${actor} 将你添加为此${object}的参与者` };
    case "participant_title_changed":
      return { heading: "✏️ 标题变更", summary: `${actor} 更新了此${object}的标题` };
    case "participant_status_changed": {
      const completed = String(input.payload?.after ?? "") === "completed";
      return {
        heading: "✅ 状态变更",
        summary: `${actor} 将此待办标记为${completed ? "已完成" : "未完成"}`,
      };
    }
    case "participant_new_comment":
      return { heading: "💬 新评论", summary: `${actor} 评论了你参与的此${object}` };
    case "participant_task_created": {
      const childTask = safeText(input.payload?.title, "未命名子级任务", 160);
      return { heading: "➕ 新子级任务", summary: `${actor} 添加了子级任务「${childTask}」` };
    }
    case "participant_status_changed":
      return { heading: "✅ 子级任务状态", summary: `${actor} 更新了子级任务状态` };
    case "participant_title_changed":
      return { heading: "✏️ 子级任务标题", summary: `${actor} 更新了子级任务标题` };
    default:
      return { heading: "🔔 AntTodo 通知", summary: "你有一条新通知" };
  }
}

export function buildEventNotificationCard(input: {
  notificationType: string;
  actorName: string;
  taskTitle: string;
  taskKind?: string | null;
  payload?: Record<string, unknown>;
  openUrl: string;
}): DingtalkNotificationCard {
  const kind: NotificationKind = input.taskKind === "note" ? "note" : "task";
  const copy = eventCopy({
    notificationType: input.notificationType,
    actorName: input.actorName,
    kind,
    payload: input.payload,
  });
  const taskTitle = safeText(
    input.taskTitle,
    kind === "note" ? "未命名笔记" : "未命名待办",
  );
  return {
    title: copy.heading.replace(/^[^\p{L}@]+/u, "").trim(),
    markdown: [`### ${copy.heading}`, `**${taskTitle}**`, copy.summary].join("\n\n"),
    buttonText: kind === "note" ? "查看笔记" : "查看待办",
    openUrl: input.openUrl,
  };
}
