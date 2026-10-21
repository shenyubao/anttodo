import {
  notificationHeadlineText,
  notificationSummary,
} from "./notificationCopy";
import { desktopReminderOccurrences } from "./reminders";
import type {
  AppNotification,
  NotificationPreferences,
  NotificationScenario,
  Task,
} from "../types";

export const DESKTOP_REMINDER_RECOVERY_MS = 5 * 60 * 1000;
export const DESKTOP_REMINDER_HORIZON_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_DESKTOP_REMINDER_ENTRIES = 500;

export type DesktopReminderEntry = {
  id: string;
  reminderId: string;
  taskId: string;
  workspaceId: string;
  title: string;
  body: string;
  triggerAt: string;
};

export function plainNotificationBody(value: string | null | undefined, maxLength = 160) {
  const text = String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function scenarioForNotification(
  item: AppNotification,
): NotificationScenario | null {
  switch (item.notification_type) {
    case "comment_mention":
      return item.task?.kind === "note" ? "note_mentioned" : "todo_mentioned";
    case "task_assigned":
    case "task_new_comment":
    case "todo_mentioned":
    case "note_mentioned":
    case "participant_added":
    case "participant_title_changed":
    case "participant_status_changed":
    case "participant_new_comment":
    case "participant_task_created":
    case "participant_status_changed":
    case "participant_title_changed":
      return item.notification_type;
    default:
      return null;
  }
}

export function buildDesktopReminderEntries(
  tasks: Task[],
  workspaceId: string,
  userId: string,
  options?: { now?: number },
): DesktopReminderEntry[] {
  const now = options?.now ?? Date.now();
  const entries: DesktopReminderEntry[] = [];

  for (const task of tasks) {
    if (task.status !== "open" || task.deleted_at) continue;

    const reminderSources = [
      {
        title: task.title,
        body: task.description,
        recipientId: task.assignee_id ?? task.created_by,
        reminders: task.reminders ?? [],
        persistent: task.reminder_persistent,
        skip: false,
      },
      ...task.children.map((childTask) => ({
        title: childTask.title,
        body: childTask.description,
        recipientId: childTask.assignee_id ?? task.assignee_id ?? task.created_by,
        reminders: childTask.reminders ?? [],
        persistent: childTask.reminder_persistent,
        skip: childTask.status !== "open",
      })),
    ];
    for (const source of reminderSources) {
      if (source.skip || source.recipientId !== userId) continue;
      for (const reminder of source.reminders) {
        for (const occurrence of desktopReminderOccurrences(
          reminder,
          source.persistent,
        )) {
          const at = new Date(occurrence.triggerAt).getTime();
          if (!Number.isFinite(at)) continue;
          if (at < now - DESKTOP_REMINDER_RECOVERY_MS) continue;
          if (at > now + DESKTOP_REMINDER_HORIZON_MS) continue;
          entries.push({
            id: occurrence.id,
            reminderId: occurrence.reminderId,
            taskId: task.id,
            workspaceId,
            title: source.title.trim() || "AntTodo 提醒",
            body: plainNotificationBody(source.body) || "任务时间到了",
            triggerAt: occurrence.triggerAt,
          });
          if (entries.length >= MAX_DESKTOP_REMINDER_ENTRIES) return entries;
        }
      }
    }
  }

  return entries;
}

export function desktopNotificationCopy(item: AppNotification) {
  const title = item.task?.title?.trim() || "AntTodo";
  const headline = notificationHeadlineText(item);
  const summary = plainNotificationBody(notificationSummary(item), 120);
  return {
    title,
    body: summary ? `${headline} · ${summary}` : headline,
  };
}

export function shouldShowSystemNotification(
  item: AppNotification,
  preferences: NotificationPreferences,
) {
  if (item.notification_type === "okr_mentioned") return false;
  const scenario = scenarioForNotification(item);
  if (!scenario) return true;
  return preferences[scenario]?.systemEnabled !== false;
}

export async function showDesktopSystemNotification(input: {
  title: string;
  body: string;
  workspaceId?: string;
  taskId?: string;
  tag?: string;
}) {
  if (window.anttodoDesktop?.notifications?.show) {
    return window.anttodoDesktop.notifications.show({
      title: input.title,
      body: input.body,
      workspaceId: input.workspaceId,
      taskId: input.taskId,
    });
  }

  if (
    typeof window.Notification === "undefined"
    || Notification.permission !== "granted"
  ) {
    return false;
  }

  try {
    new Notification(input.title, {
      body: input.body,
      ...(input.tag ? { tag: input.tag } : {}),
    });
    return true;
  } catch {
    return false;
  }
}
