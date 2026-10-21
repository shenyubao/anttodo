import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { sendWeeklyReportReminder, type WeeklyReportReminderDelivery } from "../_shared/weekly-report-reminders.ts";

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    const secret = Deno.env.get("REMINDER_DISPATCH_SECRET");
    if (!secret || req.headers.get("x-anttodo-dispatch-secret") !== secret) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data, error } = await ctx.supabaseAdmin.rpc("claim_weekly_report_reminders");
    if (error) return Response.json({ error: "领取周报提醒失败" }, { status: 500 });
    let sent = 0;
    let failed = 0;
    const results = await Promise.allSettled(((data ?? []) as WeeklyReportReminderDelivery[]).map(async (delivery) => {
      let failure: string | null = null;
      try {
        await sendWeeklyReportReminder(delivery, Deno.env.get("PUBLIC_APP_URL"));
      } catch {
        // Provider errors can contain the WebHook token. Keep ledger and logs credential-free.
        failure = "钉钉汇总发送失败，将自动重试";
      }
      const { error: finishError } = await ctx.supabaseAdmin.rpc("finish_weekly_report_reminder", {
        p_delivery_id: delivery.delivery_id, p_claim_token: delivery.claim_token, p_error: failure,
      });
      if (finishError) throw new Error("记录周报提醒发送结果失败");
      if (failure) failed += 1; else sent += 1;
    }));
    const unrecorded = results.filter((result) => result.status === "rejected").length;
    if (unrecorded) console.error("weekly-report-reminders: unrecorded deliveries", unrecorded);
    return Response.json({ sent, failed, unrecorded }, { status: unrecorded ? 500 : 200 });
  }),
};
