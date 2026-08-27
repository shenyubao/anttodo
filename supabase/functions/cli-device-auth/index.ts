import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REQUEST_LIMIT = 24 * 1024;
const OAUTH_SCOPES = "email profile phone";
const ACCESS_TOKEN_MAX_SECONDS = 15 * 60;

function env(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing Edge secret: ${name}`);
  return value;
}

function publicAppUrl() {
  return (Deno.env.get("PUBLIC_APP_URL") ?? "https://app.anttodo.com").replace(/\/$/, "");
}

function internalSupabaseUrl() {
  return env("SUPABASE_URL").replace(/\/$/, "");
}

function publicSupabaseUrl() {
  return (Deno.env.get("CLI_OAUTH_PUBLIC_URL")?.trim() || internalSupabaseUrl()).replace(/\/$/, "");
}

function callbackUrl() {
  return `${publicSupabaseUrl()}/functions/v1/cli-device-auth`;
}

function corsHeaders(req: Request) {
  const allowed = new Set([publicAppUrl(), "http://127.0.0.1:5173", "http://localhost:5173"]);
  const origin = req.headers.get("origin");
  return {
    "access-control-allow-origin": origin && allowed.has(origin) ? origin : publicAppUrl(),
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    vary: "Origin",
  };
}

function json(req: Request, body: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, { status, headers: { ...corsHeaders(req), ...headers } });
}

function redirect(location: string) {
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function randomValue(size = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function generateUserCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const value = [...bytes].map((byte) => USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length]).join("");
  return value.match(/.{1,4}/g)?.join("-") ?? value;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function bearerToken(req: Request) {
  const value = req.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

function parseCredential(value: string | null) {
  const match = value?.match(/^atc_v2_([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/i);
  return match && isUuid(match[1]) ? { id: match[1], secret: match[2] } : null;
}

function decodeJwt(token: string) {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return null;
    const padded = encoded.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function accessExpiry(bundle: Record<string, unknown>) {
  const claims = typeof bundle.access_token === "string" ? decodeJwt(bundle.access_token) : null;
  return typeof claims?.exp === "number" ? new Date(claims.exp * 1000).toISOString() : null;
}

async function authenticatedUser(req: Request, admin: SupabaseClient) {
  const token = bearerToken(req);
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user;
}

async function tokenRequest(parameters: URLSearchParams) {
  const clientId = env("CLI_OAUTH_CLIENT_ID");
  const clientSecret = env("CLI_OAUTH_CLIENT_SECRET");
  const response = await fetch(`${internalSupabaseUrl()}/auth/v1/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: parameters,
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error_description === "string" ? payload.error_description : "OAuth token exchange failed");
  return payload;
}

function validateTokenBundle(bundle: Record<string, unknown>, expectedUserId?: string) {
  if (typeof bundle.access_token !== "string" || typeof bundle.refresh_token !== "string") {
    throw new Error("OAuth token response is incomplete");
  }
  const claims = decodeJwt(bundle.access_token);
  const clientId = env("CLI_OAUTH_CLIENT_ID");
  if (!claims || claims.client_id !== clientId || !isUuid(claims.session_id) || !isUuid(claims.sub)) {
    throw new Error("OAuth token claims are invalid");
  }
  if (expectedUserId && claims.sub !== expectedUserId) throw new Error("OAuth user binding mismatch");
  if (typeof claims.iat !== "number" || typeof claims.exp !== "number"
    || claims.exp - claims.iat > ACCESS_TOKEN_MAX_SECONDS || claims.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("CLI access token lifetime is invalid");
  }
  return { userId: claims.sub as string, sessionId: claims.session_id as string, expiresAt: new Date(claims.exp * 1000).toISOString() };
}

