import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { resolveUser } from "../_shared/resolveUser.ts";

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    const dispatchSecret = Deno.env.get("REMINDER_DISPATCH_SECRET") ?? "";
    const scheduled = Boolean(dispatchSecret) &&
      req.headers.get("x-anttodo-dispatch-secret") === dispatchSecret;
    const user = scheduled ? null : await resolveUser(req, ctx.supabaseAdmin);
    if (!scheduled && !user) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const { data: rows, error } = await ctx.supabaseAdmin
      .from("attachment_cleanup_queue")
      .select("id, workspace_id, bucket, object_path, canonical_uri, attempts")
      .is("processed_at", null)
      .lte("available_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(100);
    if (error) return Response.json({ error: error.message }, { status: 500 });

    let removed = 0;
    let retained = 0;
    for (const row of rows ?? []) {
      const { data: referenced, error: referenceError } = await ctx.supabaseAdmin.rpc(
        "check_attachment_unreferenced",
        { p_workspace_id: row.workspace_id, p_canonical_uri: row.canonical_uri },
      );
      if (referenceError) {
        await ctx.supabaseAdmin.from("attachment_cleanup_queue").update({
          attempts: row.attempts + 1,
          last_error: referenceError.message,
          available_at: new Date(Date.now() + Math.min(300_000, 2 ** row.attempts * 1000)).toISOString(),
        }).eq("id", row.id);
        continue;
      }
      if (referenced !== true) {
        await ctx.supabaseAdmin.from("attachment_cleanup_queue").update({
          processed_at: new Date().toISOString(),
          last_error: "still_referenced",
        }).eq("id", row.id);
        retained += 1;
        continue;
      }
      const { error: removeError } = await ctx.supabaseAdmin.storage
        .from(row.bucket)
        .remove([row.object_path]);
      if (removeError) {
        await ctx.supabaseAdmin.from("attachment_cleanup_queue").update({
          attempts: row.attempts + 1,
          last_error: removeError.message,
          available_at: new Date(Date.now() + Math.min(300_000, 2 ** row.attempts * 1000)).toISOString(),
        }).eq("id", row.id);
        continue;
      }
      await ctx.supabaseAdmin.from("attachment_cleanup_queue").update({
        processed_at: new Date().toISOString(),
        last_error: null,
      }).eq("id", row.id);
      removed += 1;
    }
    return Response.json({ scanned: rows?.length ?? 0, removed, retained });
  }),
};
