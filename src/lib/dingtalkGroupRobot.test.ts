import { describe, expect, it } from "vitest";
import { toDateInput } from "./dateTimePreferences";
import {
  dingtalkAtUserIdentifier,
  dingtalkGroupRobotSignature,
  isAllowedDingtalkSessionWebhook,
  parseDingtalkGroupRobotTaskText,
  verifyDingtalkGroupRobotSignature,
} from "./dingtalkGroupRobot";

describe("DingTalk group robot task text", () => {
  const now = new Date("2026-08-09T02:00:00.000Z");

  it("strips mentions, command words, labels, and the shared date expression", () => {
    const parsed = parseDingtalkGroupRobotTaskText(
      "@蚂蚁清单 新建 @产品同学 修复登录 #前端 明天下午3点",
      { now },
    );

    expect(parsed.kind).toBe("task");
    if (parsed.kind !== "task") return;
    expect(parsed.title).toBe("修复登录");
    expect(parsed.labelNames).toEqual(["前端"]);
    expect(new Date(parsed.due!.due_at!).toISOString()).toBe("2026-08-10T07:00:00.000Z");
    expect(parsed.due?.due_timezone).toBe("Asia/Shanghai");
  });

  it("supports direct content and de-duplicates label names", () => {
    const parsed = parseDingtalkGroupRobotTaskText("整理发布说明 #发布 #发布", { now });
    expect(parsed).toMatchObject({
      kind: "task",
      title: "整理发布说明",
      labelNames: ["发布"],
      due: null,
    });
  });

  it("parses dotted numeric due dates without treating version numbers as dates", () => {
    const parsed = parseDingtalkGroupRobotTaskText(
      "RPA独立分支合并回魔方，出包3.60 2026.9.2 #研发团队",
      { now },
    );
    expect(parsed.kind).toBe("task");
    if (parsed.kind !== "task") return;
    expect(parsed.title).toBe("RPA独立分支合并回魔方，出包3.60");
    expect(parsed.labelNames).toEqual(["研发团队"]);
    expect(parsed.due?.due_is_all_day).toBe(true);
    expect(toDateInput(parsed.due!.due_at!, "Asia/Shanghai")).toBe("2026-09-02");
  });

  it("interprets relative days at the Shanghai calendar boundary", () => {
    const parsed = parseDingtalkGroupRobotTaskText(
      "发布版本 明天下午3点",
      { now: new Date("2026-08-09T16:30:00.000Z") },
    );
    expect(parsed.kind).toBe("task");
    if (parsed.kind !== "task") return;
    expect(new Date(parsed.due!.due_at!).toISOString()).toBe("2026-08-11T07:00:00.000Z");
  });

  it("returns help for help commands or an empty task", () => {
    expect(parseDingtalkGroupRobotTaskText("@蚂蚁清单 help")).toEqual({ kind: "help" });
    expect(parseDingtalkGroupRobotTaskText("@蚂蚁清单 #不存在")).toEqual({ kind: "help" });
  });
});

describe("DingTalk group robot request security", () => {
  it("verifies fresh HMAC signatures and rejects changed or stale requests", async () => {
    const timestamp = "1786231200000";
    const appSecret = "test-app-secret";
    const signature = await dingtalkGroupRobotSignature(timestamp, appSecret);
    await expect(verifyDingtalkGroupRobotSignature({
      timestamp,
      signature: encodeURIComponent(signature),
      appSecret,
      now: Number(timestamp),
    })).resolves.toBe(true);
    await expect(verifyDingtalkGroupRobotSignature({
      timestamp,
      signature,
      appSecret: "different-secret",
      now: Number(timestamp),
    })).resolves.toBe(false);
    await expect(verifyDingtalkGroupRobotSignature({
      timestamp,
      signature,
      appSecret,
      now: Number(timestamp) + 60 * 60_000 + 1,
    })).resolves.toBe(false);
  });

  it("allows only HTTPS DingTalk session webhooks", () => {
    expect(isAllowedDingtalkSessionWebhook(
      "https://oapi.dingtalk.com/robot/sendBySession?session=abc",
    )).toBe(true);
    expect(isAllowedDingtalkSessionWebhook("http://oapi.dingtalk.com/robot/send")).toBe(false);
    expect(isAllowedDingtalkSessionWebhook("https://dingtalk.com.example.com/robot/send")).toBe(false);
    expect(isAllowedDingtalkSessionWebhook("https://user@oapi.dingtalk.com/robot/send")).toBe(false);
  });
});

describe("DingTalk mention identifiers", () => {
  it("prefers stable staff and user identifiers", () => {
    expect(dingtalkAtUserIdentifier({
      staffId: "staff-1",
      userId: "user-1",
      dingtalkId: "ding-1",
    })).toBe("staff-1");
    expect(dingtalkAtUserIdentifier({ dingtalkId: "ding-1" })).toBe("ding-1");
  });
});