async function refreshBundle(bundle: Record<string, unknown>) {
  if (typeof bundle.refresh_token !== "string") throw new Error("OAuth refresh token is missing");
  const refreshed = await tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: bundle.refresh_token }));
  if (typeof refreshed.refresh_token !== "string") refreshed.refresh_token = bundle.refresh_token;
  return refreshed;
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });

    if (req.method === "GET") {
      const url = new URL(req.url);
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const oauthError = url.searchParams.get("error");
      if (oauthError) return redirect(`${publicAppUrl()}/auth/cli?oauth_result=denied`);
      if (!state || !code) return json(req, { error: "Invalid OAuth callback", code: "invalid_oauth_callback" }, 400);
      const { data: context, error } = await ctx.supabaseAdmin.rpc("cli_device_auth_callback_v2", {
        p_state_hash: await sha256(state),
      }).maybeSingle();
      if (error || !context) return json(req, { error: "OAuth state is invalid or expired", code: "invalid_oauth_state" }, 400);
      try {
        const bundle = await tokenRequest(new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: callbackUrl(),
          code_verifier: context.pkce_verifier,
        }));
        const verified = validateTokenBundle(bundle, context.user_id);
        const { data: completed, error: completionError } = await ctx.supabaseAdmin.rpc("cli_device_auth_complete_v2", {
          p_request_id: context.request_id,
          p_user_id: verified.userId,
          p_oauth_client_id: env("CLI_OAUTH_CLIENT_ID"),
          p_oauth_session_id: verified.sessionId,
          p_access_expires_at: verified.expiresAt,
          p_token_bundle: bundle,
        });
        if (completionError || !completed) throw new Error(completionError?.message ?? "Authorization request is no longer pending");
        return redirect(`${publicAppUrl()}/auth/cli?oauth_result=approved`);
      } catch (cause) {
        console.error("CLI OAuth callback failed", cause instanceof Error ? cause.message : cause);
        return redirect(`${publicAppUrl()}/auth/cli?oauth_result=error`);
      }
    }

    if (req.method !== "POST") return json(req, { error: "Method not allowed", code: "method_not_allowed" }, 405);
    const declaredLength = Number(req.headers.get("content-length") ?? 0);
    if (declaredLength > REQUEST_LIMIT) return json(req, { error: "Request too large", code: "request_too_large" }, 413);
    const raw = await req.text();
    if (raw.length > REQUEST_LIMIT) return json(req, { error: "Request too large", code: "request_too_large" }, 413);
    let body: Record<string, unknown> | null;
    try { body = JSON.parse(raw || "null") as Record<string, unknown> | null; }
    catch { return json(req, { error: "Invalid JSON body", code: "invalid_json" }, 400); }
    if (!body || typeof body.action !== "string") return json(req, { error: "Invalid request", code: "invalid_request" }, 400);

    if (body.action === "init") {
      if (body.protocolVersion !== 2) {
        return json(req, { error: "This CLI version must be upgraded before signing in", code: "cli_upgrade_required", protocolVersion: 2 }, 426);
      }
      if (!isSha256(body.deviceCodeHash)) return json(req, { error: "Invalid device request", code: "invalid_device_request" }, 400);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const userCode = generateUserCode();
        const { data, error } = await ctx.supabaseAdmin.rpc("cli_device_auth_init_v2", {
          p_device_code_hash: body.deviceCodeHash,
          p_user_code_hash: await sha256(userCode),
          p_client_metadata: body.client && typeof body.client === "object" ? body.client : {},
        }).single();
        if (!error && data) return json(req, {
          requestId: data.request_id,
          userCode,
          verificationUrl: `${publicAppUrl()}/auth/cli?user_code=${encodeURIComponent(userCode)}`,
          expiresAt: data.expires_at,
          interval: 5,
        });
        if (error?.code !== "23505") return json(req, { error: error?.message ?? "Unable to start authorization", code: error?.code ?? "init_failed" }, 400);
      }
      return json(req, { error: "Unable to allocate user code", code: "user_code_collision" }, 503);
    }

    if (body.action === "inspect") {
      if (typeof body.userCode !== "string") return json(req, { error: "Invalid user code", code: "invalid_user_code" }, 400);
      const { data, error } = await ctx.supabaseAdmin.rpc("cli_device_auth_inspect_v2", {
        p_user_code_hash: await sha256(body.userCode.toUpperCase()),
      }).maybeSingle();
      if (error) return json(req, { error: error.message, code: error.code ?? "inspect_failed" }, 400);
      if (!data) return json(req, { error: "Authorization request not found or expired", code: "request_not_found" }, 404);
      return json(req, { requestId: data.request_id, client: data.client_metadata, status: data.status, expiresAt: data.expires_at });
    }

    if (["authorize", "deny", "validate_consent", "list", "revoke"].includes(body.action)) {
      const user = await authenticatedUser(req, ctx.supabaseAdmin);
      const selfCredential = body.action === "revoke" ? parseCredential(bearerToken(req)) : null;
      if (!user && !selfCredential) return json(req, { error: "Authentication required", code: "authentication_required" }, 401);

      if (body.action === "list") {
        const { data, error } = await ctx.supabaseAdmin.rpc("cli_device_auth_list_v2", { p_user_id: user!.id });
        if (error) return json(req, { error: error.message, code: error.code ?? "list_failed" }, 400);
        return json(req, { devices: (data ?? []).map((item: Record<string, unknown>) => ({
          id: item.id, client: item.client_metadata, createdAt: item.created_at,
          lastUsedAt: item.last_used_at, expiresAt: item.expires_at,
        })) });
      }

      if (body.action === "validate_consent") {
        if (!isUuid(body.requestId) || typeof body.nonce !== "string" || typeof body.authorizationId !== "string"
          || body.clientId !== env("CLI_OAUTH_CLIENT_ID")) {
          return json(req, { error: "Invalid consent context", code: "invalid_consent_context" }, 400);
        }
        const { data, error } = await ctx.supabaseAdmin.rpc("cli_device_auth_bind_oauth_v2", {
          p_request_id: body.requestId, p_user_id: user!.id,
          p_nonce_hash: await sha256(body.nonce), p_authorization_id: body.authorizationId,
        });
        if (error || !data) return json(req, { error: "Consent context is invalid", code: "invalid_consent_context" }, 409);
        return json(req, { valid: true, clientId: env("CLI_OAUTH_CLIENT_ID") });
      }

      if (body.action === "deny") {
        if (!isUuid(body.requestId) || typeof body.userCode !== "string") return json(req, { error: "Invalid authorization request", code: "invalid_request" }, 400);
        const { data, error } = await ctx.supabaseAdmin.rpc("cli_device_auth_deny_v2", {
          p_request_id: body.requestId, p_user_code_hash: await sha256(body.userCode.toUpperCase()), p_user_id: user!.id,
        });
        if (error || !data) return json(req, { error: error?.message ?? "Authorization request is no longer pending", code: "request_not_pending" }, 409);
        return json(req, { status: "denied" });
      }

      if (body.action === "authorize") {
        if (!isUuid(body.requestId) || typeof body.userCode !== "string" || !["7", "90", "360", "unlimited"].includes(String(body.lifetime))) {
          return json(req, { error: "Invalid authorization request", code: "invalid_request" }, 400);
        }
        const state = randomValue();
        const nonce = randomValue();
        const verifier = randomValue();
        const { error: registrationError } = await ctx.supabaseAdmin.rpc("cli_device_auth_register_client_v2", {
          p_client_id: env("CLI_OAUTH_CLIENT_ID"),
        });
        if (registrationError) return json(req, { error: registrationError.message, code: "oauth_client_registration_failed" }, 500);
        const { data, error } = await ctx.supabaseAdmin.rpc("cli_device_auth_authorize_v2", {
          p_request_id: body.requestId, p_user_code_hash: await sha256(body.userCode.toUpperCase()),
          p_user_id: user!.id, p_lifetime: String(body.lifetime), p_state_hash: await sha256(state),
          p_nonce_hash: await sha256(nonce), p_pkce_verifier: verifier,
        }).maybeSingle();
        if (error || !data) return json(req, { error: error?.message ?? "Authorization request is no longer pending", code: "request_not_pending" }, 409);
        const authorize = new URL(`${publicSupabaseUrl()}/auth/v1/oauth/authorize`);
        authorize.search = new URLSearchParams({ client_id: env("CLI_OAUTH_CLIENT_ID"), redirect_uri: callbackUrl(),
          response_type: "code", scope: OAUTH_SCOPES, state, code_challenge: await pkceChallenge(verifier), code_challenge_method: "S256" }).toString();
        return json(req, { status: "authorizing", authorizationUrl: authorize.toString(), consentNonce: nonce,
          credentialExpiresAt: data.credential_expires_at });
      }

      if (body.action === "revoke") {
        const credentialId = selfCredential?.id ?? (isUuid(body.credentialId) ? body.credentialId : null);
        if (!credentialId) return json(req, { error: "Invalid credential", code: "invalid_device_credentials" }, 400);
        const credentialHash = selfCredential ? await sha256(selfCredential.secret) : null;
        const { data: context, error } = await ctx.supabaseAdmin.rpc("cli_device_auth_revoke_context_v2", {
          p_credential_id: credentialId, p_user_id: user?.id ?? null, p_credential_hash: credentialHash,
        }).maybeSingle();
        if (error || !context) return json(req, { error: "Credential was not found", code: "credential_not_found" }, 404);
        let bundle = context.token_bundle as Record<string, unknown>;
        const expiry = accessExpiry(bundle);
        if (!expiry || Date.parse(expiry) <= Date.now() + 60_000) bundle = await refreshBundle(bundle);
        if (typeof bundle.access_token === "string") {
          await fetch(`${internalSupabaseUrl()}/auth/v1/logout?scope=local`, {
            method: "POST", headers: { apikey: env("SUPABASE_ANON_KEY"), authorization: `Bearer ${bundle.access_token}` },
            signal: AbortSignal.timeout(15_000),
          }).catch(() => undefined);
        }
        const { data, error: revokeError } = await ctx.supabaseAdmin.rpc("cli_device_auth_revoke_v2", {
          p_credential_id: credentialId, p_user_id: user?.id ?? null, p_credential_hash: credentialHash,
        });
        if (revokeError || !data) return json(req, { error: revokeError?.message ?? "Unable to revoke credential", code: "revoke_failed" }, 400);
        return json(req, { revoked: true });
      }
    }

    if (body.action === "poll" || body.action === "consume") {
      if (!isUuid(body.requestId) || typeof body.deviceCode !== "string" || body.deviceCode.length !== 43) {
        return json(req, { error: "Invalid device credentials", code: "invalid_device_credentials" }, 400);
      }
      const deviceCodeHash = await sha256(body.deviceCode);
      if (body.action === "consume") {
        const { data, error } = await ctx.supabaseAdmin.rpc("cli_device_auth_consume_v2", { p_request_id: body.requestId, p_device_code_hash: deviceCodeHash });
        if (error || !data) return json(req, { error: error?.message ?? "Authorization cannot be consumed", code: "not_consumable" }, 409);
        return json(req, { status: "consumed" });
      }
      const { data, error } = await ctx.supabaseAdmin.rpc("cli_device_auth_poll_v2", { p_request_id: body.requestId, p_device_code_hash: deviceCodeHash }).maybeSingle();
      if (error) return json(req, { error: error.message, code: error.code ?? "poll_failed" }, 400);
      if (!data) return json(req, { error: "Invalid device credentials", code: "invalid_device_credentials" }, 404);
      return json(req, { status: data.status, userId: data.user_id, expiresAt: data.expires_at, retryAfter: data.retry_after });
    }

    if (body.action === "exchange") {
      const credential = parseCredential(bearerToken(req));
      if (!credential) return json(req, { error: "Invalid CLI credential", code: "invalid_device_credentials" }, 401);
      const leaseId = crypto.randomUUID();
      const { data, error } = await ctx.supabaseAdmin.rpc("cli_device_auth_exchange_v2", {
        p_credential_id: credential.id, p_credential_hash: await sha256(credential.secret), p_lease_id: leaseId,
      }).maybeSingle();
      if (error || !data) return json(req, { error: "Credential is expired or revoked", code: "credential_inactive" }, 401);
      let bundle = data.token_bundle as Record<string, unknown>;
      if (data.refresh_required) {
        if (!data.lease_acquired) return json(req, { error: "Token refresh is already in progress", code: "refresh_in_progress", retryAfter: data.retry_after }, 409, { "retry-after": String(data.retry_after) });
        try {
          bundle = await refreshBundle(bundle);
          const verified = validateTokenBundle(bundle, data.user_id);
          const { data: completed, error: refreshError } = await ctx.supabaseAdmin.rpc("cli_device_auth_refresh_v2", {
            p_credential_id: credential.id, p_lease_id: leaseId, p_access_expires_at: verified.expiresAt, p_token_bundle: bundle,
          });
          if (refreshError || !completed) throw new Error(refreshError?.message ?? "Refresh lease expired");
        } catch (cause) {
          await ctx.supabaseAdmin.rpc("cli_device_auth_abort_refresh_v2", { p_credential_id: credential.id, p_lease_id: leaseId });
          throw cause;
        }
      }
      const verified = validateTokenBundle(bundle, data.user_id);
      return json(req, { accessToken: bundle.access_token, expiresAt: verified.expiresAt,
        user: { id: verified.userId }, credentialExpiresAt: data.credential_expires_at });
    }

    return json(req, { error: "Unsupported action", code: "unsupported_action" }, 400);
  }),
};
