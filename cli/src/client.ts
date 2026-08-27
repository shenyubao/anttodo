import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { loadPublicConfig } from "./config.js";
import { CliError } from "./errors.js";
import { readCliCredential, setActiveServiceKey, updateCliAccessToken } from "./storage.js";
import type { PublicConfig, ServiceConfig } from "./types.js";

export type ClientContext = { client: SupabaseClient; config: ServiceConfig };
const exchanges = new Map<string, Promise<string>>();

export async function invokeDeviceAuthorization(config: PublicConfig, body: Record<string, unknown>, accessToken?: string) {
  const response = await fetch(config.deviceAuthorizationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: config.publishableKey, ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new CliError({
    type: response.status === 401 ? "authentication" : "api",
    code: typeof payload.code === "string" ? payload.code : `device_auth_http_${response.status}`,
    message: typeof payload.error === "string" ? payload.error : "Device authorization failed", details: payload,
  });
  return payload;
}

export async function exchangeCliAccessToken(config: ServiceConfig, credential: string) {
  const payload = await invokeDeviceAuthorization(config, { action: "exchange" }, credential);
  if (typeof payload.accessToken !== "string" || typeof payload.expiresAt !== "string") {
    throw new CliError({ type: "api", code: "invalid_exchange_response", message: "The service returned an invalid token exchange response" });
  }
  return { accessToken: payload.accessToken, expiresAt: payload.expiresAt,
    credentialExpiresAt: typeof payload.credentialExpiresAt === "string" ? payload.credentialExpiresAt : null };
}

async function accessTokenFor(config: ServiceConfig, force = false) {
  const stored = await readCliCredential(config.serviceKey);
  if (stored.legacy) throw new CliError({ type: "authentication", code: "legacy_auth_reauthorization_required", message: "This CLI session uses the retired Supabase token format", hint: "Run `anttodo auth login` to authorize this CLI again" });
  const credential = stored.credential;
  if (!credential) throw new CliError({ type: "authentication", code: "not_logged_in", message: "Not logged in", hint: "Run `anttodo auth login`" });
  if (credential.credentialExpiresAt && Date.parse(credential.credentialExpiresAt) <= Date.now()) {
    throw new CliError({ type: "authentication", code: "credential_expired", message: "This CLI device authorization has expired", hint: "Run `anttodo auth login`" });
  }
  if (!force && credential.accessToken && credential.accessTokenExpiresAt && Date.parse(credential.accessTokenExpiresAt) > Date.now() + 60_000) return credential.accessToken;
  const existing = exchanges.get(config.serviceKey);
  if (existing) return existing;
  const exchange = exchangeCliAccessToken(config, `atc_v2_${credential.deviceId}.${credential.secret}`)
    .then(async (result) => {
      await updateCliAccessToken(result.accessToken, result.expiresAt, config.serviceKey);
      return result.accessToken;
    }).finally(() => exchanges.delete(config.serviceKey));
  exchanges.set(config.serviceKey, exchange);
  return exchange;
}

async function initialCachedAccessToken(config: ServiceConfig) {
  const { credential } = await readCliCredential(config.serviceKey);
  return credential?.accessToken && credential.accessTokenExpiresAt
    && Date.parse(credential.accessTokenExpiresAt) > Date.now() + 60_000
    ? credential.accessToken : null;
}

function retryingFetch(config: ServiceConfig) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const retryInput = input instanceof Request ? input.clone() : input;
    const response = await fetch(input, init);
    if (response.status !== 401) return response;
    const token = await accessTokenFor(config, true);
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    return fetch(retryInput, { ...init, headers });
  };
}

export async function createClientContext(options: { serviceUrl?: string; config?: ServiceConfig } = {}): Promise<ClientContext> {
  const config = options.config ?? await loadPublicConfig({ serviceUrl: options.serviceUrl });
  setActiveServiceKey(config.serviceKey);
  let initialProbe = true;
  return { config, client: createClient(config.supabaseUrl, config.publishableKey, {
    accessToken: () => {
      if (initialProbe) { initialProbe = false; return initialCachedAccessToken(config); }
      return accessTokenFor(config);
    },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: retryingFetch(config) },
  }) };
}

export async function authenticatedContext(options: { serviceUrl?: string; config?: ServiceConfig } = {}): Promise<ClientContext & { user: User }> {
  const context = await createClientContext(options);
  const stored = await readCliCredential(context.config.serviceKey);
  if (stored.legacy) throw new CliError({ type: "authentication", code: "legacy_auth_reauthorization_required", message: "This CLI session uses the retired Supabase token format", hint: "Run `anttodo auth login` to authorize this CLI again" });
  if (!stored.credential) throw new CliError({ type: "authentication", code: "not_logged_in", message: "Not logged in", hint: "Run `anttodo auth login`" });
  if (stored.credential.credentialExpiresAt && Date.parse(stored.credential.credentialExpiresAt) <= Date.now()) {
    throw new CliError({ type: "authentication", code: "credential_expired", message: "This CLI device authorization has expired", hint: "Run `anttodo auth login`" });
  }
  return { ...context, user: stored.credential.user as User };
}
