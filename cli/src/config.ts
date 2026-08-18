import { createHash } from "node:crypto";
import { z } from "zod";
import { CliError } from "./errors.js";
import {
  cachePublicConfig,
  getSelectedServiceKey,
  getStoredService,
  listStoredServices,
  saveServiceConfig,
  selectServiceKey,
  serviceKeyFor,
  setActiveServiceKey,
  readCachedPublicConfig,
} from "./storage.js";
import type { PublicConfig, ServiceConfig } from "./types.js";

const publicConfigSchema = z.object({
  supabaseUrl: z.url(),
  publishableKey: z.string().min(10),
  appUrl: z.url(),
  deviceAuthorizationEndpoint: z.url(),
});

export const DEFAULT_APP_URL = "https://app.anttodo.com";
export const INSTANCE_MANIFEST_PATH = "/.well-known/anttodo.json";

let runtimeServiceUrl: string | undefined;

export function setRuntimeServiceUrl(value: string | undefined) {
  runtimeServiceUrl = value;
}

export function getRuntimeServiceUrl() {
  return runtimeServiceUrl;
}

function allowLocalHttp() {
  return process.env.ANTTODO_ALLOW_LOCAL_HTTP === "1";
}

export function normalizeServiceOrigin(value: string, localHttp = allowLocalHttp()) {
  const trimmed = value.trim();
  if (!trimmed) throw new CliError({ type: "validation", code: "empty_service_url", message: "Service address is required" });
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new CliError({ type: "validation", code: "invalid_service_url", message: "Service address is invalid" });
  }
  const local = localHttp && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new CliError({ type: "validation", code: "insecure_service_url", message: "Custom services must use HTTPS" });
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new CliError({ type: "validation", code: "service_url_must_be_origin", message: "Service address must be an origin without credentials, path, query, or fragment" });
  }
  return url.origin;
}

function secureUrl(value: unknown, field: string) {
  if (typeof value !== "string") throw new Error(`${field} is missing`);
  const url = new URL(value);
  const local = allowLocalHttp() && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) throw new Error(`${field} must use HTTPS`);
  if (url.username || url.password || url.search || url.hash) throw new Error(`${field} cannot contain credentials, query, or fragment`);
  return url;
}

export function parseServiceManifest(value: unknown, expectedOrigin: string): Omit<ServiceConfig, "serviceKey" | "official" | "source"> {
  if (!value || typeof value !== "object") throw new Error("Service configuration must be a JSON object");
  const data = value as Record<string, unknown>;
  if (data.schemaVersion !== 1) throw new Error("Unsupported service configuration version");
  if (typeof data.instanceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.instanceId)) {
    throw new Error("Service instance ID is invalid");
  }
  if (typeof data.displayName !== "string" || !data.displayName.trim() || data.displayName.length > 80) {
    throw new Error("Service display name is invalid");
  }
  const appUrl = secureUrl(data.appUrl, "appUrl");
  if (appUrl.origin !== expectedOrigin) throw new Error("Service appUrl does not match the requested address");
  const supabaseUrl = secureUrl(data.supabaseUrl, "supabaseUrl");
  if (supabaseUrl.pathname !== "/") throw new Error("supabaseUrl must be a service root address");
  const deviceAuthorizationEndpoint = secureUrl(data.deviceAuthorizationEndpoint, "deviceAuthorizationEndpoint");
  if (deviceAuthorizationEndpoint.origin !== supabaseUrl.origin || deviceAuthorizationEndpoint.pathname !== "/functions/v1/cli-device-auth") {
    throw new Error("deviceAuthorizationEndpoint must belong to the Supabase service");
  }
  if (typeof data.publishableKey !== "string" || data.publishableKey.trim().length < 20 || /\s/.test(data.publishableKey)) {
    throw new Error("Supabase publishable key is invalid");
  }
  return {
    schemaVersion: 1,
    instanceId: data.instanceId,
    displayName: data.displayName.trim(),
    appUrl: expectedOrigin,
    supabaseUrl: supabaseUrl.origin,
    publishableKey: data.publishableKey.trim(),
    deviceAuthorizationEndpoint: deviceAuthorizationEndpoint.toString(),
  };
}

function withServiceMetadata(
  config: Omit<ServiceConfig, "serviceKey" | "official" | "source">,
  source: ServiceConfig["source"],
): ServiceConfig {
  return {
    ...config,
    serviceKey: serviceKeyFor(config.appUrl, config.instanceId),
    official: config.appUrl === DEFAULT_APP_URL,
    source,
  };
}

