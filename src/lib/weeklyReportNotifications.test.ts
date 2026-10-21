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

  it("puts each stored task line in its own DingTalk paragraph", () => {
    const one = "[入参校验](https://app.anttodo.com/workspaces/w/tasks/a)";
    const two = "[执行次数限制](https://app.anttodo.com/workspaces/w/tasks/b)";
    const message = buildWeeklyReportNotificationMarkdown({
      authorName: "天明",
      weekStart: "2026-09-07",
      completedText: `## RPA\n- 完成了 ${one}\n- 完成了 ${two}`,
      nextPlanText: "- 计划完成 埋点优化\r\n- 计划完成 设备权限管理",
      reflectionText: "",
      openUrl: "https://app.anttodo.com/workspaces/w/weekly-reports/r",
    });
    expect(message.text).toContain(
      `\\#\\# RPA\n\n\\- 完成了 ${one}\n\n\\- 完成了 ${two}`,
    );
    expect(message.text).toContain("\\- 计划完成 埋点优化\n\n\\- 计划完成 设备权限管理");
  });
});

describe("OKR progress notifications", () => {
  it("places the saved nested OKR markdown before completed tasks and omits an empty section", () => {
    const input = { authorName: "用户", weekStart: "2026-10-12", completedText: "任务", nextPlanText: "", reflectionText: "", openUrl: "https://app.anttodo.com/report" };
    const body = "- Objective 10%->50%\n  - KR 20%->60%\n    - 1016 正常 第一行\n      第二行";
    const text = buildWeeklyReportNotificationMarkdown({ ...input, okrProgressText: body }).text;
    expect(text).toContain(`#### OKR 进展\n\n${body}\n\n#### 本周完成`);
    expect(buildWeeklyReportNotificationMarkdown({ ...input, okrProgressText: " " }).text).not.toContain("OKR 进展");
  });
});
