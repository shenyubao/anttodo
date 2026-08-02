import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  createSsoState,
  dingtalkCallbackUrl,
  dingtalkSubject,
  exchangeDingtalkAuthCode,
  getPublicAppUrl,
  getSsoStateSecret,
  isPhoneAlreadyRegisteredError,
  normalizeDingtalkAvatarUrl,
  normalizeMainlandMobile,
  parsePublicConfig,
  placeholderDingtalkEmail,
  verifySsoStateClaims,
} from "../_shared/dingtalk-sso.ts";

type DingtalkSsoRequest =
  | {
      action: "public-config";
      workspaceId?: string;
      corpId?: string;
      slug?: string;
    }
  | { action: "create-state"; workspaceId: string }
  | {
      action: "exchange";
      workspaceId: string;
      authCode: string;
      state: string;
    }
  | { action: "consume-handoff"; code: string };

const HANDOFF_TTL_SECONDS = 120;
const HANDOFF_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function createHandoffCode() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeWorkspaceSlug(value: string) {
  return value.trim().toLowerCase();
}

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function redirectUri() {
  const appUrl = getPublicAppUrl();
  if (!appUrl) return null;
  return dingtalkCallbackUrl(appUrl);
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return jsonError("Method not allowed", 405);

    const body = (await req.json().catch(() => null)) as DingtalkSsoRequest | null;
    if (!body?.action) return jsonError("Invalid request");

    if (body.action === "consume-handoff") {
      const code = body.code?.trim();
      if (!code || !HANDOFF_CODE_PATTERN.test(code)) {
        return jsonError("登录交接码无效", 404);
      }
      const { data, error } = await ctx.supabaseAdmin.rpc(
        "consume_sso_auth_handoff",
        { p_code_hash: await sha256(code) },
      );
      if (error) return jsonError("无法完成客户端登录交接", 500);
      const result = Array.isArray(data) ? data[0] : data;
      if (!result || result.status === "not_found") {
        return jsonError("登录交接码不存在", 404);
      }
      if (result.status === "consumed") {
        return jsonError("登录交接码已使用", 409);
      }
      if (result.status === "expired") {
        return jsonError("登录交接码已过期", 410);
      }
      if (result.status !== "ok" || !result.workspace_id || !result.token_hash) {
        return jsonError("无法完成客户端登录交接", 500);
      }
      return Response.json({
        workspaceId: result.workspace_id,
        tokenHash: result.token_hash,
      });
    }

    if (body.action === "public-config" || body.action === "create-state") {
      let workspaceId =
        body.action === "create-state"
          ? body.workspaceId.trim()
          : typeof body.workspaceId === "string"
          ? body.workspaceId.trim()
          : "";
      const corpId =
        body.action === "public-config" && typeof body.corpId === "string"
          ? body.corpId.trim()
          : "";
      const slug =
        body.action === "public-config" && typeof body.slug === "string"
          ? normalizeWorkspaceSlug(body.slug)
          : "";

      if (slug && !workspaceId) {
        const { data: workspaceBySlug, error: slugError } = await ctx.supabaseAdmin
          .from("workspaces")
          .select("id")
          .eq("slug", slug)
          .maybeSingle();
        if (slugError) return jsonError(slugError.message, 400);
        if (!workspaceBySlug) return jsonError("未找到该团队空间", 404);
        workspaceId = workspaceBySlug.id;
      }

      if (!workspaceId && !corpId) {
        return jsonError("workspaceId, slug or corpId is required");
      }

      let provider = null as {
        id: string;
        workspace_id: string;
        enabled: boolean;
        public_config: unknown;
        credential_hint: string | null;
      } | null;

      if (workspaceId) {
        const { data, error } = await ctx.supabaseAdmin
          .from("workspace_sso_providers")
          .select("id, workspace_id, enabled, public_config, credential_hint")
          .eq("provider", "dingtalk")
          .eq("enabled", true)
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        if (error) return jsonError(error.message, 400);
        provider = data;
      } else {
        const { data, error } = await ctx.supabaseAdmin
          .from("workspace_sso_providers")
          .select("id, workspace_id, enabled, public_config, credential_hint")
          .eq("provider", "dingtalk")
          .eq("enabled", true);
        if (error) return jsonError(error.message, 400);
        provider =
          data?.find((row) => {
            const config = parsePublicConfig(row.public_config);
            return config?.corpId.toLowerCase() === corpId.toLowerCase();
          }) ?? null;
      }

      if (!provider) return jsonError("钉钉 SSO 未配置或未启用", 404);

      const publicConfig = parsePublicConfig(provider.public_config);
      if (!publicConfig) return jsonError("钉钉 SSO 配置不完整", 422);
      if (!provider.credential_hint) {
        return jsonError("钉钉 SSO 尚未保存 AppSecret", 422);
      }

      const { data: workspace } = await ctx.supabaseAdmin
        .from("workspaces")
        .select("id, name, slug")
        .eq("id", provider.workspace_id)
        .maybeSingle();
      if (!workspace) return jsonError("钉钉 SSO 未配置或未启用", 404);

      const callback = redirectUri();
      if (!callback) return jsonError("PUBLIC_APP_URL is not configured", 500);

      let state: string;
      try {
        state = await createSsoState(workspace.id, getSsoStateSecret());
      } catch (error) {
        return jsonError(
          error instanceof Error ? error.message : "SSO_STATE_SECRET is not configured",
          500,
        );
      }

      if (body.action === "create-state") {
        return Response.json({ state, workspaceId: workspace.id });
      }

      return Response.json({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        workspaceSlug: workspace.slug,
        corpId: publicConfig.corpId,
        appKey: publicConfig.appKey,
        agentId: publicConfig.agentId ?? null,
        redirectUri: callback,
        state,
      });
    }

    if (body.action === "exchange") {
      const workspaceId = body.workspaceId?.trim();
      const authCode = body.authCode?.trim();
      const state = body.state?.trim();
      if (!workspaceId || !authCode || !state) {
        return jsonError("workspaceId, authCode and state are required");
      }

      const stateClaims = await verifySsoStateClaims(
        state,
        workspaceId,
        getSsoStateSecret(),
      );
      if (!stateClaims) return jsonError("Invalid or expired SSO state", 403);

      const { data: provider, error: providerError } = await ctx.supabaseAdmin
        .from("workspace_sso_providers")
        .select("id, workspace_id, enabled, public_config, credential_hint")
        .eq("workspace_id", workspaceId)
        .eq("provider", "dingtalk")
        .eq("enabled", true)
        .maybeSingle();
      if (providerError || !provider) {
        return jsonError("钉钉 SSO 未配置或未启用", 404);
      }

      const publicConfig = parsePublicConfig(provider.public_config);
      if (!publicConfig) return jsonError("钉钉 SSO 配置不完整", 422);

      const { data: appSecret, error: secretError } = await ctx.supabaseAdmin.rpc(
        "get_sso_provider_secret",
        { p_provider_id: provider.id },
      );
      if (secretError || !appSecret) {
        return jsonError("钉钉 SSO 尚未保存 AppSecret", 422);
      }

      let dingtalkUser;
      try {
        dingtalkUser = await exchangeDingtalkAuthCode({
          appKey: publicConfig.appKey,
          appSecret: String(appSecret),
          authCode,
        });
      } catch (error) {
        return jsonError(
          error instanceof Error ? error.message : "钉钉授权失败",
          502,
        );
      }

      const subject = dingtalkSubject(dingtalkUser);
      if (!subject) return jsonError("钉钉未返回可用的用户标识", 502);

      const phone = normalizeMainlandMobile(dingtalkUser.mobile, dingtalkUser.stateCode);
      const displayName =
        dingtalkUser.nick?.trim() ||
        (phone ? phone.replace(/^\+86(\d{3})\d{4}(\d{4})$/, "$1****$2") : "钉钉用户");
      const avatarUrl = normalizeDingtalkAvatarUrl(dingtalkUser.avatarUrl);

      let userId: string | null = null;

      const { data: identity, error: identityError } = await ctx.supabaseAdmin
        .from("sso_identities")
        .select("user_id")
        .eq("provider", "dingtalk")
        .eq("subject", subject)
        .maybeSingle();
      if (identityError) return jsonError("无法查询钉钉账号关联", 500);
      if (identity?.user_id) userId = identity.user_id;

      async function findUserIdByPhone(lookupPhone: string) {
        const { data: phoneUserId, error: phoneLookupError } = await ctx.supabaseAdmin
          .rpc("find_user_id_by_phone", { p_phone: lookupPhone });
        if (phoneLookupError) {
          return {
            userId: null as string | null,
            error: phoneLookupError.message || "无法按手机号匹配已有账号",
          };
        }
        if (typeof phoneUserId === "string" && phoneUserId) {
          return { userId: phoneUserId, error: null as string | null };
        }
        return { userId: null as string | null, error: null as string | null };
      }

      async function findUserIdByPhoneViaAuthAdmin(lookupPhone: string) {
        let page: number | null = 1;
        while (page !== null) {
          const { data, error } = await ctx.supabaseAdmin.auth.admin.listUsers({
            page,
            perPage: 1000,
          });
          if (error) {
            return {
              userId: null as string | null,
              error: error.message || "无法通过 Auth 匹配已有账号",
            };
          }
          const matched = data.users.find(
            (user) => normalizeMainlandMobile(user.phone) === lookupPhone,
          );
          if (matched) {
            return { userId: matched.id, error: null as string | null };
          }
          page = typeof data.nextPage === "number" ? data.nextPage : null;
        }
        return { userId: null as string | null, error: null as string | null };
      }

      if (!userId && phone) {
        const phoneLookup = await findUserIdByPhone(phone);
        if (phoneLookup.error) return jsonError(phoneLookup.error, 500);
        if (phoneLookup.userId) userId = phoneLookup.userId;
      }

      if (!userId) {
        const userMetadata = {
          display_name: displayName,
          dingtalk_union_id: subject,
          ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        };
        const createPayload = phone
          ? {
              phone,
              phone_confirm: true,
              user_metadata: userMetadata,
            }
          : {
              email: placeholderDingtalkEmail(subject),
              email_confirm: true,
              user_metadata: userMetadata,
            };
        const { data: created, error: createError } = await ctx.supabaseAdmin.auth.admin
          .createUser(createPayload);
        if (createError || !created.user) {
          if (phone && isPhoneAlreadyRegisteredError(createError)) {
            const phoneLookup = await findUserIdByPhone(phone);
            if (phoneLookup.error) return jsonError(phoneLookup.error, 500);
            if (phoneLookup.userId) {
              userId = phoneLookup.userId;
            } else {
              const adminLookup = await findUserIdByPhoneViaAuthAdmin(phone);
              if (adminLookup.error) return jsonError(adminLookup.error, 500);
              if (adminLookup.userId) {
                userId = adminLookup.userId;
              } else {
                return jsonError("该手机号已注册，但无法匹配到已有账号", 400);
              }
            }
          } else {
            return jsonError(createError?.message || "无法创建用户", 400);
          }
        } else {
          userId = created.user.id;
        }
      }

      const { error: identityLinkError } = await ctx.supabaseAdmin
        .from("sso_identities")
        .upsert({
          provider: "dingtalk",
          subject,
          user_id: userId,
          last_workspace_id: workspaceId,
          updated_at: new Date().toISOString(),
        }, { onConflict: "provider,subject" });
      if (identityLinkError) return jsonError("无法建立钉钉账号关联", 500);

      const { data: existingProfile, error: profileLookupError } = await ctx.supabaseAdmin
        .from("profiles")
        .select("display_name_customized_at, avatar_url")
        .eq("id", userId)
        .maybeSingle();
      if (profileLookupError) return jsonError("无法查询用户资料", 500);

      const profileUpdate: {
        id: string;
        display_name?: string;
        avatar_url?: string;
      } = { id: userId };
      if (!existingProfile?.display_name_customized_at) {
        profileUpdate.display_name = displayName;
      }
      // Seed DingTalk avatar only when the user has not set one yet.
      if (avatarUrl && !existingProfile?.avatar_url?.trim()) {
        profileUpdate.avatar_url = avatarUrl;
      }
      if (profileUpdate.display_name !== undefined || profileUpdate.avatar_url !== undefined) {
        const { error: profileError } = await ctx.supabaseAdmin
          .from("profiles")
          .upsert(profileUpdate, { onConflict: "id" });
        if (profileError) return jsonError("无法更新用户资料", 500);
      }

      const { data: membership, error: membershipError } = await ctx.supabaseAdmin
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .maybeSingle();
      if (membershipError) return jsonError("无法查询团队空间成员关系", 500);
      if (!membership) {
        const { error: memberError } = await ctx.supabaseAdmin
          .from("workspace_members")
          .insert({
            workspace_id: workspaceId,
            user_id: userId,
            role: "member",
          });
        if (memberError) return jsonError(memberError.message, 400);
      }

      const { data: authUser, error: userError } = await ctx.supabaseAdmin.auth.admin
        .getUserById(userId);
      if (userError || !authUser.user) {
        return jsonError("无法加载用户会话", 500);
      }

      const linkEmail =
        authUser.user.email ||
        placeholderDingtalkEmail(subject);
      if (!authUser.user.email) {
        await ctx.supabaseAdmin.auth.admin.updateUserById(userId, {
          email: linkEmail,
          email_confirm: true,
        });
      }

      const { data: linkData, error: linkError } = await ctx.supabaseAdmin.auth.admin
        .generateLink({
          type: "magiclink",
          email: linkEmail,
        });
      if (linkError || !linkData.properties?.hashed_token) {
        return jsonError(linkError?.message || "无法签发登录凭证", 500);
      }

      if (stateClaims.client === "desktop") {
        const handoffCode = createHandoffCode();
        const expiresAt = new Date(
          Date.now() + HANDOFF_TTL_SECONDS * 1_000,
        ).toISOString();
        const { error: handoffError } = await ctx.supabaseAdmin.rpc(
          "create_sso_auth_handoff",
          {
            p_code_hash: await sha256(handoffCode),
            p_workspace_id: workspaceId,
            p_token_hash: linkData.properties.hashed_token,
            p_expires_at: expiresAt,
          },
        );
        if (handoffError) return jsonError("无法创建客户端登录交接", 500);
        return Response.json({
          mode: "desktop",
          workspaceId,
          handoffCode,
          expiresInSeconds: HANDOFF_TTL_SECONDS,
        });
      }

      return Response.json({
        mode: "web",
        workspaceId,
        tokenHash: linkData.properties.hashed_token,
        email: linkEmail,
      });
    }

    return jsonError("Unsupported action");
  }),
};
