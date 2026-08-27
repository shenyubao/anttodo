import type { SupabaseClient } from "@supabase/supabase-js";

export type CliCredentialLifetime = "7" | "90" | "360" | "unlimited";
export type CliAuthorizationRequest = {
  requestId: string;
  client: { name?: string; version?: string; hostname?: string | null };
  status: string;
  expiresAt: string;
};
export type CliAuthorizedDevice = {
  id: string;
  client: { name?: string; version?: string; hostname?: string | null };
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

const CONSENT_CONTEXT_KEY = "anttodo:cli-oauth-consent-v2";

export function cliAuthorizationUserCode(pathname: string, search: string) {
  if (pathname !== "/auth/cli") return null;
  return new URLSearchParams(search).get("user_code")?.toUpperCase() ?? "";
}

export function cliOAuthAuthorizationId(pathname: string, search: string) {
  if (pathname !== "/oauth/consent") return null;
  return new URLSearchParams(search).get("authorization_id") ?? "";
}

async function invoke<T>(client: SupabaseClient, body: Record<string, unknown>) {
  const { data, error } = await client.functions.invoke("cli-device-auth", { body });
  if (error) throw error;
  return data as T;
}

export async function inspectCliAuthorization(client: SupabaseClient, userCode: string) {
  return invoke<CliAuthorizationRequest>(client, { action: "inspect", userCode });
}

export async function authorizeCliDevice(client: SupabaseClient, input: {
  userCode: string; requestId: string; lifetime: CliCredentialLifetime;
}) {
  const result = await invoke<{ authorizationUrl: string; consentNonce: string }>(client, { action: "authorize", ...input });
  sessionStorage.setItem(CONSENT_CONTEXT_KEY, JSON.stringify({ requestId: input.requestId, nonce: result.consentNonce }));
  return result;
}

export async function denyCliDevice(client: SupabaseClient, input: { userCode: string; requestId: string }) {
  return invoke<{ status: "denied" }>(client, { action: "deny", ...input });
}

export function readCliConsentContext() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(CONSENT_CONTEXT_KEY) ?? "null") as { requestId?: unknown; nonce?: unknown } | null;
    return parsed && typeof parsed.requestId === "string" && typeof parsed.nonce === "string"
      ? { requestId: parsed.requestId, nonce: parsed.nonce } : null;
  } catch { return null; }
}

export function clearCliConsentContext() {
  sessionStorage.removeItem(CONSENT_CONTEXT_KEY);
}

export async function validateCliConsent(client: SupabaseClient, input: {
  authorizationId: string; clientId: string; requestId: string; nonce: string;
}) {
  return invoke<{ valid: true; clientId: string }>(client, { action: "validate_consent", ...input });
}

export async function listCliDevices(client: SupabaseClient) {
  const result = await invoke<{ devices: CliAuthorizedDevice[] }>(client, { action: "list" });
  return result.devices;
}

export async function revokeCliDevice(client: SupabaseClient, credentialId: string) {
  return invoke<{ revoked: true }>(client, { action: "revoke", credentialId });
}