function environmentConfig(): ServiceConfig | null {
  const appUrl = process.env.ANTTODO_APP_URL ?? DEFAULT_APP_URL;
  const supabaseUrl = process.env.ANTTODO_SUPABASE_URL;
  const publishableKey = process.env.ANTTODO_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl && !publishableKey) return null;
  if (Boolean(supabaseUrl) !== Boolean(publishableKey)) {
    throw new CliError({
      type: "configuration",
      code: "incomplete_environment_config",
      message: "ANTTODO_SUPABASE_URL and ANTTODO_SUPABASE_PUBLISHABLE_KEY must be set together",
    });
  }
  try {
    const parsed = publicConfigSchema.parse({
      supabaseUrl,
      publishableKey,
      appUrl,
      deviceAuthorizationEndpoint: process.env.ANTTODO_DEVICE_AUTH_URL
        ?? `${supabaseUrl!.replace(/\/$/, "")}/functions/v1/cli-device-auth`,
    });
    const normalizedAppUrl = parsed.appUrl.replace(/\/$/, "");
    return withServiceMetadata({
      schemaVersion: 1,
      instanceId: serviceKeyFor(normalizedAppUrl),
      displayName: "Environment service",
      appUrl: normalizedAppUrl,
      supabaseUrl: parsed.supabaseUrl.replace(/\/$/, ""),
      publishableKey: parsed.publishableKey,
      deviceAuthorizationEndpoint: parsed.deviceAuthorizationEndpoint,
    }, "environment");
  } catch (error) {
    throw new CliError({
      type: "configuration",
      code: "invalid_environment_config",
      message: "AntTodo environment configuration is invalid",
      details: error instanceof Error ? error.message : undefined,
    });
  }
}

async function fetchServiceConfig(value: string): Promise<ServiceConfig> {
  const origin = normalizeServiceOrigin(value);
  const response = await fetch(`${origin}${INSTANCE_MANIFEST_PATH}`, {
    headers: { accept: "application/json" },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return withServiceMetadata(parseServiceManifest(await response.json(), origin), "network");
}

async function loadFromNetworkOrCache(value: string, persist = false) {
  const origin = normalizeServiceOrigin(value);
  const stored = (await listStoredServices()).find((service) => service.appUrl === origin);
  if (stored) setActiveServiceKey(stored.serviceKey);
  try {
    const config = await fetchServiceConfig(origin);
    setActiveServiceKey(config.serviceKey);
    await cachePublicConfig(config, config.serviceKey);
    if (persist) {
      await saveServiceConfig(config, true);
      await selectServiceKey(config.serviceKey);
    }
    return config;
  } catch (error) {
    if (stored) {
      setActiveServiceKey(stored.serviceKey);
      const cached = await readCachedPublicConfig(stored.serviceKey);
      const config = cached ? { ...stored, ...cached.config, source: "cache" as const } : { ...stored, source: "cache" as const };
      if (persist) await selectServiceKey(config.serviceKey);
      return config;
    }
    throw error;
  }
}

export async function useService(value: string) {
  return loadFromNetworkOrCache(value, true);
}

export async function loadPublicConfig(options: { serviceUrl?: string } = {}): Promise<ServiceConfig> {
  const requested = options.serviceUrl ?? runtimeServiceUrl;
  if (requested) {
    try {
      return await loadFromNetworkOrCache(requested);
    } catch (error) {
      throw new CliError({
        type: "configuration",
        code: "service_config_unavailable",
        message: `Unable to load service configuration from ${requested}`,
        hint: "Check the address and ensure /.well-known/anttodo.json is available",
        details: error instanceof Error ? error.message : undefined,
      });
    }
  }

  const environment = environmentConfig();
  if (environment) {
    setActiveServiceKey(environment.serviceKey);
    return environment;
  }

  const appUrl = process.env.ANTTODO_APP_URL;
  if (appUrl) {
    try {
      return await loadFromNetworkOrCache(appUrl);
    } catch (error) {
      throw new CliError({ type: "configuration", code: "service_config_unavailable", message: `Unable to load service configuration from ${appUrl}`, details: error instanceof Error ? error.message : undefined });
    }
  }

  const selected = await getSelectedServiceKey();
  if (selected) {
    const stored = await getStoredService(selected);
    if (stored) {
      try {
        return await loadFromNetworkOrCache(stored.appUrl);
      } catch {
        setActiveServiceKey(stored.serviceKey);
        const cached = await readCachedPublicConfig(stored.serviceKey);
        if (cached) return { ...stored, ...cached.config, source: "cache" };
        return { ...stored, source: "cache" };
      }
    }
  }

  try {
    return await loadFromNetworkOrCache(DEFAULT_APP_URL);
  } catch (error) {
    setActiveServiceKey("official");
    const cached = await readCachedPublicConfig("official");
    if (cached) {
      return withServiceMetadata({
        schemaVersion: 1,
        instanceId: serviceKeyFor(DEFAULT_APP_URL),
        displayName: "AntTodo 官方服务",
        appUrl: DEFAULT_APP_URL,
        supabaseUrl: cached.config.supabaseUrl,
        publishableKey: cached.config.publishableKey,
        deviceAuthorizationEndpoint: cached.config.deviceAuthorizationEndpoint,
      }, "cache");
    }
    throw new CliError({
      type: "configuration",
      code: "public_config_unavailable",
      message: `Unable to load AntTodo configuration from ${DEFAULT_APP_URL}`,
      hint: "Check your network connection and try again",
      details: error instanceof Error ? error.message : undefined,
    });
  }
}
