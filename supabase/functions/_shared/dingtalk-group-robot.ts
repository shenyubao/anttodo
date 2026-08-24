import { parseTaskDateText, type ParsedTaskDue } from "./task-date-parser.ts";

export const DINGTALK_GROUP_ROBOT_TIME_ZONE = "Asia/Shanghai";
export const DINGTALK_GROUP_ROBOT_USAGE =
  "@机器人 任务内容（可选：@负责人 #标签 明天下午3点）";
export const DINGTALK_GROUP_ROBOT_DISPLAY_NAMES = ["蚂蚁清单", "AntTodo"] as const;

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

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function dingtalkGroupRobotSignature(
  timestamp: string,
  appSecret: string,
) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}\n${appSecret}`),
  );
  return bytesToBase64(new Uint8Array(signature));
}

function normalizeSignature(value: string) {
  try {
    return decodeURIComponent(value).replace(/ /g, "+");
  } catch {
    return value.replace(/ /g, "+");
  }
}

export async function verifyDingtalkGroupRobotSignature(input: {
  timestamp: string;
  signature: string;
  appSecret: string;
  now?: number;
  maxAgeMs?: number;
}) {
  const timestampNumber = Number(input.timestamp);
  if (!Number.isFinite(timestampNumber)) return false;
  if (Math.abs((input.now ?? Date.now()) - timestampNumber) > (input.maxAgeMs ?? 60 * 60_000)) {
    return false;
  }
  const expected = await dingtalkGroupRobotSignature(
    input.timestamp,
    input.appSecret,
  );
  const actual = normalizeSignature(input.signature);
  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return difference === 0;
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
