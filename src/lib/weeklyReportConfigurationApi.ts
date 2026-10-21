import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { WeeklyReportConfiguration, WeeklyReportReminderTime } from "../types";

export const weeklyReportConfigurationKey = (workspaceId: string) =>
  ["weekly-report-configuration", workspaceId] as const;

export async function loadWeeklyReportConfiguration(client: SupabaseClient, workspaceId: string) {
  const { data, error } = await client.rpc("get_weekly_report_configuration", { p_workspace_id: workspaceId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("周报配置不可用，请刷新后重试");
  return data as WeeklyReportConfiguration;
}

export function useWeeklyReportConfiguration(workspaceId: string, demoMode: boolean) {
  return useQuery({
    queryKey: weeklyReportConfigurationKey(workspaceId),
    queryFn: () => loadWeeklyReportConfiguration(supabase!, workspaceId),
    enabled: Boolean(supabase) && !demoMode,
  });
}

export async function saveWeeklyReportParticipants(client: SupabaseClient, workspaceId: string, userIds: string[]) {
  const { data, error } = await client.rpc("save_weekly_report_participants", {
    p_workspace_id: workspaceId, p_user_ids: userIds,
  });
  if (error) throw new Error(error.message);
  return data as WeeklyReportConfiguration;
}

export async function saveWeeklyReportReminders(client: SupabaseClient, workspaceId: string, input: {
  enabled: boolean; schedules: WeeklyReportReminderTime[]; notification_group_ids: string[];
}) {
  const { data, error } = await client.rpc("save_weekly_report_reminders", {
    p_workspace_id: workspaceId, p_enabled: input.enabled,
    p_schedules: input.schedules, p_group_ids: input.notification_group_ids,
  });
  if (error) throw new Error(error.message);
  return data as WeeklyReportConfiguration;
}
