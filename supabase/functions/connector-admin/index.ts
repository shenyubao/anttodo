import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { resolveUser } from "../_shared/resolveUser.ts";

type AdminRequest =
  | { action: "list"; workspaceId: string }
  | { action: "install-dingtalk-group-bot"; workspaceId: string }
  | { action: "set-enabled"; connectorId: string; enabled: boolean }
  | { action: "delete"; connectorId: string }
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

function dingtalkGroupRobotCallbackUrl() {
  const base = (
    Deno.env.get("SUPABASE_PUBLIC_URL") ?? Deno.env.get("SUPABASE_URL") ?? ""
  ).trim().replace(/\/+$/, "");
  return base ? `${base}/functions/v1/dingtalk-group-bot` : "";
}

function isDingtalkGroupRobot(connector: {
  type?: unknown;
  public_config?: unknown;
}) {
  const config = connector.public_config;
  return connector.type === "dingtalk" &&
    typeof config === "object" && config !== null &&
    (config as { kind?: unknown }).kind === "group_robot";
}

function serializeDingtalkGroupRobot(connector: {
  id: string;
  name: string;
  enabled: boolean;
  last_synced_at: string | null;
  created_at: string;
}) {
  return {
    id: connector.id,
    type: "dingtalk-group-robot" as const,
    name: connector.name,
    enabled: connector.enabled,
    lastEventAt: connector.last_synced_at,
    createdAt: connector.created_at,
  };
}

