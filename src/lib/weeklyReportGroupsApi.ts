import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeeklyReport, WeeklyReportGroup } from "../types";
import { supabase } from "./supabase";

export const weeklyReportGroupsKey = (workspaceId: string) => ["weekly-report-groups", workspaceId, "v1"] as const;

/** Old persisted snapshots predate participant sources and creator attribution. */
export function normalizeWeeklyReportGroup(group: WeeklyReportGroup): WeeklyReportGroup {
  return { ...group, created_by: group.created_by ?? null, participant_mode: group.participant_mode ?? "users", participant_group_ids: group.participant_group_ids ?? [] };
}

function normalizeWeeklyReportGroups(groups: WeeklyReportGroup[]) {
  return groups.map(normalizeWeeklyReportGroup);
}

export async function loadWeeklyReportGroups(client: SupabaseClient, workspaceId: string) {
  const { data, error } = await client.rpc("list_weekly_report_groups", { p_workspace_id: workspaceId });
  if (error) throw new Error(error.message);
  return normalizeWeeklyReportGroups((data ?? []) as WeeklyReportGroup[]);
}

export function useWeeklyReportGroups(workspaceId: string, demoMode: boolean) {
  return useQuery({
    queryKey: weeklyReportGroupsKey(workspaceId),
    queryFn: () => loadWeeklyReportGroups(supabase!, workspaceId),
    select: normalizeWeeklyReportGroups,
    enabled: Boolean(supabase) && !demoMode,
  });
}

export type SaveWeeklyReportGroupInput = Pick<WeeklyReportGroup,
  "name" | "participant_ids" | "participant_mode" | "participant_group_ids" | "visibility" | "viewer_user_ids" | "viewer_group_ids" |
  "enabled" | "schedules" | "notification_group_ids"> & { id?: string };

export async function saveWeeklyReportGroup(client: SupabaseClient, workspaceId: string, input: SaveWeeklyReportGroupInput) {
  const { data, error } = await client.rpc("save_weekly_report_group", {
    p_workspace_id: workspaceId, p_id: input.id ?? null, p_name: input.name.trim(),
    p_participant_ids: input.participant_mode === "groups" ? [] : input.participant_ids,
    p_participant_mode: input.participant_mode,
    p_participant_group_ids: input.participant_mode === "groups" ? input.participant_group_ids : [],
    p_visibility: input.visibility,
    p_viewer_user_ids: input.visibility === "selected" ? input.viewer_user_ids : [],
    p_viewer_group_ids: input.visibility === "selected" ? input.viewer_group_ids : [],
    p_enabled: input.enabled && input.participant_ids.length > 0,
    p_schedules: input.schedules, p_notification_group_ids: input.notification_group_ids,
  });
  if (error) throw new Error(error.message);
  const saved = Array.isArray(data) ? data[0] : data;
  if (!saved) throw new Error("周报组保存成功，但服务端未返回记录");
  return normalizeWeeklyReportGroup({ ...saved, can_view_published: true } as WeeklyReportGroup);
}

export function createDemoWeeklyReportGroups(workspaceId: string, participantIds: string[]): WeeklyReportGroup[] {
  return [{ id: `demo-weekly-group-${workspaceId}`, workspace_id: workspaceId, name: "默认周报组",
    is_default: true, created_by: null, participant_mode: "users", participant_group_ids: [], participant_ids: participantIds, visibility: "workspace", viewer_user_ids: [],
    viewer_group_ids: [], enabled: false, schedules: [], notification_group_ids: [], created_at: "", updated_at: "" }];
}

export async function deleteWeeklyReportGroup(client: SupabaseClient, workspaceId: string, groupId: string) {
  const { data, error } = await client.rpc("delete_weekly_report_group", { p_workspace_id: workspaceId, p_id: groupId });
  if (error) throw new Error(error.message);
  if (data !== groupId) throw new Error("无法确认删除结果，请刷新周报组后核对。");
}

/** Remove confirmed deletions from feeds, details and persisted query snapshots. */
export async function clearDeletedWeeklyReportGroupCache(client: QueryClient, workspaceId: string, groupId: string) {
  await Promise.all([
    client.cancelQueries({ queryKey: weeklyReportGroupsKey(workspaceId) }),
    client.cancelQueries({ queryKey: ["weekly-reports", workspaceId] }),
    client.cancelQueries({ queryKey: ["weekly-report", workspaceId] }),
  ]);
  client.setQueryData<WeeklyReportGroup[]>(weeklyReportGroupsKey(workspaceId), (groups = []) => groups.filter((item) => item.id !== groupId));
  client.removeQueries({ queryKey: ["weekly-reports", workspaceId], predicate: (query) => query.queryKey[3] === groupId });
  for (const query of client.getQueryCache().findAll({ queryKey: ["weekly-report", workspaceId] })) {
    const report = query.state.data as WeeklyReport | null | undefined;
    if (report?.weekly_report_group_id === groupId) {
      // Notify active observers before detaching the query; they must not keep a
      // deleted private report alive after a remote/cached route is reopened.
      client.setQueryData(query.queryKey, null);
      client.removeQueries({ queryKey: query.queryKey, exact: true });
    }
  }
  void client.invalidateQueries({ queryKey: weeklyReportGroupsKey(workspaceId) });
}
