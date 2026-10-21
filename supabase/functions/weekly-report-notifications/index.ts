import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { resolveUser } from "../_shared/resolveUser.ts";
import { buildWeeklyReportOpenUrl } from "../_shared/app-url.ts";
import {
  buildSignedDingtalkNotificationWebhook,
  buildWeeklyReportNotificationMarkdown,
  validateDingtalkNotificationWebhook,
} from "../_shared/weekly-report-notifications.ts";

type RequestBody =
  | {
      action: "create-group";
      workspaceId: string;
      type: "dingtalk";
      name: string;
      webhook: string;
      signingSecret: string;
    }
  | { action: "delete-group"; groupId: string }
  | {
      action: "dispatch" | "retry-failed";
      reportId: string;
      revision: number;
    };

type ClaimedDelivery = {
  delivery_id: string;
  notification_group_id: string;
  group_name: string;
  credentials: unknown;
};

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function requiredText(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${label}无效`);
  }
  return value.trim();
}

function credentialValue(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("通知群凭据无效");
  const candidate = value as { webhook?: unknown; signingSecret?: unknown };
  return {
    webhook: requiredText(candidate.webhook, "群 WebHook", 4000),
    signingSecret: requiredText(candidate.signingSecret, "安全加签", 1000),
  };
}

async function deliverySummary(
  // deno-lint-ignore no-explicit-any
  admin: any,
  reportId: string,
  revision: number,
) {
  const { data: rows, error } = await admin
    .from("weekly_report_notification_deliveries")
    .select("notification_group_id,status")
    .eq("report_id", reportId)
    .eq("revision", revision);
  if (error) throw new Error(error.message);
  const groupIds = [...new Set((rows ?? []).map((row: { notification_group_id: string }) => row.notification_group_id))];
  const { data: groups, error: groupError } = groupIds.length
    ? await admin.from("weekly_report_notification_groups").select("id,name").in("id", groupIds)
    : { data: [], error: null };
  if (groupError) throw new Error(groupError.message);
  const names = new Map((groups ?? []).map((group: { id: string; name: string }) => [group.id, group.name]));
  const failedRows = (rows ?? []).filter((row: { status: string }) => row.status === "failed");
  return {
    revision,
    total: rows?.length ?? 0,
    sent: (rows ?? []).filter((row: { status: string }) => row.status === "sent").length,
    failed: failedRows.length,
    pending: (rows ?? []).filter((row: { status: string }) =>
      row.status === "pending" || row.status === "sending").length,
    failedGroupNames: failedRows.map((row: { notification_group_id: string }) =>
      names.get(row.notification_group_id) ?? "已删除通知群"),
  };
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return jsonError("Method not allowed", 405);
    const user = await resolveUser(req, ctx.supabaseAdmin);
    if (!user) return jsonError("请先登录后再继续", 401);

    let body: RequestBody;
    try {
      body = await req.json() as RequestBody;
    } catch {
      return jsonError("请求内容无效", 400);
    }

    if (body.action === "create-group") {
      try {
        const workspaceId = requiredText(body.workspaceId, "团队空间 ID", 100);
        const name = requiredText(body.name, "群名称", 100);
        const webhook = requiredText(body.webhook, "群 WebHook", 4000);
        const signingSecret = requiredText(body.signingSecret, "安全加签", 1000);
        if (body.type !== "dingtalk") return jsonError("群类型无效", 422);
        if (!validateDingtalkNotificationWebhook(webhook)) {
          return jsonError("请输入有效的钉钉群机器人 WebHook", 422);
        }
        const { data, error } = await ctx.supabaseAdmin.rpc(
          "create_weekly_report_notification_group",
          {
            p_workspace_id: workspaceId,
            p_actor_id: user.id,
            p_type: body.type,
            p_name: name,
            p_credentials: { webhook, signingSecret },
          },
        );
        if (error) return jsonError(error.message, 422);
        const row = Array.isArray(data) ? data[0] : data;
        return Response.json({
          group: row ? {
            id: row.id,
            workspace_id: row.workspace_id,
            type: row.type,
            name: row.name,
            created_at: row.created_at,
            updated_at: row.updated_at,
          } : null,
        });
      } catch (error) {
        return jsonError(error instanceof Error ? error.message : "创建通知群失败", 422);
      }
    }

    if (body.action === "delete-group") {
      const groupId = typeof body.groupId === "string" ? body.groupId.trim() : "";
      if (!groupId) return jsonError("通知群 ID 无效", 422);
      const { error } = await ctx.supabaseAdmin.rpc(
        "delete_weekly_report_notification_group",
        { p_group_id: groupId, p_actor_id: user.id },
      );
      if (error) {
        const denied = error.code === "42501" || /access denied/i.test(error.message);
        return jsonError(
          denied ? "通知群不存在或无权删除" : error.message,
          denied ? 404 : 500,
        );
      }
      return Response.json({ ok: true });
    }

    if (body.action !== "dispatch" && body.action !== "retry-failed") {
      return jsonError("不支持的操作", 400);
    }
    const reportId = typeof body.reportId === "string" ? body.reportId.trim() : "";
    const revision = Number(body.revision);
    if (!reportId || !Number.isSafeInteger(revision) || revision < 1) {
      return jsonError("周报发送参数无效", 422);
    }
    const { data: report, error: reportError } = await ctx.supabaseAdmin
      .from("weekly_reports")
      .select("id,workspace_id,weekly_report_group_id,author_id,week_start,okr_progress_text,completed_text,next_plan_text,reflection_text,status,notification_revision")
      .eq("id", reportId)
      .eq("author_id", user.id)
      .eq("notification_revision", revision)
      .maybeSingle();
    if (reportError) return jsonError(reportError.message, 500);
    if (!report || report.status !== "published") {
      return jsonError("周报不存在、版本已过期或无权发送", 404);
    }

    const { data: participant, error: participantError } = await ctx.supabaseAdmin
      .from("weekly_report_groups").select("id")
      .eq("workspace_id", report.workspace_id).eq("id", report.weekly_report_group_id)
      .contains("participant_ids", [user.id]).maybeSingle();
    if (participantError) return jsonError("读取周报填写权限失败", 500);
    if (!participant) return jsonError("仅人员配置中的成员可以发送周报通知", 403);

    const [{ data: author }, { data: claimed, error: claimError }] = await Promise.all([
      ctx.supabaseAdmin.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
      ctx.supabaseAdmin.rpc("claim_weekly_report_notification_deliveries", {
        p_report_id: reportId,
        p_revision: revision,
        p_actor_id: user.id,
        p_retry_failed: body.action === "retry-failed",
      }),
    ]);
    if (claimError) return jsonError(claimError.message, 422);

    const message = buildWeeklyReportNotificationMarkdown({
      authorName: author?.display_name ?? user.email ?? "团队成员",
      weekStart: report.week_start,
      okrProgressText: report.okr_progress_text ?? "",
      completedText: report.completed_text,
      nextPlanText: report.next_plan_text,
      reflectionText: report.reflection_text,
      openUrl: buildWeeklyReportOpenUrl(
        report.workspace_id,
        report.id,
        Deno.env.get("PUBLIC_APP_URL"),
      ),
    });

    await Promise.allSettled(((claimed ?? []) as ClaimedDelivery[]).map(async (delivery) => {
      try {
        const credentials = credentialValue(delivery.credentials);
        const target = await buildSignedDingtalkNotificationWebhook(
          credentials.webhook,
          credentials.signingSecret,
        );
        const response = await fetch(target, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            msgtype: "markdown",
            markdown: message,
            at: { isAtAll: false },
          }),
        });
        const result = await response.json().catch(() => ({})) as {
          errcode?: number;
          errmsg?: string;
        };
        if (!response.ok || result.errcode !== 0) {
          throw new Error(result.errmsg || `钉钉返回 HTTP ${response.status}`);
        }
        const { error } = await ctx.supabaseAdmin
          .from("weekly_report_notification_deliveries")
          .update({ status: "sent", sent_at: new Date().toISOString(), error_message: null })
          .eq("id", delivery.delivery_id)
          .eq("status", "sending");
        if (error) throw new Error(error.message);
      } catch (error) {
        await ctx.supabaseAdmin
          .from("weekly_report_notification_deliveries")
          .update({
            status: "failed",
            sent_at: null,
            error_message: (error instanceof Error ? error.message : "发送失败").slice(0, 500),
          })
          .eq("id", delivery.delivery_id)
          .eq("status", "sending");
      }
    }));

    try {
      return Response.json({
        ok: true,
        summary: await deliverySummary(ctx.supabaseAdmin, reportId, revision),
      });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "读取发送状态失败", 500);
    }
  }),
};
