import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

type AdminRequest =
  | {
      action: "create-invite";
      workspaceId: string;
      email: string;
      role?: "admin" | "member";
    }
  | { action: "accept-invite"; token: string }
  | { action: "save-secret"; connectorId: string; secret: string }
  | { action: "delete-secret"; connectorId: string };

const encoder = new TextEncoder();

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return jsonError("Method not allowed", 405);

    const body = (await req.json()) as AdminRequest;
    const userId = ctx.userClaims?.sub;
    const userEmail = ctx.userClaims?.email;
    if (!userId) return jsonError("Authentication required", 401);

    if (body.action === "create-invite") {
      const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
      const tokenHash = await sha256(token);
      const { error } = await ctx.supabase.from("workspace_invites").insert({
        workspace_id: body.workspaceId,
        email: body.email.trim().toLowerCase(),
        role: body.role ?? "member",
        token_hash: tokenHash,
        created_by: userId,
      });
      if (error) return jsonError(error.message, 403);
      return Response.json({ token, expiresInDays: 7 });
    }

    if (body.action === "accept-invite") {
      const tokenHash = await sha256(body.token);
      const { data: invite, error } = await ctx.supabaseAdmin
        .from("workspace_invites")
        .select("id, workspace_id, email, role, expires_at, accepted_at")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (error || !invite) return jsonError("Invite not found", 404);
      if (invite.accepted_at) return jsonError("Invite already used", 409);
      if (new Date(invite.expires_at).getTime() < Date.now()) {
        return jsonError("Invite expired", 410);
      }
      if (!userEmail || invite.email.toLowerCase() !== userEmail.toLowerCase()) {
        return jsonError("Invite email does not match the signed-in user", 403);
      }
      const { error: memberError } = await ctx.supabaseAdmin
        .from("workspace_members")
        .upsert({
          workspace_id: invite.workspace_id,
          user_id: userId,
          role: invite.role,
        });
      if (memberError) return jsonError(memberError.message, 400);
      await ctx.supabaseAdmin
        .from("workspace_invites")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", invite.id);
      return Response.json({ workspaceId: invite.workspace_id });
    }

    const { data: connector, error: connectorError } = await ctx.supabase
      .from("connector_instances")
      .select("id")
      .eq("id", body.connectorId)
      .single();
    if (connectorError || !connector) return jsonError("Connector not found", 404);

    if (body.action === "save-secret") {
      if (!body.secret.trim()) return jsonError("Secret is required");
      const { data, error } = await ctx.supabaseAdmin.rpc("set_connector_secret", {
        p_connector_id: connector.id,
        p_actor_id: userId,
        p_secret: body.secret,
      });
      if (error) return jsonError(error.message, 403);
      return Response.json({ credentialHint: data });
    }

    const { error } = await ctx.supabaseAdmin.rpc("delete_connector_secret", {
      p_connector_id: connector.id,
      p_actor_id: userId,
    });
    if (error) return jsonError(error.message, 403);
    return Response.json({ deleted: true });
  }),
};
