import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return jsonError("Method not allowed", 405);

    const userId = ctx.userClaims?.id;
    if (!userId) return jsonError("Authentication required", 401);

    const body = await req.json().catch(() => null) as { action?: string } | null;
    if (body?.action !== "delete-account") {
      return jsonError("Unsupported action");
    }

    const { error } = await ctx.supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      const ownsStorageObjects = /storage|object/i.test(error.message);
      return jsonError(
        ownsStorageObjects
          ? "请先删除由此账户上传的附件，再重试删除账户。"
          : "账户暂时无法删除，请稍后重试。",
        409,
      );
    }

    return Response.json({ deleted: true });
  }),
};
