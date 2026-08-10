import { describe, expect, it } from "vitest";
import {
  buildDueReminderCard,
  buildEventNotificationCard,
  formatDingtalkDue,
  plainNotificationText,
} from "../../supabase/functions/_shared/dingtalk-notification-cards";

const openUrl = "https://app.anttodo.com/?workspace=workspace-1&task=task-1";

describe("DingTalk notification cards", () => {
  it("formats a point-in-time deadline in the task time zone", () => {
    expect(formatDingtalkDue({
      dueAt: "2026-08-02T10:00:00.000Z",
      timeZone: "Asia/Shanghai",
    })).toBe("2026年8月2日 18:00");
  });

  it("formats timed and all-day ranges", () => {
    expect(formatDingtalkDue({
      dueStartAt: "2026-08-02T01:00:00.000Z",
      dueAt: "2026-08-02T09:30:00.000Z",
      timeZone: "Asia/Shanghai",
    })).toBe("2026年8月2日 09:00–17:30");

    expect(formatDingtalkDue({
      dueStartAt: "2026-08-01T16:00:00.000Z",
      dueAt: "2026-08-03T15:59:00.000Z",
      allDay: true,
      timeZone: "Asia/Shanghai",
    })).toBe("2026年8月2日–2026年8月3日");
  });

  it("uses Asia/Shanghai for a missing or invalid time zone", () => {
    const input = { dueAt: "2026-08-02T10:00:00.000Z" };
    expect(formatDingtalkDue(input)).toBe("2026年8月2日 18:00");
    expect(formatDingtalkDue({ ...input, timeZone: "Not/AZone" })).toBe(
      "2026年8月2日 18:00",
    );
  });

  it("omits empty descriptions and sanitizes rich text and markdown", () => {
    const empty = buildDueReminderCard({
      taskTitle: "测试一下",
      description: " <p> </p> ",
      dueAt: "2026-08-02T10:00:00.000Z",
      openUrl,
    });
    expect(empty.markdown).not.toContain("任务描述");
    expect(empty.markdown).not.toContain("任务时间到了");

    const card = buildDueReminderCard({
      taskTitle: "发布 *v1.0* [正式版]",
      description: "<p>检查 <strong>文档</strong>&amp;附件</p>",
      dueAt: "2026-08-02T10:00:00.000Z",
      openUrl,
    });
    expect(card.markdown).toContain("发布 \\*v1\\.0\\* \\[正式版\\]");
    expect(card.markdown).toContain("任务描述：检查 文档&附件");
    expect(card.buttonText).toBe("查看待办");
    expect(card.openUrl).toBe(openUrl);
  });

  it("normalizes and truncates long user content", () => {
    expect(plainNotificationText("<p>A</p>\n<br>B&nbsp;C", 20)).toBe("A B C");
    expect(plainNotificationText("任务".repeat(200), 10)).toHaveLength(10);
    expect(plainNotificationText("任务".repeat(200), 10).endsWith("…")).toBe(true);
  });

  it.each([
    "task_assigned",
    "task_new_comment",
    "note_mentioned",
    "todo_mentioned",
    "comment_mention",
    "participant_added",
    "participant_title_changed",
    "participant_status_changed",
    "participant_new_comment",
    "participant_subtask_created",
    "participant_subtask_status_changed",
    "participant_subtask_title_changed",
    "unknown_type",
  ])("builds a complete card for %s", (notificationType) => {
    const card = buildEventNotificationCard({
      notificationType,
      actorName: "张三",
      taskTitle: "季度复盘",
      taskKind: "task",
      payload: { after: "completed", title: "整理 *材料*" },
      openUrl,
    });
    expect(card.title).not.toBe("");
    expect(card.markdown).toContain("季度复盘");
    expect(card.buttonText).toBe("查看待办");
    expect(card.openUrl).toBe(openUrl);
  });

  it("uses note-specific copy and button labels", () => {
    const card = buildEventNotificationCard({
      notificationType: "comment_mention",
      actorName: "张三",
      taskTitle: "会议纪要",
      taskKind: "note",
      openUrl,
    });
    expect(card.markdown).toContain("笔记提及");
    expect(card.markdown).toContain("在此笔记的评论中提及了你");
    expect(card.buttonText).toBe("查看笔记");
  });
});
