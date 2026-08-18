import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { loadPublicConfig } from "./config.js";
import { CliError } from "./errors.js";
import { FileAuthStorage, setActiveServiceKey } from "./storage.js";
import type { PublicConfig, ServiceConfig } from "./types.js";

export type ClientContext = {
  client: SupabaseClient;
  config: ServiceConfig;
};

export async function createClientContext(options: { serviceUrl?: string; config?: ServiceConfig } = {}): Promise<ClientContext> {
  const config = options.config ?? await loadPublicConfig({ serviceUrl: options.serviceUrl });
  setActiveServiceKey(config.serviceKey);
  return {
    config,
    client: createClient(config.supabaseUrl, config.publishableKey, {
      auth: {
        storage: new FileAuthStorage(config.serviceKey),
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }),
  };
}

export async function authenticatedContext(options: { serviceUrl?: string; config?: ServiceConfig } = {}): Promise<ClientContext & { user: User }> {
  const context = await createClientContext(options);
  const { data: sessionData, error: sessionError } = await context.client.auth.getSession();
  if (sessionError || !sessionData.session) {
    throw new CliError({
      type: "authentication",
      code: "not_logged_in",
      message: "Not logged in",
      hint: "Run `anttodo auth login`",
    });
  }
  return { ...context, user: sessionData.session.user };
}

export async function invokeDeviceAuthorization(
  config: PublicConfig,
  body: Record<string, unknown>,
  accessToken?: string,
) {
  const response = await fetch(config.deviceAuthorizationEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: config.publishableKey,
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new CliError({
      type: response.status === 401 ? "authentication" : "api",
      code: typeof payload.code === "string" ? payload.code : `device_auth_http_${response.status}`,
      message: typeof payload.error === "string" ? payload.error : "Device authorization failed",
      details: payload,
    });
  }
  return payload;
}
