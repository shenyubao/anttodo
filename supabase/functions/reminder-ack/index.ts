import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

const encoder = new TextEncoder();

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    const token = String((await req.json().catch(() => ({})))?.token ?? "");
    if (token.length < 32) return Response.json({ error: "Invalid token" }, { status: 400 });
    const tokenHash = await sha256(token);
    const { data, error } = await ctx.supabaseAdmin
      .from("reminder_delivery_states")
      .update({ acknowledged_at: new Date().toISOString() })
      .eq("acknowledgement_token_hash", tokenHash)
      .is("acknowledged_at", null)
      .select("id")
      .maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ acknowledged: Boolean(data) });
  }),
};
