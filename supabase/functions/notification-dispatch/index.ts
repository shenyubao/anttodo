import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import webpush from "web-push";
import {
  parsePublicConfig,
  type DingtalkPublicConfig,
} from "../_shared/dingtalk-sso.ts";
import { sendDingtalkNotification } from "../_shared/dingtalk-messaging.ts";
import { buildEventNotificationCard } from "../_shared/dingtalk-notification-cards.ts";

const SCENARIO_BY_TYPE: Record<string, string> = {
  comment_mention: "task_new_comment",
  task_assigned: "task_assigned",
  task_new_comment: "task_new_comment",
  note_mentioned: "note_mentioned",
  participant_added: "participant_added",
  participant_title_changed: "participant_title_changed",
  participant_status_changed: "participant_status_changed",
  participant_new_comment: "participant_new_comment",
  participant_subtask_created: "participant_subtask_created",
  participant_subtask_status_changed: "participant_subtask_status_changed",
  participant_subtask_title_changed: "participant_subtask_title_changed",
};

function notificationCopy(input: {
  notification_type: string;
  actorName: string;
  taskTitle: string;
  taskKind?: string;
  payload?: Record<string, unknown>;
}) {
  const title = input.taskTitle || "AntTodo";
  const actor = input.actorName || "团队成员";
  switch (input.notification_type) {
    case "task_assigned":
      return { title: "待办指派", body: `${actor} 将「${title}」指派给你` };
    case "task_new_comment":
      return { title: "待办评论", body: `${actor} 评论了「${title}」` };
    case "note_mentioned":
      return { title: "笔记提及", body: `${actor} 在笔记「${title}」中提及了你` };
    case "comment_mention":
      return {
        title: input.taskKind === "note" ? "笔记提及" : "待办提及",
        body: `${actor} 在${input.taskKind === "note" ? "笔记" : "待办"}「${title}」中引用了你`,
      };
    case "participant_added":
      return { title: "添加参与者", body: `${actor} 将你添加为「${title}」的参与者` };
    case "participant_title_changed":
      return { title: "标题变更", body: `${actor} 更新了「${title}」的标题` };
    case "participant_status_changed": {
      const after = String(input.payload?.after ?? "");
      const statusLabel = after === "completed" ? "已完成" : "未完成";
      return { title: "状态变更", body: `${actor} 将「${title}」标记为${statusLabel}` };
    }
    case "participant_new_comment":
      return { title: "新评论", body: `${actor} 评论了你参与的「${title}」` };
    case "participant_subtask_created":
      return {
        title: "新子任务",
        body: `${actor} 在「${title}」中添加了子任务「${String(input.payload?.title ?? "")}」`,
      };
    case "participant_subtask_status_changed":
      return {
        title: "子任务状态",
        body: `${actor} 更新了「${title}」的子任务状态`,
      };
    case "participant_subtask_title_changed":
      return {
        title: "子任务标题",
        body: `${actor} 更新了「${title}」的子任务标题`,
      };
    default:
      return { title: "AntTodo 通知", body: title };
  }
}

