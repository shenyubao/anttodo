import { describe, expect, it, vi } from "vitest";
import { buildWeeklyReportReminderMarkdown, sendWeeklyReportReminder, type WeeklyReportReminderDelivery } from "../../supabase/functions/_shared/weekly-report-reminders";

const delivery: WeeklyReportReminderDelivery = {
  delivery_id: "delivery", claim_token: "claim", workspace_id: "workspace", week_start: "2026-10-12",
  credentials: { webhook: "https://oapi.dingtalk.com/robot/send?access_token=test", signingSecret: "test" },
  snapshot: { workspaceName: "研发团队", total: 2, submitted: 1, submittedNames: ["张三"], missingNames: ["李四"] },
};
describe("weekly report progress reminders", () => {
  it("includes week, counts, both rosters and the configured instance link without report content", () => {
    const result = buildWeeklyReportReminderMarkdown(delivery, "https://todo.yuce-tech.cn");
    expect(result.text).toContain("第 42 周");
    expect(result.text).toContain("10月12日–10月18日");
    expect(result.text).toContain("应填 **2** 人 · 已交 **1** 人 · 未交 **1** 人");
    expect(result.text).toContain("已交：张三");
    expect(result.text).toContain("未交：李四");
    expect(result.text).toContain("https://todo.yuce-tech.cn/workspaces/workspace/weekly-reports");
    expect(result.text).not.toContain("已停止");
  });
  it("includes the report group name and a link to that group", () => {
    const result = buildWeeklyReportReminderMarkdown({ ...delivery, weekly_report_group_id: "group-a", snapshot: { ...delivery.snapshot, groupName: "研发周报" } });
    expect(result.title).toContain("研发团队 · 研发周报");
    expect(result.text).toContain("/weekly-reports/groups/group-a");
  });
  it("announces the per-group stop only when a nonempty roster is all published", () => {
    expect(buildWeeklyReportReminderMarkdown({ ...delivery, snapshot: { ...delivery.snapshot, submitted: 2, missingNames: [], submittedNames: ["张三", "李四"] } }).text).toContain("当前群本周后续提醒已停止");
    expect(buildWeeklyReportReminderMarkdown({ ...delivery, snapshot: { ...delivery.snapshot, total: 0, submitted: 0 } }).text).not.toContain("已停止");
  });
  it("escapes names and handles the ISO week year boundary", () => {
    const result = buildWeeklyReportReminderMarkdown({ ...delivery, week_start: "2025-12-29", snapshot: { ...delivery.snapshot, missingNames: ["[某人](https://evil.invalid)\n# title"] } });
    expect(result.text).toContain("2026年第 1 周");
    expect(result.text).toContain("未交：\\[某人\\]");
    expect(result.text).not.toContain("\n# title");
  });
  it("sends signed markdown without an all-members mention", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ errcode: 0 }));
    await sendWeeklyReportReminder(delivery, undefined, request);
    const [url, options] = request.mock.calls[0];
    expect(String(url)).toContain("sign=");
    expect(JSON.parse(String(options?.body))).toMatchObject({ msgtype: "markdown", at: { isAtAll: false } });
  });
  it.each([Response.json({ errcode: 310000, errmsg: "rate limited" }), new Response("bad gateway", { status: 502 })])("does not treat a provider error as success", async (response) => {
    await expect(sendWeeklyReportReminder(delivery, undefined, vi.fn<typeof fetch>().mockResolvedValue(response))).rejects.toThrow();
  });
});
