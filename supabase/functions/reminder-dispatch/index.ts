import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import webpush from "web-push";
import { parsePublicConfig } from "../_shared/dingtalk-sso.ts";
import { sendDingtalkNotification } from "../_shared/dingtalk-messaging.ts";
import { buildDueReminderCard } from "../_shared/dingtalk-notification-cards.ts";
import { buildTaskOpenUrl } from "../_shared/app-url.ts";

const encoder = new TextEncoder();

async function dueReminderPrefEnabled(
  // deno-lint-ignore no-explicit-any
  admin: any,
  userId: string,
  channel: "system" | "dingtalk",
) {
  const { data } = await admin
    .from("user_notification_preferences")
    .select("system_enabled, dingtalk_enabled")
    .eq("user_id", userId)
    .eq("scenario", "task_due_reminder")
    .maybeSingle();
  if (!data) return true;
  return channel === "system" ? data.system_enabled !== false : data.dingtalk_enabled !== false;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function tokenFor(id: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(id));
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    const dispatchSecret = Deno.env.get("REMINDER_DISPATCH_SECRET") ?? "";
    if (!dispatchSecret || req.headers.get("x-anttodo-dispatch-secret") !== dispatchSecret) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:notifications@anttodo.com";
    const functionUrl = `${(Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "")}/functions/v1/reminder-ack`;
    const acknowledgementSecret = Deno.env.get("REMINDER_ACK_SECRET") ?? dispatchSecret;
    if (!vapidPublicKey || !vapidPrivateKey) {
      return Response.json({ error: "VAPID is not configured" }, { status: 503 });
    }
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const now = new Date();
    const recent = new Date(now.getTime() - 90_000).toISOString();
    const { data: dueReminders, error: dueError } = await ctx.supabaseAdmin
      .from("task_reminders")
      .select("id, task_id, task_id, trigger_at, tasks!inner(id, title, description, status, deleted_at, assignee_id, created_by, workspace_id, task_reminder_settings(persistent)), children(id, title, description, completed, assignee_id, childTask_reminder_settings(persistent))")
      .gte("trigger_at", recent)
      .lte("trigger_at", now.toISOString());
    if (dueError) return Response.json({ error: dueError.message }, { status: 500 });

    for (const reminder of dueReminders ?? []) {
      const task = Array.isArray(reminder.tasks) ? reminder.tasks[0] : reminder.tasks;
      const childTask = Array.isArray(reminder.children) ? reminder.children[0] : reminder.children;
      if (!task || task.status !== "open" || task.deleted_at) continue;
      if (reminder.task_id && (!childTask || childTask.completed)) continue;
      const id = crypto.randomUUID();
      const token = await tokenFor(id, acknowledgementSecret);
      const parentSettings = Array.isArray(task.task_reminder_settings)
        ? task.task_reminder_settings[0]
        : task.task_reminder_settings;
      const childTaskSettings = Array.isArray(childTask?.childTask_reminder_settings)
        ? childTask.childTask_reminder_settings[0]
        : childTask?.childTask_reminder_settings;
      await ctx.supabaseAdmin.from("reminder_delivery_states").upsert({
        id,
        reminder_id: reminder.id,
        scheduled_for: reminder.trigger_at,
        recipient_id: childTask?.assignee_id ?? task.assignee_id ?? task.created_by,
        persistent: (reminder.task_id ? childTaskSettings?.persistent : parentSettings?.persistent) ?? false,
        next_delivery_at: reminder.trigger_at,
        acknowledgement_token_hash: await sha256(token),
      }, { onConflict: "reminder_id,scheduled_for,recipient_id", ignoreDuplicates: true });
    }

    const { data: deliveries, error: deliveryError } = await ctx.supabaseAdmin
      .from("reminder_delivery_states")
      .select("*, task_reminders!inner(id, task_id, task_id, tasks!inner(id, title, description, status, deleted_at, workspace_id, due_at, due_start_at, due_is_all_day, due_timezone), children(id, title, description, completed, due_at, due_start_at, due_is_all_day, due_timezone))")
      .is("acknowledged_at", null)
      .is("cancelled_at", null)
      .lte("next_delivery_at", now.toISOString())
      .limit(200);
    if (deliveryError) return Response.json({ error: deliveryError.message }, { status: 500 });

    let sent = 0;
    for (const delivery of deliveries ?? []) {
      const reminder = Array.isArray(delivery.task_reminders)
        ? delivery.task_reminders[0] : delivery.task_reminders;
      const task = Array.isArray(reminder?.tasks) ? reminder.tasks[0] : reminder?.tasks;
      const childTask = Array.isArray(reminder?.children) ? reminder.children[0] : reminder?.children;
      if (!task || task.status !== "open" || task.deleted_at || (reminder?.task_id && (!childTask || childTask.completed))) {
        await ctx.supabaseAdmin.from("reminder_delivery_states")
          .update({ cancelled_at: now.toISOString() }).eq("id", delivery.id);
        continue;
      }
      const reminderTitle = childTask?.title || task.title;
      const reminderDescription = childTask?.description || task.description;
      const reminderDue = childTask ?? task;
      const token = await tokenFor(delivery.id, acknowledgementSecret);
      const systemOn = await dueReminderPrefEnabled(
        ctx.supabaseAdmin,
        delivery.recipient_id,
        "system",
      );
      const dingtalkOn = await dueReminderPrefEnabled(
        ctx.supabaseAdmin,
        delivery.recipient_id,
        "dingtalk",
      );

      if (systemOn) {
        const { data: subscriptions } = await ctx.supabaseAdmin
          .from("web_push_subscriptions")
          .select("id, endpoint, p256dh, auth")
          .eq("user_id", delivery.recipient_id)
          .is("disabled_at", null);
        const taskOpenUrl = buildTaskOpenUrl(
          task.workspace_id,
          task.id,
          task.kind,
          Deno.env.get("PUBLIC_APP_URL"),
        );
        const payload = JSON.stringify({
          title: reminderTitle || "AntTodo 提醒",
          body: reminderDescription?.replace(/<[^>]*>/g, "").slice(0, 160) || "任务时间到了",
          tag: `task-reminder:${delivery.id}`,
          url: taskOpenUrl,
          acknowledgeUrl: functionUrl,
          acknowledgementToken: token,
        });
        for (const subscription of subscriptions ?? []) {
          try {
            await webpush.sendNotification({
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            }, payload);
            sent += 1;
          } catch (cause) {
            const statusCode = Number((cause as { statusCode?: number }).statusCode ?? 0);
            if (statusCode === 404 || statusCode === 410) {
              await ctx.supabaseAdmin.from("web_push_subscriptions")
                .update({ disabled_at: now.toISOString() }).eq("id", subscription.id);
            }
          }
        }
      }

      if (dingtalkOn) {
        const openUrl = buildTaskOpenUrl(
          task.workspace_id,
          task.id,
          task.kind,
          Deno.env.get("PUBLIC_APP_URL"),
        );
        const card = buildDueReminderCard({
          taskTitle: reminderTitle,
          description: reminderDescription,
          dueAt: reminderDue.due_at,
          dueStartAt: reminderDue.due_start_at,
          allDay: reminderDue.due_is_all_day,
          timeZone: reminderDue.due_timezone,
          openUrl,
        });
        const { data: provider } = await ctx.supabaseAdmin
          .from("workspace_sso_providers")
          .select("id, public_config, credential_hint, enabled")
          .eq("workspace_id", task.workspace_id)
          .eq("provider", "dingtalk")
          .eq("enabled", true)
          .maybeSingle();
        const publicConfig = parsePublicConfig(provider?.public_config);
        if (provider?.credential_hint && publicConfig?.agentId) {
          const { data: secret } = await ctx.supabaseAdmin.rpc("get_sso_provider_secret", {
            p_provider_id: provider.id,
          });
          const { data: identity } = await ctx.supabaseAdmin
            .from("sso_identities")
            .select("subject, dingtalk_userid")
            .eq("provider", "dingtalk")
            .eq("user_id", delivery.recipient_id)
            .maybeSingle();
          if (typeof secret === "string" && identity?.subject) {
            try {
              const result = await sendDingtalkNotification({
                credentials: {
                  appKey: publicConfig.appKey,
                  appSecret: secret,
                  agentId: publicConfig.agentId,
                },
                unionId: identity.subject,
                cachedUserId: identity.dingtalk_userid,
                ...card,
              });
              if ("userId" in result && result.userId && result.userId !== identity.dingtalk_userid) {
                await ctx.supabaseAdmin
                  .from("sso_identities")
                  .update({
                    dingtalk_userid: result.userId,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("provider", "dingtalk")
                  .eq("subject", identity.subject);
              }
            } catch (cause) {
              console.error("dingtalk due reminder failed", cause);
            }
          }
        }
      }

      if (!systemOn && !dingtalkOn) {
        // Preferencing both channels off: acknowledge delivery without pushing.
        if (!delivery.first_sent_at) {
          await ctx.supabaseAdmin.from("reminder_delivery_states").update({
            first_sent_at: now.toISOString(),
            cancelled_at: now.toISOString(),
          }).eq("id", delivery.id);
        } else {
          await ctx.supabaseAdmin.from("reminder_delivery_states").update({
            cancelled_at: now.toISOString(),
          }).eq("id", delivery.id);
        }
        continue;
      }

      if (!delivery.first_sent_at) {
        await ctx.supabaseAdmin.from("reminder_delivery_states").update({
          first_sent_at: now.toISOString(),
          next_delivery_at: new Date(now.getTime() + 120_000).toISOString(),
          ...(!delivery.persistent ? { cancelled_at: now.toISOString() } : {}),
        }).eq("id", delivery.id);
      } else {
        const nextRepeat = delivery.repeat_count + 1;
        await ctx.supabaseAdmin.from("reminder_delivery_states").update({
          repeat_count: nextRepeat,
          next_delivery_at: new Date(now.getTime() + 120_000).toISOString(),
          ...(nextRepeat >= 15 ? { cancelled_at: now.toISOString() } : {}),
        }).eq("id", delivery.id);
      }
    }
    return Response.json({ created: dueReminders?.length ?? 0, deliveries: deliveries?.length ?? 0, sent });
  }),
};
