import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDesktopReminderEntries,
  desktopNotificationCopy,
  plainNotificationBody,
  scenarioForNotification,
  shouldShowSystemNotification,
  showDesktopSystemNotification,
} from "./desktopNotifications";
import { defaultNotificationPreferences } from "./notificationPreferences";
import type { AppNotification, Task } from "../types";

const originalDesktop = window.anttodoDesktop;
const originalNotification = window.Notification;

afterEach(() => {
  window.anttodoDesktop = originalDesktop;
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: originalNotification,
  });
  vi.restoreAllMocks();
});

function task(patch: Partial<Task> & Pick<Task, "id" | "created_by">): Task {
  return {
    workspace_id: "ws-1",
    title: "示例任务",
    description: "<p>准备材料</p>",
    kind: "todo",
    status: "open",
    priority: "none",
    due_at: "2026-08-08T10:00:00.000Z",
    due_start_at: "2026-08-08T10:00:00.000Z",
    due_is_all_day: false,
    due_timezone: "Asia/Shanghai",
    recurrence: null,
    estimate_hours: null,
    actual_hours: null,
    estimate_pomodoros: null,
    actual_pomodoros: null,
    assignee_id: null,
    cli_assignee: null,
    completed_at: null,
    deleted_at: null,
    version: 1,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    label_ids: [],
    participant_ids: [],
    subtasks: [],
    reminders: [],
    reminder_persistent: false,
    description_mentions: [],
    ...patch,
  };
}

describe("desktopNotifications", () => {
  it("strips html for native notification bodies", () => {
    expect(plainNotificationBody("<p>A</p>\n<br>B&nbsp;C")).toBe("A B&nbsp;C");
  });

  it("builds reminder entries for the current recipient within the horizon", () => {
    const entries = buildDesktopReminderEntries(
      [
        task({
          id: "task-1",
          created_by: "user-1",
          assignee_id: "user-1",
          reminders: [{
            id: "reminder-1",
            task_id: "task-1",
            subtask_id: null,
            position: 0,
            anchor: "start",
            offset_value: 0,
            offset_unit: "minute",
            local_time: null,
            trigger_at: "2026-08-08T10:05:00.000Z",
            created_by: "user-1",
            created_at: "2026-08-01T00:00:00.000Z",
            updated_at: "2026-08-01T00:00:00.000Z",
          }],
        }),
        task({
          id: "task-2",
          created_by: "user-2",
          assignee_id: "user-2",
          reminders: [{
            id: "reminder-2",
            task_id: "task-2",
            subtask_id: null,
            position: 0,
            anchor: "start",
            offset_value: 0,
            offset_unit: "minute",
            local_time: null,
            trigger_at: "2026-08-08T10:05:00.000Z",
            created_by: "user-2",
            created_at: "2026-08-01T00:00:00.000Z",
            updated_at: "2026-08-01T00:00:00.000Z",
          }],
        }),
      ],
      "ws-1",
      "user-1",
      { now: new Date("2026-08-08T10:00:00.000Z").getTime() },
    );

    expect(entries).toEqual([{
      id: "reminder-1:0",
      reminderId: "reminder-1",
      taskId: "task-1",
      workspaceId: "ws-1",
      title: "示例任务",
      body: "准备材料",
      triggerAt: "2026-08-08T10:05:00.000Z",
    }]);
  });

  it("maps notification types to preference scenarios", () => {
    expect(scenarioForNotification({
      notification_type: "comment_mention",
      task: { id: "t1", title: "笔记", kind: "note", description: "" },
    } as AppNotification)).toBe("note_mentioned");

    const prefs = defaultNotificationPreferences();
    prefs.task_assigned.systemEnabled = false;
    expect(shouldShowSystemNotification({
      notification_type: "task_assigned",
    } as AppNotification, prefs)).toBe(false);
  });

  it("prefers the Electron native notification bridge", async () => {
    const show = vi.fn().mockResolvedValue(true);
    window.anttodoDesktop = {
      platform: "darwin",
      notifications: { show },
    } as unknown as Window["anttodoDesktop"];

    await expect(showDesktopSystemNotification({
      title: "任务",
      body: "有人指派给你",
      workspaceId: "ws-1",
      taskId: "task-1",
    })).resolves.toBe(true);
    expect(show).toHaveBeenCalledWith({
      title: "任务",
      body: "有人指派给你",
      workspaceId: "ws-1",
      taskId: "task-1",
    });
  });

  it("builds plain desktop copy for collaboration notifications", () => {
    expect(desktopNotificationCopy({
      id: "n1",
      workspace_id: "ws-1",
      task_id: "task-1",
      comment_id: null,
      recipient_id: "user-1",
      actor_id: "user-2",
      notification_type: "task_assigned",
      read_at: null,
      created_at: "2026-08-08T10:00:00.000Z",
      actor: {
        id: "user-2",
        display_name: "阿珍",
        avatar_url: null,
      },
      task: {
        id: "task-1",
        title: "准备演示",
        kind: "todo",
        description: "",
      },
    })).toEqual({
      title: "准备演示",
      body: "阿珍 将待办指派给你",
    });
  });
});
