import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sendDingtalkNotification,
  sendDingtalkWorkNotice,
} from "../../supabase/functions/_shared/dingtalk-messaging";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DingTalk work notice transport", () => {
  it("sends a single-button action card", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errcode: 0, task_id: 123 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendDingtalkWorkNotice({
      accessToken: "token",
      agentId: "1001",
      userIds: ["user-a", "user-b"],
      title: "待办提醒",
      markdown: "### 待办提醒\n\n**测试一下**",
      buttonText: "查看待办",
      openUrl: "https://app.anttodo.com/?workspace=w&task=t",
    })).resolves.toEqual({ taskId: 123 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      agent_id: 1001,
      userid_list: "user-a,user-b",
      msg: {
        msgtype: "action_card",
        action_card: {
          title: "待办提醒",
          markdown: "### 待办提醒\n\n**测试一下**",
          single_title: "查看待办",
          single_url: "https://app.anttodo.com/?workspace=w&task=t",
        },
      },
    });
  });

  it("uses the cached DingTalk userid and forwards the complete card", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        errcode: 0,
        access_token: "access-token",
        expires_in: 7200,
      }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errcode: 0, task_id: 456 }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendDingtalkNotification({
      credentials: {
        appKey: "test-card-app-key",
        appSecret: "secret",
        agentId: "1001",
      },
      unionId: "union-id",
      cachedUserId: "cached-user-id",
      title: "待办评论",
      markdown: "### 待办评论",
      buttonText: "查看待办",
      openUrl: "https://app.anttodo.com/?workspace=w&task=t",
    })).resolves.toEqual({ userId: "cached-user-id" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, sendInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(sendInit.body));
    expect(body.userid_list).toBe("cached-user-id");
    expect(body.msg.action_card.single_url).toContain("task=t");
  });
});
