import { parseTaskDateText, type ParsedTaskDue } from "./task-date-parser.ts";
import { verifyDingtalkGroupRobotSignature } from "./dingtalk-signature.ts";

export {
  dingtalkGroupRobotSignature,
  verifyDingtalkGroupRobotSignature,
} from "./dingtalk-signature.ts";

export const DINGTALK_GROUP_ROBOT_TIME_ZONE = "Asia/Shanghai";
export const DINGTALK_GROUP_ROBOT_USAGE =
  "@机器人 任务内容（可选：@负责人 #标签 明天下午3点）";
export const DINGTALK_GROUP_ROBOT_DISPLAY_NAMES = ["蚂蚁清单", "AntTodo"] as const;
export const DINGTALK_GROUP_ROBOT_MAX_IMAGES = 9;

export type DingtalkGroupRobotMessagePayload = {
  msgtype?: unknown;
  text?: { content?: unknown };
  content?: { richText?: unknown };
};

export type DingtalkGroupRobotImageReference = {
  downloadCode: string;
};

export type DingtalkGroupRobotTaskText =
  | { kind: "help" }
  | {
      kind: "task";
      title: string;
      labelNames: string[];
      due: ParsedTaskDue | null;
    };

function normalizeSpaces(value: string) {
  return value.replace(/[\t\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

/** Extract task text from the message formats DingTalk sends to enterprise robots. */
export function extractDingtalkGroupRobotMessageText(
  payload: DingtalkGroupRobotMessagePayload,
) {
  const msgtype = typeof payload.msgtype === "string"
    ? payload.msgtype.trim().toLocaleLowerCase("en-US")
    : "";
  if (msgtype === "text") {
    return typeof payload.text?.content === "string" ? payload.text.content : null;
  }
  if (msgtype !== "richtext" || !Array.isArray(payload.content?.richText)) {
    return null;
  }

  return payload.content.richText
    .map((item) => {
      if (!item || typeof item !== "object" || !("text" in item)) return "";
      return typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join(" ")
    .trim();
}

/** Return unique image download codes from a DingTalk rich-text message. */
export function extractDingtalkGroupRobotImageReferences(
  payload: DingtalkGroupRobotMessagePayload,
) {
  const msgtype = typeof payload.msgtype === "string"
    ? payload.msgtype.trim().toLocaleLowerCase("en-US")
    : "";
  if (msgtype !== "richtext" || !Array.isArray(payload.content?.richText)) {
    return [];
  }

  const references: DingtalkGroupRobotImageReference[] = [];
  const seen = new Set<string>();
  for (const item of payload.content.richText) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.type !== "picture") continue;
    const downloadCode = [record.downloadCode, record.pictureDownloadCode]
      .find((value): value is string => typeof value === "string" && Boolean(value.trim()))
      ?.trim();
    if (!downloadCode || seen.has(downloadCode)) continue;
    seen.add(downloadCode);
    references.push({ downloadCode });
    if (references.length >= DINGTALK_GROUP_ROBOT_MAX_IMAGES) break;
  }
  return references;
}

export function parseDingtalkGroupRobotTaskText(
  content: string,
  options?: { now?: Date; botDisplayNames?: readonly string[] },
): DingtalkGroupRobotTaskText {
  const botDisplayNames = options?.botDisplayNames ?? DINGTALK_GROUP_ROBOT_DISPLAY_NAMES;
  const escapedBotNames = botDisplayNames
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  let normalizedContent = content;
  if (escapedBotNames.length > 0) {
    // Users can continue typing immediately after selecting the bot mention.
    // Strip the known leading bot name before the generic mention pass so the
    // first task word is not swallowed when DingTalk omits the separating space.
    normalizedContent = normalizedContent.replace(
      new RegExp(`^\\s*@(?:${escapedBotNames.join("|")})\\s*`, "iu"),
      "",
    );
  }
  const labelNames: string[] = [];
  let text = normalizedContent.replace(/(?:^|\s)#([^\s@#]+)/gu, (match, label: string) => {
    const normalized = label.trim();
    if (normalized && !labelNames.includes(normalized)) labelNames.push(normalized);
    return match.startsWith(" ") ? " " : "";
  });

  // DingTalk may retain display-form mentions in text.content even though atUsers
  // already carries the stable identifiers. Remove every visible mention here.
  text = text.replace(/(?:^|\s)@[^\s@#]+/gu, (match) =>
    match.startsWith(" ") ? " " : "");
  text = normalizeSpaces(text);
  text = text.replace(/^(?:新建|创建)(?:任务|待办)?(?:\s+|[：:]+\s*)/u, "").trim();

  if (/^(?:帮助|help|\?)$/iu.test(text) || !text) return { kind: "help" };

  const parsed = parseTaskDateText(text, {
    now: options?.now,
    timeZone: DINGTALK_GROUP_ROBOT_TIME_ZONE,
  });
  const title = normalizeSpaces(parsed?.title ?? text)
    .replace(/^[，,、；;：:。.!！?？\s]+/u, "");
  if (!title) return { kind: "help" };
  return {
    kind: "task",
    title,
    labelNames,
    due: parsed?.due ?? null,
  };
}

export function isAllowedDingtalkSessionWebhook(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (!url.port || url.port === "443") &&
      !url.username && !url.password &&
      (url.hostname === "dingtalk.com" || url.hostname.endsWith(".dingtalk.com"));
  } catch {
    return false;
  }
}

export type DingtalkRobotAtUser = {
  dingtalkId?: unknown;
  staffId?: unknown;
  userId?: unknown;
};

export function dingtalkAtUserIdentifier(user: DingtalkRobotAtUser) {
  for (const value of [user.staffId, user.userId, user.dingtalkId]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
