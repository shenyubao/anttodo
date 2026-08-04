import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { loadPublicConfig } from "./config.js";
import { CliError } from "./errors.js";
import { FileAuthStorage } from "./storage.js";
import type { PublicConfig } from "./types.js";

export type ClientContext = {
  client: SupabaseClient;
  config: PublicConfig;
};

export async function createClientContext(): Promise<ClientContext> {
  const config = await loadPublicConfig();
  return {
    config,
    client: createClient(config.supabaseUrl, config.publishableKey, {
      auth: {
        storage: new FileAuthStorage(),
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }),
  };
}

export async function authenticatedContext(): Promise<ClientContext & { user: User }> {
  const context = await createClientContext();
  const { data: sessionData, error: sessionError } = await context.client.auth.getSession();
  if (sessionError || !sessionData.session) {
    throw new CliError({
      type: "authentication",
      code: "not_logged_in",
      message: "Not logged in",
      hint: "Run `anttodo auth login`",
    });
  }
  const { data, error } = await context.client.auth.getUser();
  if (error || !data.user) {
    throw new CliError({
      type: "authentication",
      code: "invalid_session",
      message: "The saved session is no longer valid",
      hint: "Run `anttodo auth login` again",
    });
  }
  return { ...context, user: data.user };
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