async function requireWorkspaceAdmin(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  workspaceId: string,
  userId: string,
) {
  const { data: membership, error } = await supabaseAdmin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return !error && Boolean(
    membership && ["owner", "admin"].includes(membership.role),
  );
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return jsonError("Method not allowed", 405);

    const body = (await req.json()) as AdminRequest;
    const user = await resolveUser(req, ctx.supabaseAdmin);
    if (!user) return jsonError("Authentication required", 401);
    const userId = user.id;
    const userEmail = user.email;

    if (body.action === "list" || body.action === "install-dingtalk-group-bot") {
      const { data: membership, error: membershipError } = await ctx.supabaseAdmin
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", body.workspaceId)
        .eq("user_id", userId)
        .maybeSingle();
      if (membershipError || !membership) {
        return jsonError("Workspace membership required", 403);
      }
      const canManage = ["owner", "admin"].includes(membership.role);

      const { data: provider, error: providerError } = await ctx.supabaseAdmin
        .from("workspace_sso_providers")
        .select("id, enabled, public_config, credential_hint")
        .eq("workspace_id", body.workspaceId)
        .eq("provider", "dingtalk")
        .maybeSingle();
      if (providerError) return jsonError(providerError.message, 400);
      let hasAppSecret = false;
      if (provider?.id && provider.credential_hint) {
        const { data: secret, error: secretError } = await ctx.supabaseAdmin.rpc(
          "get_sso_provider_secret",
          { p_provider_id: provider.id },
        );
        if (secretError) return jsonError("钉钉 SSO 密钥状态无法验证", 500);
        hasAppSecret = typeof secret === "string" && secret.length > 0;
      }
      const publicConfig = provider?.public_config;
      const ssoConfigured = Boolean(
        provider?.enabled &&
          hasAppSecret &&
          typeof publicConfig === "object" && publicConfig !== null &&
          typeof (publicConfig as { corpId?: unknown }).corpId === "string" &&
          typeof (publicConfig as { appKey?: unknown }).appKey === "string",
      );

      const { data: connectorRows, error: connectorListError } = await ctx.supabaseAdmin
        .from("connector_instances")
        .select("id, type, name, enabled, public_config, last_synced_at, created_at")
        .eq("workspace_id", body.workspaceId)
        .eq("type", "dingtalk")
        .order("created_at", { ascending: true });
      if (connectorListError) return jsonError(connectorListError.message, 400);
      const connectors = (connectorRows ?? []).filter(isDingtalkGroupRobot);

      if (body.action === "list") {
        return Response.json({
          canManage,
          ssoEnabled: ssoConfigured,
          callbackUrl: dingtalkGroupRobotCallbackUrl(),
          connectors: connectors.map(serializeDingtalkGroupRobot),
        });
      }

      if (!canManage) {
        return jsonError("Workspace administrator access required", 403);
      }
      if (!ssoConfigured) {
        return jsonError("请先启用并完整配置钉钉 SSO", 422);
      }
      if (connectors[0]) {
        return Response.json({
          connector: serializeDingtalkGroupRobot(connectors[0]),
          callbackUrl: dingtalkGroupRobotCallbackUrl(),
          created: false,
        });
      }

      const { data: connector, error: createError } = await ctx.supabaseAdmin
        .from("connector_instances")
        .insert({
          workspace_id: body.workspaceId,
          type: "dingtalk",
          name: "钉钉群机器人",
          enabled: true,
          schedule_minutes: 5,
          public_config: { kind: "group_robot", timezone: "Asia/Shanghai" },
          created_by: userId,
        })
        .select("id, name, enabled, last_synced_at, created_at")
        .single();
      if (createError?.code === "23505") {
        const { data: installed } = await ctx.supabaseAdmin
          .from("connector_instances")
          .select("id, name, enabled, last_synced_at, created_at")
          .eq("workspace_id", body.workspaceId)
          .eq("type", "dingtalk")
          .contains("public_config", { kind: "group_robot" })
          .maybeSingle();
        if (installed) {
          return Response.json({
            connector: serializeDingtalkGroupRobot(installed),
            callbackUrl: dingtalkGroupRobotCallbackUrl(),
            created: false,
          });
        }
      }
      if (createError || !connector) {
        return jsonError(createError?.message || "Connector could not be created", 400);
      }
      return Response.json({
        connector: serializeDingtalkGroupRobot(connector),
        callbackUrl: dingtalkGroupRobotCallbackUrl(),
        created: true,
      });
    }

    if (body.action === "create-invite") {
      const { data: membership, error: membershipError } = await ctx.supabaseAdmin
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", body.workspaceId)
        .eq("user_id", userId)
        .maybeSingle();
      if (
        membershipError ||
        !membership ||
        !["owner", "admin"].includes(membership.role)
      ) {
        return jsonError("Workspace administrator access required", 403);
      }

      const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
      const tokenHash = await sha256(token);
      const { error } = await ctx.supabaseAdmin.from("workspace_invites").insert({
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

    const { data: connector, error: connectorError } = await ctx.supabaseAdmin
      .from("connector_instances")
      .select("id, workspace_id, type, public_config")
      .eq("id", body.connectorId)
      .single();
    if (connectorError || !connector) return jsonError("Connector not found", 404);

    if (body.action === "set-enabled" || body.action === "delete") {
      if (!isDingtalkGroupRobot(connector)) {
        return jsonError("DingTalk group robot not found", 404);
      }
      if (!(await requireWorkspaceAdmin(
        ctx.supabaseAdmin,
        connector.workspace_id,
        userId,
      ))) {
        return jsonError("Workspace administrator access required", 403);
      }
      if (body.action === "set-enabled") {
        const { data, error } = await ctx.supabaseAdmin
          .from("connector_instances")
          .update({ enabled: body.enabled })
          .eq("id", connector.id)
          .select("id, name, enabled, last_synced_at, created_at")
          .single();
        if (error || !data) return jsonError(error?.message || "Update failed", 400);
        return Response.json({ connector: serializeDingtalkGroupRobot(data) });
      }
      const { error } = await ctx.supabaseAdmin
        .from("connector_instances")
        .delete()
        .eq("id", connector.id);
      if (error) return jsonError(error.message, 400);
      return Response.json({ deleted: true });
    }

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
