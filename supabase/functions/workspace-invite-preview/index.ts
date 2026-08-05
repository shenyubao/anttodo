import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { parsePublicConfig } from "../_shared/dingtalk-sso.ts";

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return jsonError("Method not allowed", 405);
    const body = await req.json().catch(() => null) as { linkId?: string } | null;
    if (!body?.linkId) return jsonError("Invite link not found", 404);

    const { data: link, error } = await ctx.supabaseAdmin
      .from("workspace_invite_links")
      .select("workspace_id, role, created_by, revoked_at")
      .eq("id", body.linkId)
      .maybeSingle();
    if (error || !link) return jsonError("Invite link not found", 404);

    const [{ data: workspace }, { data: inviter }, { data: providerRows }] =
      await Promise.all([
        ctx.supabaseAdmin
          .from("workspaces")
          .select("name, slug")
          .eq("id", link.workspace_id)
          .maybeSingle(),
        link.created_by
          ? ctx.supabaseAdmin
              .from("profiles")
              .select("display_name")
              .eq("id", link.created_by)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        ctx.supabaseAdmin
          .from("workspace_sso_providers")
          .select("provider, public_config, credential_hint")
          .eq("workspace_id", link.workspace_id)
          .eq("enabled", true),
      ]);
    if (!workspace) return jsonError("Invite link not found", 404);

    const ssoEnabled = (providerRows ?? []).some((row) => {
      if (row.provider !== "dingtalk" || !row.credential_hint) return false;
      return Boolean(parsePublicConfig(row.public_config));
    });

    return Response.json({
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug ?? "",
      inviterDisplayName: inviter?.display_name || "团队管理员",
      role: link.role,
      status: link.revoked_at ? "revoked" : "active",
      ssoEnabled,
    });
  }),
};
