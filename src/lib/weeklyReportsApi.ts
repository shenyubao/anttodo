import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  WeeklyReport,
  WeeklyReportNotificationSummary,
  WeeklyReportVisibility,
} from "../types";

function assertNoError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

type WeeklyReportRow = Omit<WeeklyReport,
  "user_acl_ids" | "group_acl_ids" | "notification_group_ids" | "notification_summary">;

async function attachWeeklyReportAcl(client: SupabaseClient, rows: WeeklyReportRow[]) {
  if (!rows.length) return [] as WeeklyReport[];
  const reportIds = rows.map((row) => row.id);
  const [usersResult, groupsResult, targetsResult, deliveriesResult] = await Promise.all([
    client.from("weekly_report_user_acl").select("report_id,user_id").in("report_id", reportIds),
    client.from("weekly_report_group_acl").select("report_id,group_id").in("report_id", reportIds),
    client.from("weekly_report_notification_targets")
      .select("report_id,notification_group_id").in("report_id", reportIds),
    client.from("weekly_report_notification_deliveries")
      .select("report_id,revision,notification_group_id,status").in("report_id", reportIds),
  ]);
  assertNoError(usersResult.error);
  assertNoError(groupsResult.error);
  assertNoError(targetsResult.error);
  assertNoError(deliveriesResult.error);
  const failedGroupIds = [...new Set((deliveriesResult.data ?? [])
    .filter((item) => item.status === "failed")
    .map((item) => String(item.notification_group_id)))];
  const notificationGroupsResult = failedGroupIds.length
    ? await client.from("weekly_report_notification_groups").select("id,name").in("id", failedGroupIds)
    : { data: [], error: null };
  assertNoError(notificationGroupsResult.error);
  const notificationGroupNames = new Map(
    (notificationGroupsResult.data ?? []).map((item) => [String(item.id), String(item.name)]),
  );
  return rows.map((row) => ({
    ...row,
    user_acl_ids: (usersResult.data ?? [])
      .filter((item) => item.report_id === row.id)
      .map((item) => String(item.user_id)),
    group_acl_ids: (groupsResult.data ?? [])
      .filter((item) => item.report_id === row.id)
      .map((item) => String(item.group_id)),
    notification_group_ids: (targetsResult.data ?? [])
      .filter((item) => item.report_id === row.id)
      .map((item) => String(item.notification_group_id)),
    notification_summary: notificationSummary(
      row.notification_revision,
      (deliveriesResult.data ?? []).filter((item) =>
        item.report_id === row.id && Number(item.revision) === Number(row.notification_revision)),
      notificationGroupNames,
    ),
  })) as WeeklyReport[];
}

function notificationSummary(
  revision: number,
  deliveries: Array<{ notification_group_id: unknown; status: unknown }>,
  groupNames: Map<string, string>,
): WeeklyReportNotificationSummary | null {
  if (!deliveries.length) return null;
  const failed = deliveries.filter((item) => item.status === "failed");
  return {
    revision: Number(revision),
    total: deliveries.length,
    sent: deliveries.filter((item) => item.status === "sent").length,
    failed: failed.length,
    pending: deliveries.filter((item) => item.status === "pending" || item.status === "sending").length,
    failed_group_names: failed.map((item) =>
      groupNames.get(String(item.notification_group_id)) ?? "已删除通知群"),
  };
}

export function weeklyReportsKey(workspaceId: string, weekStart: string) {
  return ["weekly-reports", workspaceId, weekStart] as const;
}

export function weeklyReportDetailKey(workspaceId: string, reportId: string) {
  return ["weekly-report", workspaceId, reportId] as const;
}

export async function loadWeeklyReports(
  client: SupabaseClient,
  workspaceId: string,
  weekStart: string,
) {
  const { data, error } = await client.from("weekly_reports")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("week_start", weekStart)
    .order("updated_at", { ascending: false });
  assertNoError(error);
  return attachWeeklyReportAcl(client, (data ?? []) as WeeklyReportRow[]);
}

export async function loadWeeklyReport(
  client: SupabaseClient,
  workspaceId: string,
  reportId: string,
) {
  const { data, error } = await client.from("weekly_reports")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", reportId)
    .maybeSingle();
  assertNoError(error);
  if (!data) return null;
  return (await attachWeeklyReportAcl(client, [data as WeeklyReportRow]))[0] ?? null;
}

export type SaveWeeklyReportInput = {
  id?: string | null;
  workspaceId: string;
  weekStart: string;
  completedText: string;
  nextPlanText: string;
  reflectionText: string;
  visibility: WeeklyReportVisibility;
  userIds: string[];
  groupIds: string[];
  notificationGroupIds: string[];
  publish: boolean;
};

export async function saveWeeklyReport(client: SupabaseClient, input: SaveWeeklyReportInput) {
  const { data, error } = await client.rpc("save_weekly_report", {
    p_workspace_id: input.workspaceId,
    p_week_start: input.weekStart,
    p_completed_text: input.completedText,
    p_next_plan_text: input.nextPlanText,
    p_reflection_text: input.reflectionText,
    p_visibility: input.visibility,
    p_user_ids: input.visibility === "users" ? input.userIds : [],
    p_group_ids: input.visibility === "groups" ? input.groupIds : [],
    p_report_id: input.id ?? null,
    p_publish: input.publish,
    p_notification_group_ids: input.notificationGroupIds,
  });
  assertNoError(error);
  const savedRow = Array.isArray(data) ? data[0] : data;
  if (!savedRow) throw new Error("周报保存成功，但服务端未返回记录");
  return {
    ...(savedRow as WeeklyReportRow),
    user_acl_ids: input.visibility === "users" ? input.userIds : [],
    group_acl_ids: input.visibility === "groups" ? input.groupIds : [],
    notification_group_ids: input.notificationGroupIds,
    notification_summary: null,
  } satisfies WeeklyReport;
}

export async function deleteWeeklyReport(client: SupabaseClient, reportId: string) {
  const { error } = await client.from("weekly_reports").delete().eq("id", reportId);
  assertNoError(error);
}
