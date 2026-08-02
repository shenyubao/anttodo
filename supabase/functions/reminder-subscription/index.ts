import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return error("Method not allowed", 405);
    const userId = ctx.userClaims?.id;
    if (!userId) return error("Authentication required", 401);
    const body = await req.json();
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
    if (body.action === "config") return Response.json({ vapidPublicKey });
    if (body.action !== "upsert") return error("Unsupported action");
    const subscription = body.subscription;
    if (
      typeof subscription?.endpoint !== "string"
      || typeof subscription?.keys?.p256dh !== "string"
      || typeof subscription?.keys?.auth !== "string"
    ) return error("Invalid push subscription");

    const expiration = typeof subscription.expirationTime === "number"
      ? new Date(subscription.expirationTime).toISOString()
      : null;
    const { error: saveError } = await ctx.supabaseAdmin
      .from("web_push_subscriptions")
      .upsert({
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        expires_at: expiration,
        user_agent: typeof body.userAgent === "string" ? body.userAgent.slice(0, 500) : null,
        disabled_at: null,
      }, { onConflict: "endpoint" });
    if (saveError) return error(saveError.message, 500);
    return Response.json({ saved: true });
  }),
};
