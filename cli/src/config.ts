import { z } from "zod";
import { CliError } from "./errors.js";
import { cachePublicConfig, readCachedPublicConfig } from "./storage.js";
import type { PublicConfig } from "./types.js";

const configSchema = z.object({
  supabaseUrl: z.url(),
  publishableKey: z.string().min(10),
  appUrl: z.url(),
  deviceAuthorizationEndpoint: z.url(),
});

export const DEFAULT_APP_URL = "https://app.anttodo.com";

export async function loadPublicConfig(): Promise<PublicConfig> {
  const appUrl = process.env.ANTTODO_APP_URL ?? DEFAULT_APP_URL;
  const supabaseUrl = process.env.ANTTODO_SUPABASE_URL;
  const publishableKey = process.env.ANTTODO_SUPABASE_PUBLISHABLE_KEY;
  if (Boolean(supabaseUrl) !== Boolean(publishableKey)) {
    throw new CliError({
      type: "configuration",
      code: "incomplete_environment_config",
      message: "ANTTODO_SUPABASE_URL and ANTTODO_SUPABASE_PUBLISHABLE_KEY must be set together",
    });
  }
  if (supabaseUrl && publishableKey) {
    try {
      return configSchema.parse({
        supabaseUrl,
        publishableKey,
        appUrl,
        deviceAuthorizationEndpoint: process.env.ANTTODO_DEVICE_AUTH_URL
          ?? `${supabaseUrl.replace(/\/$/, "")}/functions/v1/cli-device-auth`,
      });
    } catch (error) {
      throw new CliError({
        type: "configuration",
        code: "invalid_environment_config",
        message: "AntTodo environment configuration is invalid",
        details: error instanceof Error ? error.message : undefined,
      });
    }
  }

  try {
    const response = await fetch(`${appUrl.replace(/\/$/, "")}/.well-known/anttodo-cli.json`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = configSchema.parse(await response.json());
    await cachePublicConfig(config);
    return config;
  } catch (error) {
    const cached = await readCachedPublicConfig();
    if (cached) {
      const parsed = configSchema.safeParse(cached.config);
      if (parsed.success) return parsed.data;
    }
    throw new CliError({
      type: "configuration",
      code: "public_config_unavailable",
      message: `Unable to load AntTodo configuration from ${appUrl}`,
      hint: "Check your network connection and try again",
      details: error instanceof Error ? error.message : undefined,
    });
  }
}
