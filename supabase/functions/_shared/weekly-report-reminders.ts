import { publicAppUrl } from "./app-url.ts";
import { buildSignedDingtalkNotificationWebhook, isoWeekNumber } from "./weekly-report-notifications.ts";

export type WeeklyReportReminderSnapshot = {
  workspaceName: string;
  groupName?: string;
  total: number;
  submitted: number;
  submittedNames: string[];
  missingNames: string[];
};
export type WeeklyReportReminderDelivery = {
  delivery_id: string;
  claim_token: string;
  workspace_id: string;
  weekly_report_group_id?: string;
  week_start: string;
  credentials: { webhook: string; signingSecret: string };
  snapshot: WeeklyReportReminderSnapshot;
};
const escape = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/([\\`*_{}\[\]()#+\-.!>|])/g, "\\$1");

export function buildWeeklyReportReminderMarkdown(delivery: Pick<WeeklyReportReminderDelivery, "workspace_id" | "weekly_report_group_id" | "week_start" | "snapshot">, appUrl?: string) {
  const { snapshot, week_start: weekStart } = delivery;
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  const date = (value: Date) => `${value.getUTCMonth() + 1}月${value.getUTCDate()}日`;
  const title = `${snapshot.workspaceName}${snapshot.groupName ? ` · ${snapshot.groupName}` : ""} · 周报完成汇总`;
  return {
    title,
    text: [
      `### ${escape(title)}`,
      `${new Date(start.getTime() + 3 * 86_400_000).getUTCFullYear()}年第 ${isoWeekNumber(weekStart)} 周 · ${date(start)}–${date(end)}`,
      "",
      `应填 **${snapshot.total}** 人 · 已交 **${snapshot.submitted}** 人 · 未交 **${snapshot.total - snapshot.submitted}** 人`,
      "",
      `已交：${snapshot.submittedNames.map(escape).join("、") || "无"}`,
      "",
      `未交：${snapshot.missingNames.map(escape).join("、") || "无"}`,
      "",
      ...(snapshot.total > 0 && snapshot.submitted === snapshot.total ? ["本周全员完成，当前群本周后续提醒已停止。", ""] : []),
      `[查看周报](${publicAppUrl(appUrl)}/workspaces/${encodeURIComponent(delivery.workspace_id)}/weekly-reports${delivery.weekly_report_group_id ? `/groups/${encodeURIComponent(delivery.weekly_report_group_id)}` : ""})`,
    ].join("\n\n"),
  };
}

export async function sendWeeklyReportReminder(delivery: WeeklyReportReminderDelivery, appUrl?: string, request: typeof fetch = fetch) {
  const url = await buildSignedDingtalkNotificationWebhook(delivery.credentials.webhook, delivery.credentials.signingSecret);
  const response = await request(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ msgtype: "markdown", markdown: buildWeeklyReportReminderMarkdown(delivery, appUrl), at: { isAtAll: false } }),
  });
  const result = await response.json().catch(() => ({})) as { errcode?: number; errmsg?: string };
  if (!response.ok || result.errcode !== 0) throw new Error(result.errmsg || `钉钉返回 HTTP ${response.status}`);
}
