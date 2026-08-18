import {
  isValidWorkspaceSlug,
  normalizeWorkspaceSlug,
} from "./workspaceSlug";

export const OFFICIAL_APP_URL = "https://app.anttodo.com";
export const INSTANCE_MANIFEST_PATH = "/.well-known/anttodo.json";
export const DEFAULT_BRAND_NAME = "蚂蚁清单";
export const PRODUCT_NAME = "蚂蚁待办";
export const ANTTODO_DEPLOY_MODES = ["saas", "onPremises"] as const;

export type AntTodoDeployMode = (typeof ANTTODO_DEPLOY_MODES)[number];

const SELECTED_SERVICE_KEY = "anttodo:selected-service-origin";
const CACHED_CONFIG_PREFIX = "anttodo:instance-config:";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AntTodoInstanceManifest = {
  schemaVersion: 1;
  instanceId: string;
  displayName: string;
  /** SaaS asks for an enterprise Slug; onPremises reads it from this instance. */
  deployMode: AntTodoDeployMode;
  /** Default enterprise entry to use for this service's SSO login. */
  workspaceSlug?: string;
  appUrl: string;
  supabaseUrl: string;
  publishableKey: string;
  deviceAuthorizationEndpoint: string;
};

export type AntTodoInstanceConfig = AntTodoInstanceManifest & {
  namespace: string;
  official: boolean;
  source: "builtin" | "network" | "cache";
};

let activeInstance: AntTodoInstanceConfig | null = null;

function storage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function isLocalDevelopmentHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function parseDeployMode(value: unknown, fallback: AntTodoDeployMode = "saas"): AntTodoDeployMode {
  if (value === undefined || value === "") return fallback;
  if (value === "saas" || value === "onPremises") return value;
  throw new Error("部署模式无效。");
}

export function isOnPremisesInstance(
  config: Pick<AntTodoInstanceManifest, "deployMode"> | null | undefined,
) {
  return config?.deployMode === "onPremises";
}

function envEnterpriseSlug() {
  return import.meta.env.ANTTODO_INSTANCE_ENTERPRISE_SLUG?.trim()
    || import.meta.env.ANTTODO_WORKSPACE_SLUG?.trim()
    || "";
}

export function normalizeServiceOrigin(value: string, allowLocalHttp = import.meta.env.DEV) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("请输入服务地址。");
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error("服务地址格式无效。");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("服务地址不能包含账号、查询参数或片段。");
  }
  const localHttp = allowLocalHttp && url.protocol === "http:" && isLocalDevelopmentHost(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("自定义服务必须使用 HTTPS。");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("请输入服务根地址，不要包含路径。");
  }
  return url.origin;
}

