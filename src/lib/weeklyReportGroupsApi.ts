import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeeklyReportGroup } from "../types";
import { supabase } from "./supabase";

export const weeklyReportGroupsKey = (workspaceId: string) => ["weekly-report-groups", workspaceId, "v1"] as const;

export async function loadWeeklyReportGroups(client: SupabaseClient, workspaceId: string) {
  const { data, error } = await client.rpc("list_weekly_report_groups", { p_workspace_id: workspaceId });
  if (error) throw new Error(error.message);
  return (data ?? []) as WeeklyReportGroup[];
}

export function useWeeklyReportGroups(workspaceId: string, demoMode: boolean) {
  return useQuery({
    queryKey: weeklyReportGroupsKey(workspaceId),
    queryFn: () => loadWeeklyReportGroups(supabase!, workspaceId),
    enabled: Boolean(supabase) && !demoMode,
  });
}

export type SaveWeeklyReportGroupInput = Pick<WeeklyReportGroup,
  "name" | "participant_ids" | "visibility" | "viewer_user_ids" | "viewer_group_ids" |
  "enabled" | "schedules" | "notification_group_ids"> & { id?: string };

export async function saveWeeklyReportGroup(client: SupabaseClient, workspaceId: string, input: SaveWeeklyReportGroupInput) {
  const { data, error } = await client.rpc("save_weekly_report_group", {
    p_workspace_id: workspaceId, p_id: input.id ?? null, p_name: input.name.trim(),
    p_participant_ids: input.participant_ids, p_visibility: input.visibility,
    p_viewer_user_ids: input.visibility === "selected" ? input.viewer_user_ids : [],
    p_viewer_group_ids: input.visibility === "selected" ? input.viewer_group_ids : [],
    p_enabled: input.enabled && input.participant_ids.length > 0,
    p_schedules: input.schedules, p_notification_group_ids: input.notification_group_ids,
  });
  if (error) throw new Error(error.message);
  const saved = Array.isArray(data) ? data[0] : data;
  if (!saved) throw new Error("周报组保存成功，但服务端未返回记录");
  return { ...saved, can_view_published: true } as WeeklyReportGroup;
}

export function createDemoWeeklyReportGroups(workspaceId: string, participantIds: string[]): WeeklyReportGroup[] {
  return [{ id: `demo-weekly-group-${workspaceId}`, workspace_id: workspaceId, name: "默认周报组",
    is_default: true, participant_ids: participantIds, visibility: "workspace", viewer_user_ids: [],
    viewer_group_ids: [], enabled: false, schedules: [], notification_group_ids: [], created_at: "", updated_at: "" }];
}
