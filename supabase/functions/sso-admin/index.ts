import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { resolveUser } from "../_shared/resolveUser.ts";

type SsoPublicConfig = {
  corpId: string;
  appKey: string;
  agentId?: string;
};

type SsoAdminRequest =
  | { action: "get"; workspaceId: string }
  | {
      action: "upsert";
      workspaceId: string;
      publicConfig: SsoPublicConfig;
      enabled?: boolean;
      appSecret?: string;
    }
  | { action: "save-secret"; providerId: string; secret: string }
  | { action: "delete-secret"; providerId: string }
  | { action: "delete"; workspaceId: string }
  | {
      action: "set-enabled";
      workspaceId: string;
      enabled: boolean;
    };

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function normalizeConfig(input: SsoPublicConfig | undefined): SsoPublicConfig | null {
  if (!input) return null;
  const corpId = input.corpId?.trim() ?? "";
  const appKey = input.appKey?.trim() ?? "";
  const agentId = input.agentId?.trim() ?? "";
  if (!corpId || !appKey) return null;
  return agentId
    ? { corpId, appKey, agentId }
    : { corpId, appKey };
}

async function requireAdmin(
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
  if (error || !membership || !["owner", "admin"].includes(membership.role)) {
    return false;
  }
  return true;
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return jsonError("Method not allowed", 405);

    const user = await resolveUser(req, ctx.supabaseAdmin);
    if (!user) return jsonError("Authentication required", 401);
    const userId = user.id;

    const body = (await req.json().catch(() => null)) as SsoAdminRequest | null;
    if (!body?.action) return jsonError("Invalid request");

    if (body.action === "save-secret" || body.action === "delete-secret") {
      const { data: provider, error: providerError } = await ctx.supabaseAdmin
        .from("workspace_sso_providers")
        .select("id, workspace_id")
        .eq("id", body.providerId)
        .maybeSingle();
      if (providerError || !provider) return jsonError("SSO provider not found", 404);
      if (!(await requireAdmin(ctx.supabaseAdmin, provider.workspace_id, userId))) {
        return jsonError("Workspace administrator access required", 403);
      }

      if (body.action === "save-secret") {
        if (!body.secret.trim()) return jsonError("Secret is required");
        const { data, error } = await ctx.supabaseAdmin.rpc("set_sso_provider_secret", {
          p_provider_id: provider.id,
          p_actor_id: userId,
          p_secret: body.secret,
        });
        if (error) return jsonError(error.message, 403);
        return Response.json({ credentialHint: data });
      }

      const { error } = await ctx.supabaseAdmin.rpc("delete_sso_provider_secret", {
        p_provider_id: provider.id,
        p_actor_id: userId,
      });
      if (error) return jsonError(error.message, 403);
      return Response.json({ deleted: true });
    }

    if (body.action === "get") {
      const { data: membership, error: membershipError } = await ctx.supabaseAdmin
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", body.workspaceId)
        .eq("user_id", userId)
        .maybeSingle();
      if (membershipError || !membership) {
        return jsonError("Workspace membership required", 403);
      }

      const { data, error } = await ctx.supabaseAdmin
        .from("workspace_sso_providers")
        .select(
          "id, workspace_id, provider, enabled, public_config, credential_hint, created_at, updated_at",
        )
        .eq("workspace_id", body.workspaceId)
        .eq("provider", "dingtalk")
        .maybeSingle();
      if (error) return jsonError(error.message, 400);
      return Response.json({ provider: data });
    }

    if (!(await requireAdmin(ctx.supabaseAdmin, body.workspaceId, userId))) {
      return jsonError("Workspace administrator access required", 403);
    }

    if (body.action === "set-enabled") {
      const { data, error } = await ctx.supabaseAdmin
        .from("workspace_sso_providers")
        .update({ enabled: body.enabled })
        .eq("workspace_id", body.workspaceId)
        .eq("provider", "dingtalk")
        .select(
          "id, workspace_id, provider, enabled, public_config, credential_hint, created_at, updated_at",
        )
        .maybeSingle();
      if (error) {
        if (error.code === "23505") {
          return jsonError("该 CorpId 已被其他团队空间启用", 409);
        }
        return jsonError(error.message, 400);
      }
      if (!data) return jsonError("SSO provider not found", 404);
      return Response.json({ provider: data });
    }

    if (body.action === "delete") {
      const { data: existing } = await ctx.supabaseAdmin
        .from("workspace_sso_providers")
        .select("id")
        .eq("workspace_id", body.workspaceId)
        .eq("provider", "dingtalk")
        .maybeSingle();
      if (!existing) return jsonError("SSO provider not found", 404);

      await ctx.supabaseAdmin.rpc("delete_sso_provider_secret", {
        p_provider_id: existing.id,
        p_actor_id: userId,
      });

      const { error } = await ctx.supabaseAdmin
        .from("workspace_sso_providers")
        .delete()
        .eq("id", existing.id);
      if (error) return jsonError(error.message, 400);
      return Response.json({ deleted: true });
    }

    if (body.action === "upsert") {
      const publicConfig = normalizeConfig(body.publicConfig);
      if (!publicConfig) {
        return jsonError("corpId and appKey are required");
      }
      if (!/^ding[a-z0-9]+$/i.test(publicConfig.appKey)) {
        return jsonError("AppKey 无效，企业内部应用 Client ID 通常以 ding 开头");
      }

      const { data: existing } = await ctx.supabaseAdmin
        .from("workspace_sso_providers")
        .select("id, public_config, credential_hint")
        .eq("workspace_id", body.workspaceId)
        .eq("provider", "dingtalk")
        .maybeSingle();

      const previousAppKey =
        existing &&
        typeof existing.public_config === "object" &&
        existing.public_config !== null &&
        typeof (existing.public_config as { appKey?: unknown }).appKey === "string"
          ? String((existing.public_config as { appKey: string }).appKey).trim()
          : "";
      const appKeyChanged = Boolean(existing) && previousAppKey !== publicConfig.appKey;
      const appSecret = body.appSecret?.trim() || "";
      if (!existing && !appSecret) {
        return jsonError("首次配置需要填写 AppSecret");
      }
      if (appKeyChanged && !appSecret) {
        return jsonError("更换 AppKey 后必须重新填写对应的 AppSecret");
      }
      if (!appSecret && existing && !existing.credential_hint) {
        return jsonError("钉钉 SSO 尚未保存 AppSecret");
      }

      let provider;
      if (existing) {
        const { data, error } = await ctx.supabaseAdmin
          .from("workspace_sso_providers")
          .update({
            public_config: publicConfig,
            enabled: body.enabled ?? true,
          })
          .eq("id", existing.id)
          .select(
            "id, workspace_id, provider, enabled, public_config, credential_hint, created_at, updated_at",
          )
          .single();
        if (error) {
          if (error.code === "23505") {
            return jsonError("该 CorpId 已被其他团队空间启用", 409);
          }
          return jsonError(error.message, 400);
        }
        provider = data;
      } else {
        const { data, error } = await ctx.supabaseAdmin
          .from("workspace_sso_providers")
          .insert({
            workspace_id: body.workspaceId,
            provider: "dingtalk",
            public_config: publicConfig,
            enabled: body.enabled ?? true,
            created_by: userId,
          })
          .select(
            "id, workspace_id, provider, enabled, public_config, credential_hint, created_at, updated_at",
          )
          .single();
        if (error) {
          if (error.code === "23505") {
            return jsonError("该 CorpId 已被其他团队空间启用", 409);
          }
          return jsonError(error.message, 400);
        }
        provider = data;
      }

      if (appSecret) {
        const { data: hint, error: secretError } = await ctx.supabaseAdmin.rpc(
          "set_sso_provider_secret",
          {
            p_provider_id: provider.id,
            p_actor_id: userId,
            p_secret: appSecret,
          },
        );
        if (secretError) return jsonError(secretError.message, 403);
        provider = { ...provider, credential_hint: hint };
      }

      return Response.json({ provider });
    }

    return jsonError("Unsupported action");
  }),
};
