import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REQUEST_LIMIT = 24 * 1024;

function corsHeaders(req: Request) {
  const allowed = new Set([
    Deno.env.get("PUBLIC_APP_URL") ?? "https://app.anttodo.com",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ]);
  const origin = req.headers.get("origin");
  return {
    "access-control-allow-origin": origin && allowed.has(origin) ? origin : "https://app.anttodo.com",
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(req) });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

function validPublicKey(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const key = value as Record<string, unknown>;
  return key.kty === "EC" && key.crv === "P-256"
    && typeof key.x === "string" && typeof key.y === "string";
}

function validEncryptedSession(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const encrypted = value as Record<string, unknown>;
  return validPublicKey(encrypted.ephemeralPublicKey)
    && [encrypted.salt, encrypted.iv, encrypted.ciphertext]
      .every((part) => typeof part === "string" && part.length > 0);
}

function bearerToken(req: Request) {
  const value = req.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
    if (req.method !== "POST") return json(req, { error: "Method not allowed", code: "method_not_allowed" }, 405);
    const declaredLength = Number(req.headers.get("content-length") ?? 0);
    if (declaredLength > REQUEST_LIMIT) return json(req, { error: "Request too large", code: "request_too_large" }, 413);
    const raw = await req.text();
    if (raw.length > REQUEST_LIMIT) return json(req, { error: "Request too large", code: "request_too_large" }, 413);
    let body: Record<string, unknown> | null;
    try {
      body = JSON.parse(raw || "null") as Record<string, unknown> | null;
    } catch {
      return json(req, { error: "Invalid JSON body", code: "invalid_json" }, 400);
    }
    if (!body || typeof body.action !== "string") return json(req, { error: "Invalid request", code: "invalid_request" }, 400);

    if (body.action === "init") {
      if (!isSha256(body.deviceCodeHash) || !validPublicKey(body.publicKey)) {
        return json(req, { error: "Invalid device request", code: "invalid_device_request" }, 400);
      }
      const appUrl = (Deno.env.get("PUBLIC_APP_URL") ?? "https://app.anttodo.com").replace(/\/$/, "");
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const userCode = generateUserCode();
        const { data, error } = await ctx.supabaseAdmin.rpc("cli_device_auth_init", {
          p_device_code_hash: body.deviceCodeHash,
          p_user_code_hash: await sha256(userCode),
          p_public_key: body.publicKey,
          p_client_metadata: body.client && typeof body.client === "object" ? body.client : {},
        }).single();
        if (!error && data) {
          const request = data as { request_id: string; expires_at: string };
          return json(req, {
            requestId: request.request_id,
            userCode,
            verificationUrl: `${appUrl}/auth/cli?user_code=${encodeURIComponent(userCode)}`,
            expiresAt: request.expires_at,
            interval: 5,
          });
        }
        if (error?.code !== "23505") {
          return json(req, { error: error?.message ?? "Unable to start authorization", code: error?.code ?? "init_failed" }, 400);
        }
      }
      return json(req, { error: "Unable to allocate user code", code: "user_code_collision" }, 503);
    }

    if (body.action === "inspect") {
      if (typeof body.userCode !== "string") return json(req, { error: "Invalid user code", code: "invalid_user_code" }, 400);
      const { data, error } = await ctx.supabaseAdmin.rpc("cli_device_auth_inspect", {
        p_user_code_hash: await sha256(body.userCode.toUpperCase()),
      }).maybeSingle();
      if (error) return json(req, { error: error.message, code: error.code ?? "inspect_failed" }, 400);
      if (!data) return json(req, { error: "Authorization request not found or expired", code: "request_not_found" }, 404);
      return json(req, {
        requestId: data.request_id,
        publicKey: data.client_public_key,
        client: data.client_metadata,
        status: data.status,
        expiresAt: data.expires_at,
      });
    }

    if (body.action === "approve" || body.action === "deny") {
      if (!isUuid(body.requestId) || typeof body.userCode !== "string") {
        return json(req, { error: "Invalid authorization request", code: "invalid_request" }, 400);
      }
      const token = bearerToken(req);
      if (!token) return json(req, { error: "Authentication required", code: "authentication_required" }, 401);
      const { data: userData, error: userError } = await ctx.supabaseAdmin.auth.getUser(token);
      if (userError || !userData.user) return json(req, { error: "Invalid user session", code: "invalid_session" }, 401);
      const userCodeHash = await sha256(body.userCode.toUpperCase());
      if (body.action === "approve") {
        if (!validEncryptedSession(body.encryptedSession)) {
          return json(req, { error: "Invalid encrypted session", code: "invalid_encrypted_session" }, 400);
        }
        const { data, error } = await ctx.supabaseAdmin.rpc("cli_device_auth_approve", {
          p_request_id: body.requestId,
          p_user_code_hash: userCodeHash,
          p_user_id: userData.user.id,
          p_encrypted_session: body.encryptedSession,
        });
        if (error) return json(req, { error: error.message, code: error.code ?? "approval_failed" }, 400);
        if (!data) return json(req, { error: "Authorization request is no longer pending", code: "request_not_pending" }, 409);
      } else {
        const { data, error } = await ctx.supabaseAdmin.rpc("cli_device_auth_deny", {
          p_request_id: body.requestId,
          p_user_code_hash: userCodeHash,
          p_user_id: userData.user.id,
        });
        if (error) return json(req, { error: error.message, code: error.code ?? "denial_failed" }, 400);
        if (!data) return json(req, { error: "Authorization request is no longer pending", code: "request_not_pending" }, 409);
      }
      return json(req, { status: body.action === "approve" ? "approved" : "denied" });
    }

    if (body.action === "poll" || body.action === "consume") {
      if (!isUuid(body.requestId) || typeof body.deviceCode !== "string" || body.deviceCode.length < 32) {
        return json(req, { error: "Invalid device credentials", code: "invalid_device_credentials" }, 400);
      }
      const deviceCodeHash = await sha256(body.deviceCode);
      if (body.action === "consume") {
        const { data, error } = await ctx.supabaseAdmin.rpc("cli_device_auth_consume", {
          p_request_id: body.requestId,
          p_device_code_hash: deviceCodeHash,
        });
        if (error) return json(req, { error: error.message, code: error.code ?? "consume_failed" }, 400);
        if (!data) return json(req, { error: "Authorization cannot be consumed", code: "not_consumable" }, 409);
        return json(req, { status: "consumed" });
      }
      const { data, error } = await ctx.supabaseAdmin.rpc("cli_device_auth_poll", {
        p_request_id: body.requestId,
        p_device_code_hash: deviceCodeHash,
      }).maybeSingle();
      if (error) return json(req, { error: error.message, code: error.code ?? "poll_failed" }, 400);
      if (!data) return json(req, { error: "Invalid device credentials", code: "invalid_device_credentials" }, 404);
      return json(req, {
        status: data.status,
        authorizedUserId: data.authorized_user_id,
        encryptedSession: data.encrypted_session,
        expiresAt: data.expires_at,
        retryAfter: data.retry_after,
      });
    }

    return json(req, { error: "Unsupported action", code: "unsupported_action" }, 400);
  }),
};
