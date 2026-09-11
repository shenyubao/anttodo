import { dingtalkGroupRobotSignature } from "./dingtalk-signature.ts";

export type WeeklyReportNotificationMessageInput = {
  authorName: string;
  weekStart: string;
  completedText: string;
  nextPlanText: string;
  reflectionText: string;
  openUrl: string;
};

export function validateDingtalkNotificationWebhook(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && (!url.port || url.port === "443")
      && !url.username
      && !url.password
      && (url.hostname === "dingtalk.com" || url.hostname.endsWith(".dingtalk.com"))
      && url.pathname.replace(/\/+$/, "") === "/robot/send"
      && Boolean(url.searchParams.get("access_token"));
  } catch {
    return false;
  }
}

export async function buildSignedDingtalkNotificationWebhook(
  webhook: string,
  signingSecret: string,
  now = Date.now(),
) {
  if (!validateDingtalkNotificationWebhook(webhook)) {
    throw new Error("群 WebHook 无效");
  }
  const timestamp = String(now);
  const signature = await dingtalkGroupRobotSignature(timestamp, signingSecret);
  const url = new URL(webhook);
  url.searchParams.set("timestamp", timestamp);
  url.searchParams.set("sign", signature);
  return url.toString();
}

const WEEKLY_REPORT_LINK_RE = /\[(?:\\.|[^\]])+\]\(https?:\/\/[^)\s]+\)/g;

function escapeMarkdown(value: string) {
  return value.replace(/([\\`*_{}\[\]()#+\-.!>|])/g, "\\$1");
}

function escapeMarkdownPreservingLinks(value: string) {
  let result = "";
  let lastIndex = 0;
  for (const match of value.matchAll(WEEKLY_REPORT_LINK_RE)) {
    const index = match.index ?? 0;
    result += escapeMarkdown(value.slice(lastIndex, index));
    result += match[0];
    lastIndex = index + match[0].length;
  }
  result += escapeMarkdown(value.slice(lastIndex));
  return result;
}

function displaySection(value: string) {
  const normalized = value.trim();
  return normalized ? escapeMarkdownPreservingLinks(normalized) : "未填写";
}

function formatDate(date: Date) {
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
}

export function isoWeekNumber(weekStart: string) {
  const date = new Date(`${weekStart}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return 0;
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + 3);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() + (3 - ((firstThursday.getUTCDay() + 6) % 7)));
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604_800_000);
}

export function buildWeeklyReportNotificationMarkdown(
  input: WeeklyReportNotificationMessageInput,
) {
  const start = new Date(`${input.weekStart}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const week = isoWeekNumber(input.weekStart);
  const author = escapeMarkdown(input.authorName.trim() || "团队成员");
  const title = `${author} 的第 ${week} 周周报`;
  return {
    title: `${input.authorName.trim() || "团队成员"}的周报`,
    text: [
      `### ${title}`,
      `${formatDate(start)} - ${formatDate(end)}`,
      "",
      "#### 本周完成",
      "",
      displaySection(input.completedText),
      "",
      "#### 下周计划",
      "",
      displaySection(input.nextPlanText),
      "",
      "#### 总结感想",
      "",
      displaySection(input.reflectionText),
      "",
      `[查看周报](${input.openUrl})`,
    ].join("\n"),
  };
}
