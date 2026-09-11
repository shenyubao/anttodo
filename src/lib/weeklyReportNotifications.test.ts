import { describe, expect, it } from "vitest";
import {
  buildSignedDingtalkNotificationWebhook,
  buildWeeklyReportNotificationMarkdown,
  isoWeekNumber,
  validateDingtalkNotificationWebhook,
} from "../../supabase/functions/_shared/weekly-report-notifications";

describe("weekly report notification helpers", () => {
  it("accepts only DingTalk HTTPS robot send webhooks with access tokens", () => {
    expect(validateDingtalkNotificationWebhook(
      "https://oapi.dingtalk.com/robot/send?access_token=token",
    )).toBe(true);
    expect(validateDingtalkNotificationWebhook("http://oapi.dingtalk.com/robot/send?access_token=x"))
      .toBe(false);
    expect(validateDingtalkNotificationWebhook("https://dingtalk.com.example.com/robot/send?access_token=x"))
      .toBe(false);
    expect(validateDingtalkNotificationWebhook("https://oapi.dingtalk.com/not-robot?access_token=x"))
      .toBe(false);
    expect(validateDingtalkNotificationWebhook("https://oapi.dingtalk.com/robot/send"))
      .toBe(false);
  });

  it("adds deterministic timestamp and HMAC signature query parameters", async () => {
    const result = new URL(await buildSignedDingtalkNotificationWebhook(
      "https://oapi.dingtalk.com/robot/send?access_token=token",
      "SEC-test",
      1_700_000_000_000,
    ));
    expect(result.searchParams.get("access_token")).toBe("token");
    expect(result.searchParams.get("timestamp")).toBe("1700000000000");
    expect(result.searchParams.get("sign")).toBeTruthy();
  });

  it("formats the full report, date range and link while escaping user markdown", () => {
    const message = buildWeeklyReportNotificationMarkdown({
      authorName: "研发布局 #1",
      weekStart: "2026-08-31",
      completedText: "完成 *核心* 功能",
      nextPlanText: "",
      reflectionText: "保持稳定",
      openUrl: "https://app.anttodo.com/workspaces/w/weekly-reports/r",
    });
    expect(isoWeekNumber("2026-08-31")).toBe(36);
    expect(message.text).toContain("研发布局 \\#1 的第 36 周周报");
    expect(message.text).toContain("2026年8月31日 - 2026年9月6日");
    expect(message.text).toContain("完成 \\*核心\\* 功能");
    expect(message.text).toContain("#### 本周完成\n\n完成 \\*核心\\* 功能\n\n#### 下周计划");
    expect(message.text).toContain("#### 下周计划\n\n未填写\n\n#### 总结感想");
    expect(message.text).toContain("[查看周报](https://app.anttodo.com/workspaces/w/weekly-reports/r)");
  });

  it("keeps task detail links clickable in DingTalk markdown", () => {
    const taskLink = "[上线](https://app.anttodo.com/workspaces/w/tasks/t)";
    const message = buildWeeklyReportNotificationMarkdown({
      authorName: "研发布局",
      weekStart: "2026-08-31",
      completedText: `- 完成了 ${taskLink}`,
      nextPlanText: "",
      reflectionText: "保持 *稳定*",
      openUrl: "https://app.anttodo.com/workspaces/w/weekly-reports/r",
    });
    expect(message.text).toContain(`\\- 完成了 ${taskLink}`);
    expect(message.text).toContain("保持 \\*稳定\\*");
  });
});
