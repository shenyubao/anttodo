import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  createSsoState,
  dingtalkCallbackUrl,
  getPublicAppUrl,
  getSsoStateSecret,
  parsePublicConfig,
  type SsoClient,
} from "../_shared/dingtalk-sso.ts";

const WORKSPACE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PUBLIC_ERROR = "未找到可用的企业联合登录配置";

function normalizeWorkspaceSlug(value: string) {
  return value.trim().toLowerCase();
}

function validWorkspaceSlug(value: string) {
  return value.length >= 2 && value.length <= 48 && WORKSPACE_SLUG_PATTERN.test(value);
}

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return jsonError("Method not allowed", 405);

    const body = (await req.json().catch(() => null)) as {
      slug?: unknown;
      client?: unknown;
    } | null;
    const slug = typeof body?.slug === "string"
      ? normalizeWorkspaceSlug(body.slug)
      : "";
    if (!validWorkspaceSlug(slug)) return jsonError(PUBLIC_ERROR, 404);
    const client: SsoClient = body?.client === "desktop" ? "desktop" : "web";
    if (body?.client !== undefined && body.client !== "web" && body.client !== "desktop") {
      return jsonError("Unsupported SSO client");
    }

    const { data: workspace, error: workspaceError } = await ctx.supabaseAdmin
      .from("workspaces")
      .select("id, name, slug")
      .eq("slug", slug)
      .maybeSingle();
    if (workspaceError) return jsonError("无法读取企业联合登录配置", 500);
    if (!workspace) return jsonError(PUBLIC_ERROR, 404);

    const { data: providerRows, error: providerError } = await ctx.supabaseAdmin
      .from("workspace_sso_providers")
      .select("provider, public_config, credential_hint")
      .eq("workspace_id", workspace.id)
      .eq("enabled", true);
    if (providerError) return jsonError("无法读取企业联合登录配置", 500);

    const dingtalkConfigs = (providerRows ?? []).flatMap((row) => {
      if (row.provider !== "dingtalk" || !row.credential_hint) return [];
      const config = parsePublicConfig(row.public_config);
      return config ? [config] : [];
    });
    if (dingtalkConfigs.length === 0) return jsonError(PUBLIC_ERROR, 404);

    const publicAppUrl = getPublicAppUrl();
    if (!publicAppUrl) return jsonError("PUBLIC_APP_URL is not configured", 500);

    let state: string;
    try {
      state = await createSsoState(workspace.id, getSsoStateSecret(), client);
    } catch (error) {
      return jsonError(
        error instanceof Error ? error.message : "SSO_STATE_SECRET is not configured",
        500,
      );
    }

    const providers = dingtalkConfigs.map((config) => ({
      provider: "dingtalk" as const,
      displayName: "钉钉企业登录",
      flow: "qr_or_redirect" as const,
      config: {
        corpId: config.corpId,
        appKey: config.appKey,
        agentId: config.agentId ?? null,
        redirectUri: dingtalkCallbackUrl(publicAppUrl),
        state,
      },
    }));

    return Response.json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
      },
      providers,
    });
  }),
};