async function prefEnabled(
  // deno-lint-ignore no-explicit-any
  admin: any,
  userId: string,
  scenario: string,
  channel: "system" | "dingtalk",
) {
  const { data } = await admin
    .from("user_notification_preferences")
    .select("system_enabled, dingtalk_enabled")
    .eq("user_id", userId)
    .eq("scenario", scenario)
    .maybeSingle();
  if (!data) return true;
  return channel === "system" ? data.system_enabled !== false : data.dingtalk_enabled !== false;
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }
    const dispatchSecret = Deno.env.get("REMINDER_DISPATCH_SECRET") ?? "";
    if (!dispatchSecret || req.headers.get("x-anttodo-dispatch-secret") !== dispatchSecret) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({})) as { notification_id?: string };
    const notificationId = body.notification_id?.trim();
    if (!notificationId) {
      return Response.json({ error: "notification_id required" }, { status: 400 });
    }

    const { data: notification, error } = await ctx.supabaseAdmin
      .from("notifications")
      .select("id, workspace_id, task_id, recipient_id, actor_id, notification_type, payload")
      .eq("id", notificationId)
      .maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!notification) return Response.json({ ok: true, skipped: "missing" });

    const scenario = SCENARIO_BY_TYPE[notification.notification_type];
    if (!scenario) return Response.json({ ok: true, skipped: "unknown_type" });

    const systemOn = await prefEnabled(
      ctx.supabaseAdmin,
      notification.recipient_id,
      scenario,
      "system",
    );
    const dingtalkOn = await prefEnabled(
      ctx.supabaseAdmin,
      notification.recipient_id,
      scenario,
      "dingtalk",
    );
    if (!systemOn && !dingtalkOn) {
      return Response.json({ ok: true, skipped: "prefs_off" });
    }

    const [{ data: task }, { data: actor }] = await Promise.all([
      ctx.supabaseAdmin
        .from("tasks")
        .select("id, title, kind, workspace_id")
        .eq("id", notification.task_id)
        .maybeSingle(),
      ctx.supabaseAdmin
        .from("profiles")
        .select("display_name")
        .eq("id", notification.actor_id)
        .maybeSingle(),
    ]);

    const copy = notificationCopy({
      notification_type: notification.notification_type,
      actorName: actor?.display_name ?? "团队成员",
      taskTitle: task?.title ?? "",
      taskKind: task?.kind,
      payload: (notification.payload ?? {}) as Record<string, unknown>,
    });
    const appUrl = (Deno.env.get("PUBLIC_APP_URL") ?? "https://app.anttodo.com").replace(/\/$/, "");
    const openUrl =
      `${appUrl}/?workspace=${notification.workspace_id}&task=${notification.task_id}`;
    const dingtalkCard = buildEventNotificationCard({
      notificationType: notification.notification_type,
      actorName: actor?.display_name ?? "团队成员",
      taskTitle: task?.title ?? "",
      taskKind: task?.kind,
      payload: (notification.payload ?? {}) as Record<string, unknown>,
      openUrl,
    });

    let systemSent = 0;
    if (systemOn) {
      const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
      const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
      const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:notifications@anttodo.com";
      if (vapidPublicKey && vapidPrivateKey) {
        webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
        const { data: subscriptions } = await ctx.supabaseAdmin
          .from("web_push_subscriptions")
          .select("id, endpoint, p256dh, auth")
          .eq("user_id", notification.recipient_id)
          .is("disabled_at", null);
        const payload = JSON.stringify({
          title: copy.title,
          body: copy.body,
          tag: `notification:${notification.id}`,
          url: openUrl,
        });
        for (const subscription of subscriptions ?? []) {
          try {
            await webpush.sendNotification({
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            }, payload);
            systemSent += 1;
          } catch (cause) {
            const statusCode = Number((cause as { statusCode?: number }).statusCode ?? 0);
            if (statusCode === 404 || statusCode === 410) {
              await ctx.supabaseAdmin.from("web_push_subscriptions")
                .update({ disabled_at: new Date().toISOString() })
                .eq("id", subscription.id);
            }
          }
        }
      }
    }

    let dingtalkSent = false;
    if (dingtalkOn) {
      const { data: provider } = await ctx.supabaseAdmin
        .from("workspace_sso_providers")
        .select("id, public_config, credential_hint, enabled")
        .eq("workspace_id", notification.workspace_id)
        .eq("provider", "dingtalk")
        .eq("enabled", true)
        .maybeSingle();
      const publicConfig = parsePublicConfig(provider?.public_config) as DingtalkPublicConfig | null;
      if (provider?.credential_hint && publicConfig?.agentId) {
        const { data: secret, error: secretError } = await ctx.supabaseAdmin.rpc(
          "get_sso_provider_secret",
          { p_provider_id: provider.id },
        );
        const { data: identity } = await ctx.supabaseAdmin
          .from("sso_identities")
          .select("subject, dingtalk_userid")
          .eq("provider", "dingtalk")
          .eq("user_id", notification.recipient_id)
          .maybeSingle();
        if (!secretError && typeof secret === "string" && identity?.subject) {
          try {
            const result = await sendDingtalkNotification({
              credentials: {
                appKey: publicConfig.appKey,
                appSecret: secret,
                agentId: publicConfig.agentId,
              },
              unionId: identity.subject,
              cachedUserId: identity.dingtalk_userid,
              ...dingtalkCard,
            });
            if ("userId" in result && result.userId && result.userId !== identity.dingtalk_userid) {
              await ctx.supabaseAdmin
                .from("sso_identities")
                .update({ dingtalk_userid: result.userId, updated_at: new Date().toISOString() })
                .eq("provider", "dingtalk")
                .eq("subject", identity.subject);
            }
            if (!("skipped" in result)) dingtalkSent = true;
          } catch (cause) {
            console.error("dingtalk notification failed", cause);
          }
        }
      }
    }

    return Response.json({ ok: true, systemSent, dingtalkSent });
  }),
};
