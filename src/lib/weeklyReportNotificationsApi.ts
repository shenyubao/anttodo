import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  WeeklyReportNotificationGroup,
  WeeklyReportNotificationSummary,
} from "../types";
import { supabase } from "./supabase";
import { edgeFunctionErrorMessage } from "./sso";

export function weeklyReportNotificationGroupsKey(workspaceId: string) {
  return ["weekly-report-notification-groups", workspaceId] as const;
}

export async function loadWeeklyReportNotificationGroups(
  client: SupabaseClient,
  workspaceId: string,
) {
  const { data, error } = await client
    .from("weekly_report_notification_groups")
    .select("id,workspace_id,type,name,created_at,updated_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as WeeklyReportNotificationGroup[];
}

async function invokeNotificationAction(body: Record<string, unknown>) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data, error } = await supabase.functions.invoke("weekly-report-notifications", { body });
  if (error) {
    throw new Error(await edgeFunctionErrorMessage(error, data, "周报群通知请求失败"));
  }
  return data as Record<string, unknown>;
}

export async function createWeeklyReportNotificationGroup(input: {
  workspaceId: string;
  name: string;
  webhook: string;
  signingSecret: string;
}) {
  const data = await invokeNotificationAction({
    action: "create-group",
    type: "dingtalk",
    ...input,
  });
  const group = Array.isArray(data.group) ? data.group[0] : data.group;
  if (!group) throw new Error("通知群创建成功，但服务端未返回记录");
  return group as WeeklyReportNotificationGroup;
}

export async function deleteWeeklyReportNotificationGroup(groupId: string) {
  await invokeNotificationAction({ action: "delete-group", groupId });
}

export async function dispatchWeeklyReportNotifications(input: {
  reportId: string;
  revision: number;
  retryFailed?: boolean;
}) {
  const data = await invokeNotificationAction({
    action: input.retryFailed ? "retry-failed" : "dispatch",
    reportId: input.reportId,
    revision: input.revision,
  });
  const raw = data.summary as {
    revision?: unknown;
    total?: unknown;
    sent?: unknown;
    failed?: unknown;
    pending?: unknown;
    failedGroupNames?: unknown;
  } | undefined;
  if (!raw) throw new Error("服务端未返回群通知状态");
  return {
    revision: Number(raw.revision ?? 0),
    total: Number(raw.total ?? 0),
    sent: Number(raw.sent ?? 0),
    failed: Number(raw.failed ?? 0),
    pending: Number(raw.pending ?? 0),
    failed_group_names: Array.isArray(raw.failedGroupNames)
      ? raw.failedGroupNames.map(String)
      : [],
  } satisfies WeeklyReportNotificationSummary;
}
