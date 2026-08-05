import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { resolveUser } from "../_shared/resolveUser.ts";

type InviteRole = "member" | "admin";

type InviteRequest =
  | { action: "get"; workspaceId: string }
  | { action: "enable"; workspaceId: string; role: InviteRole }
  | { action: "update-role"; workspaceId: string; role: InviteRole }
  | { action: "disable"; workspaceId: string }
  | { action: "accept"; linkId: string };

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function isInviteRole(value: unknown): value is InviteRole {
  return value === "member" || value === "admin";
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return jsonError("Method not allowed", 405);

    const user = await resolveUser(req, ctx.supabaseAdmin);
    if (!user) return jsonError("Authentication required", 401);
    const userId = user.id;

    const body = await req.json().catch(() => null) as InviteRequest | null;
    if (!body?.action) return jsonError("Invalid request");

    if (body.action === "accept") {
      const { data, error } = await ctx.supabaseAdmin.rpc(
        "accept_workspace_invite_link",
        { p_link_id: body.linkId, p_user_id: userId },
      );
      if (error) {
        if (error.message.includes("not found")) return jsonError("Invite link not found", 404);
        if (error.message.includes("revoked")) return jsonError("Invite link revoked", 410);
        return jsonError(error.message, 400);
      }
      return Response.json({ workspaceId: data });
    }

    const workspaceId = body.workspaceId;
    const { data: membership, error: membershipError } = await ctx.supabaseAdmin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (
      membershipError ||
      !membership ||
      !["owner", "admin"].includes(membership.role)
    ) {
      return jsonError("Workspace administrator access required", 403);
    }

    if (body.action === "get") {
      const { data, error } = await ctx.supabaseAdmin
        .from("workspace_invite_links")
        .select("id, workspace_id, role, created_by, created_at, revoked_at")
        .eq("workspace_id", workspaceId)
        .is("revoked_at", null)
        .maybeSingle();
      if (error) return jsonError(error.message, 400);
      return Response.json({ link: data });
    }

    if (body.action === "enable") {
      if (!isInviteRole(body.role)) return jsonError("Invalid invite role");
      const { data, error } = await ctx.supabaseAdmin
        .from("workspace_invite_links")
        .insert({
          workspace_id: workspaceId,
          role: body.role,
          created_by: userId,
        })
        .select("id, workspace_id, role, created_by, created_at, revoked_at")
        .single();
      if (error) {
        if (error.code === "23505") return jsonError("Invite link already enabled", 409);
        return jsonError(error.message, 400);
      }
      return Response.json({ link: data });
    }

    if (body.action === "update-role") {
      if (!isInviteRole(body.role)) return jsonError("Invalid invite role");
      const { data, error } = await ctx.supabaseAdmin
        .from("workspace_invite_links")
        .update({ role: body.role })
        .eq("workspace_id", workspaceId)
        .is("revoked_at", null)
        .select("id, workspace_id, role, created_by, created_at, revoked_at")
        .maybeSingle();
      if (error) return jsonError(error.message, 400);
      if (!data) return jsonError("Invite link not enabled", 404);
      return Response.json({ link: data });
    }

    if (body.action !== "disable") return jsonError("Unsupported action");
    // Idempotent: already-revoked links still return success.
    const { error } = await ctx.supabaseAdmin
      .from("workspace_invite_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .is("revoked_at", null);
    if (error) return jsonError(error.message, 400);
    return Response.json({ disabled: true });
  }),
};
