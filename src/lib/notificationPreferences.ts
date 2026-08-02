import type { NotificationChannelPreferences, NotificationScenario } from "../types";

export const NOTIFICATION_SCENARIOS: Array<{
  id: NotificationScenario;
  label: string;
}> = [
  { id: "task_assigned", label: "待办-被指派" },
  { id: "task_due_reminder", label: "待办-到期提醒" },
  { id: "task_new_comment", label: "待办-有新的评论" },
  { id: "note_mentioned", label: "笔记-被提及" },
  { id: "participant_title_changed", label: "待办参与者-标题变更" },
  { id: "participant_status_changed", label: "待办参与者-状态变更" },
  { id: "participant_new_comment", label: "待办参与者-有新的评论" },
  { id: "participant_subtask_created", label: "待办参与者-有新的子任务" },
  { id: "participant_subtask_status_changed", label: "待办参与者-子任务状态变更" },
  { id: "participant_subtask_title_changed", label: "待办参与者-子任务标题变更" },
];

export const DEFAULT_CHANNEL_PREFERENCES: NotificationChannelPreferences = {
  systemEnabled: true,
  dingtalkEnabled: true,
};

export function defaultNotificationPreferences(): Record<
  NotificationScenario,
  NotificationChannelPreferences
> {
  return Object.fromEntries(
    NOTIFICATION_SCENARIOS.map((scenario) => [
      scenario.id,
      { ...DEFAULT_CHANNEL_PREFERENCES },
    ]),
  ) as Record<NotificationScenario, NotificationChannelPreferences>;
}

export function mergeNotificationPreferenceRows(
  rows: Array<{
    scenario: string;
    system_enabled: boolean;
    dingtalk_enabled: boolean;
  }>,
): Record<NotificationScenario, NotificationChannelPreferences> {
  const next = defaultNotificationPreferences();
  for (const row of rows) {
    if (!(row.scenario in next)) continue;
    next[row.scenario as NotificationScenario] = {
      systemEnabled: row.system_enabled,
      dingtalkEnabled: row.dingtalk_enabled,
    };
  }
  return next;
}