function secureUrl(value: unknown, field: string, allowLocalHttp: boolean) {
  if (typeof value !== "string") throw new Error(`${field} 缺失。`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} 格式无效。`);
  }
  const localHttp = allowLocalHttp && url.protocol === "http:" && isLocalDevelopmentHost(url.hostname);
  if (url.protocol !== "https:" && !localHttp) throw new Error(`${field} 必须使用 HTTPS。`);
  if (url.username || url.password) throw new Error(`${field} 不能包含账号信息。`);
  if (url.search || url.hash) throw new Error(`${field} 不能包含查询参数或片段。`);
  return url.toString();
}

export function parseInstanceManifest(
  value: unknown,
  expectedOrigin: string,
  allowLocalHttp = import.meta.env.DEV,
): AntTodoInstanceManifest {
  if (!value || typeof value !== "object") throw new Error("服务配置不是有效的 JSON 对象。");
  const data = value as Record<string, unknown>;
  if (data.schemaVersion !== 1) throw new Error("当前客户端不支持此服务配置版本。");
  if (typeof data.instanceId !== "string" || !UUID_PATTERN.test(data.instanceId)) {
    throw new Error("服务实例标识无效。");
  }
  if (typeof data.displayName !== "string" || !data.displayName.trim() || data.displayName.length > 80) {
    throw new Error("服务名称无效。");
  }
  const workspaceSlugInput = data.workspaceSlug ?? data.enterpriseSlug;
  let workspaceSlug: string | undefined;
  if (workspaceSlugInput !== undefined) {
    if (typeof workspaceSlugInput !== "string") {
      throw new Error("企业 Slug 无效。");
    }
    workspaceSlug = normalizeWorkspaceSlug(workspaceSlugInput);
    if (!isValidWorkspaceSlug(workspaceSlug)) {
      throw new Error("企业 Slug 无效。");
    }
  }
  const deployMode = parseDeployMode(
    data.deployMode,
    workspaceSlug ? "onPremises" : "saas",
  );
  if (deployMode === "onPremises" && !workspaceSlug) {
    throw new Error("独立部署必须配置企业 Slug。");
  }
  const appUrl = secureUrl(data.appUrl, "appUrl", allowLocalHttp);
  if (new URL(appUrl).origin !== expectedOrigin) {
    throw new Error("服务配置中的 appUrl 与输入地址不一致。");
  }
  const supabaseUrlObject = new URL(secureUrl(data.supabaseUrl, "supabaseUrl", allowLocalHttp));
  if (supabaseUrlObject.pathname !== "/") throw new Error("supabaseUrl 必须是服务根地址。");
  const supabaseUrl = supabaseUrlObject.origin;
  const deviceAuthorizationEndpoint = secureUrl(
    data.deviceAuthorizationEndpoint,
    "deviceAuthorizationEndpoint",
    allowLocalHttp,
  );
  const deviceAuthorizationUrl = new URL(deviceAuthorizationEndpoint);
  if (
    deviceAuthorizationUrl.origin !== supabaseUrlObject.origin ||
    deviceAuthorizationUrl.pathname !== "/functions/v1/cli-device-auth"
  ) {
    throw new Error("deviceAuthorizationEndpoint 必须属于当前 Supabase 实例。");
  }
  if (typeof data.publishableKey !== "string" || data.publishableKey.trim().length < 20) {
    throw new Error("Supabase publishable key 无效。");
  }
  return {
    schemaVersion: 1,
    instanceId: data.instanceId,
    displayName: data.displayName.trim(),
    deployMode,
    ...(workspaceSlug ? { workspaceSlug } : {}),
    appUrl: expectedOrigin,
    supabaseUrl,
    publishableKey: data.publishableKey.trim(),
    deviceAuthorizationEndpoint: deviceAuthorizationUrl.toString(),
  };
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function withNamespace(
  manifest: AntTodoInstanceManifest,
  source: AntTodoInstanceConfig["source"],
): Promise<AntTodoInstanceConfig> {
  const origin = new URL(manifest.appUrl).origin;
  return {
    ...manifest,
    namespace: (await sha256(`${origin}\n${manifest.instanceId}`)).slice(0, 32),
    official: origin === OFFICIAL_APP_URL,
    source,
  };
}

function builtInOfficialConfig(): AntTodoInstanceConfig | null {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  const appUrl = import.meta.env.VITE_PUBLIC_APP_URL?.trim() || OFFICIAL_APP_URL;
  if (!supabaseUrl || !publishableKey) return null;
  const workspaceSlug = envEnterpriseSlug();
  const displayName = import.meta.env.ANTTODO_INSTANCE_DISPLAY_NAME?.trim() || "AntTodo 官方服务";
  return {
    schemaVersion: 1,
    instanceId: "00000000-0000-4000-8000-000000000001",
    displayName,
    deployMode: parseDeployMode(import.meta.env.ANTTODO_DEPLOY_MODE),
    ...(workspaceSlug && isValidWorkspaceSlug(workspaceSlug)
      ? { workspaceSlug: normalizeWorkspaceSlug(workspaceSlug) }
      : {}),
    appUrl: new URL(appUrl).origin,
    supabaseUrl: supabaseUrl.replace(/\/$/, ""),
    publishableKey,
    deviceAuthorizationEndpoint: `${supabaseUrl.replace(/\/$/, "")}/functions/v1/cli-device-auth`,
    namespace: "official",
    official: true,
    source: "builtin",
  };
}

export async function fetchInstanceConfig(
  value: string,
  options: { signal?: AbortSignal; allowLocalHttp?: boolean } = {},
) {
  const allowLocalHttp = options.allowLocalHttp ?? import.meta.env.DEV;
  const origin = normalizeServiceOrigin(value, allowLocalHttp);
  const timeout = AbortSignal.timeout(10_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  const response = await fetch(`${origin}${INSTANCE_MANIFEST_PATH}`, {
    headers: { accept: "application/json" },
    redirect: "error",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`无法读取服务配置（HTTP ${response.status}）。`);
  const manifest = parseInstanceManifest(await response.json(), origin, allowLocalHttp);
  return withNamespace(manifest, "network");
}

function cacheKey(origin: string) {
  return `${CACHED_CONFIG_PREFIX}${origin}`;
}

function readCachedConfig(origin: string): AntTodoInstanceManifest | null {
  const raw = storage()?.getItem(cacheKey(origin));
  if (!raw) return null;
  try {
    return parseInstanceManifest(JSON.parse(raw), origin);
  } catch {
    storage()?.removeItem(cacheKey(origin));
    return null;
  }
}

/**
 * Return every previously verified custom service that is still present in
 * the local manifest cache. The cache is intentionally limited to public
 * instance configuration and is safe to use for the desktop login picker.
 */
export function rememberedInstanceConfigs() {
  const local = storage();
  if (!local) return [] as AntTodoInstanceManifest[];
  const configs: AntTodoInstanceManifest[] = [];
  const keys = Array.from({ length: local.length }, (_, index) => local.key(index));
  for (const key of keys) {
    if (!key?.startsWith(CACHED_CONFIG_PREFIX)) continue;
    const origin = key.slice(CACHED_CONFIG_PREFIX.length);
    const config = readCachedConfig(origin);
    if (config && origin !== OFFICIAL_APP_URL) configs.push(config);
  }
  return configs.sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN"));
}

export async function selectCustomService(value: string) {
  const config = await fetchInstanceConfig(value);
  storage()?.setItem(cacheKey(config.appUrl), JSON.stringify({
    schemaVersion: config.schemaVersion,
    instanceId: config.instanceId,
    displayName: config.displayName,
    deployMode: config.deployMode,
      workspaceSlug: config.workspaceSlug,
    appUrl: config.appUrl,
    supabaseUrl: config.supabaseUrl,
    publishableKey: config.publishableKey,
    deviceAuthorizationEndpoint: config.deviceAuthorizationEndpoint,
  } satisfies AntTodoInstanceManifest));
  storage()?.removeItem(authStorageKey(config));
  storage()?.setItem(SELECTED_SERVICE_KEY, config.appUrl);
  return config;
}

export function restoreOfficialService() {
  storage()?.removeItem(SELECTED_SERVICE_KEY);
}

export function selectedServiceOrigin() {
  return storage()?.getItem(SELECTED_SERVICE_KEY) ?? OFFICIAL_APP_URL;
}

async function loadSelectedDesktopConfig() {
  const selected = storage()?.getItem(SELECTED_SERVICE_KEY);
  if (!selected || selected === OFFICIAL_APP_URL) return builtInOfficialConfig();
  const origin = normalizeServiceOrigin(selected);
  try {
    return await fetchInstanceConfig(origin);
  } catch (error) {
    const cached = readCachedConfig(origin);
    if (!cached) throw error;
    return withNamespace(cached, "cache");
  }
}

async function loadWebConfig() {
  const builtIn = builtInOfficialConfig();
  if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return builtIn;
  try {
    return await fetchInstanceConfig(window.location.origin, {
      allowLocalHttp: import.meta.env.DEV,
    });
  } catch (error) {
    if (builtIn) return builtIn;
    throw error;
  }
}

export async function bootstrapInstanceConfig() {
  const config = window.anttodoDesktop
    ? await loadSelectedDesktopConfig()
    : await loadWebConfig();
  activeInstance = config;
  return config;
}

export function setActiveInstanceConfig(config: AntTodoInstanceConfig | null) {
  activeInstance = config;
}

export function currentInstanceConfig() {
  return activeInstance;
}

export function currentBrandName(config = activeInstance) {
  return config?.displayName?.trim()
    || import.meta.env.ANTTODO_INSTANCE_DISPLAY_NAME?.trim()
    || DEFAULT_BRAND_NAME;
}

export function currentAuthBrandTitle(brandName?: string, config = activeInstance) {
  const official = brandName === undefined && (config?.official ?? true);
  const name = (brandName ?? currentBrandName(config)).trim();
  if (official || !name || name === PRODUCT_NAME) return PRODUCT_NAME;
  return `${PRODUCT_NAME} x ${name}`;
}

export function loginWelcomeTitle(serviceChoice: string, config = activeInstance) {
  if (serviceChoice === "official" || serviceChoice === "custom") return PRODUCT_NAME;
  return currentAuthBrandTitle(undefined, config);
}

export function currentAppUrl() {
  return activeInstance?.appUrl ?? import.meta.env.VITE_PUBLIC_APP_URL ?? OFFICIAL_APP_URL;
}

export function currentInstanceNamespace() {
  return activeInstance?.namespace ?? "official";
}

export function authStorageKey(config: AntTodoInstanceConfig) {
  return `anttodo-${config.namespace}-auth-token`;
}

export function instanceStorageKey(key: string, namespace = currentInstanceNamespace()) {
  return namespace === "official" ? key : `${key}:${namespace}`;
}
