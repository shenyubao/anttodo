const encoder = new TextEncoder();

export {
  isPhoneAlreadyRegisteredError,
  normalizeMainlandMobile,
} from "./dingtalk-sso-phone.ts";

export type DingtalkPublicConfig = {
  corpId: string;
  appKey: string;
  agentId?: string;
};

export type DingtalkUserInfo = {
  nick?: string;
  unionId?: string;
  openId?: string;
  mobile?: string;
  stateCode?: string;
};

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function hmacSign(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

export function getSsoStateSecret() {
  return Deno.env.get("SSO_STATE_SECRET")?.trim() || "";
}

export function getPublicAppUrl() {
  return (
    Deno.env.get("PUBLIC_APP_URL")?.trim() ||
    Deno.env.get("VITE_PUBLIC_APP_URL")?.trim() ||
    ""
  );
}

export function dingtalkCallbackUrl(appUrl: string) {
  const base = appUrl.replace(/\/$/, "");
  return `${base}/auth/dingtalk/callback`;
}

export async function createSsoState(workspaceId: string, secret: string) {
  if (!secret) throw new Error("SSO_STATE_SECRET is not configured");
  const issuedAt = Date.now().toString(36);
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const payload = `${workspaceId}.${issuedAt}.${nonce}`;
  const signature = await hmacSign(secret, payload);
  return `${payload}.${signature}`;
}

export async function verifySsoState(
  state: string,
  workspaceId: string,
  secret: string,
  maxAgeMs = 10 * 60 * 1000,
) {
  if (!secret) return false;
  const parts = state.split(".");
  if (parts.length !== 4) return false;
  const [stateWorkspaceId, issuedAtRaw, nonce, signature] = parts;
  if (!stateWorkspaceId || !issuedAtRaw || !nonce || !signature) return false;
  if (stateWorkspaceId !== workspaceId) return false;
  const issuedAt = Number.parseInt(issuedAtRaw, 36);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > maxAgeMs) return false;
  const payload = `${stateWorkspaceId}.${issuedAtRaw}.${nonce}`;
  const expected = await hmacSign(secret, payload);
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

export function dingtalkSubject(user: DingtalkUserInfo) {
  const unionId = user.unionId?.trim();
  if (unionId) return unionId;
  const openId = user.openId?.trim();
  if (openId) return openId;
  return null;
}

export function placeholderDingtalkEmail(subject: string) {
  const safe = subject.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64) || "user";
  return `dingtalk.${safe}@sso.anttodo.local`;
}

export async function exchangeDingtalkAuthCode(input: {
  appKey: string;
  appSecret: string;
  authCode: string;
}) {
  const tokenResponse = await fetch("https://api.dingtalk.com/v1.0/oauth2/userAccessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: input.appKey,
      clientSecret: input.appSecret,
      code: input.authCode,
      grantType: "authorization_code",
    }),
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenPayload.accessToken) {
    const raw =
      typeof tokenPayload.message === "string"
        ? tokenPayload.message
        : "Failed to exchange DingTalk auth code";
    if (raw.includes("不合法的临时授权码") || /invalid.*auth.?code/i.test(raw)) {
      throw new Error(
        "钉钉授权码无效或已使用。请确认 AppKey 与 AppSecret 匹配后，返回重新扫码登录。",
      );
    }
    throw new Error(raw);
  }

  const userResponse = await fetch("https://api.dingtalk.com/v1.0/contact/users/me", {
    headers: {
      "x-acs-dingtalk-access-token": tokenPayload.accessToken as string,
    },
  });
  const userPayload = (await userResponse.json().catch(() => ({}))) as DingtalkUserInfo & {
    message?: string;
  };
  if (!userResponse.ok) {
    throw new Error(
      typeof userPayload.message === "string"
        ? userPayload.message
        : "Failed to load DingTalk user profile",
    );
  }
  return userPayload;
}

export function parsePublicConfig(value: unknown): DingtalkPublicConfig | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const corpId = typeof record.corpId === "string" ? record.corpId.trim() : "";
  const appKey = typeof record.appKey === "string" ? record.appKey.trim() : "";
  const agentId = typeof record.agentId === "string" ? record.agentId.trim() : "";
  if (!corpId || !appKey) return null;
  return agentId ? { corpId, appKey, agentId } : { corpId, appKey };
}
