import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { SupportedStorage } from "@supabase/supabase-js";
import type { CliCredential, PendingAuthorization, PublicConfig, ServiceConfig } from "./types.js";

function stateDirectory() {
  if (process.env.ANTTODO_STATE_DIR) return process.env.ANTTODO_STATE_DIR;
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "anttodo-cli");
  if (platform() === "win32") return join(process.env.APPDATA ?? homedir(), "anttodo-cli");
  return join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "anttodo-cli");
}

export const STATE_DIR = stateDirectory();
const SERVICES_FILE = join(STATE_DIR, "services.json");
let activeServiceKey: string | undefined;

type StoredService = ServiceConfig & { lastVerifiedAt: string };
type ServiceRegistry = {
  selectedServiceKey?: string;
  services?: Record<string, StoredService>;
};

export function serviceKeyFor(appUrl: string, instanceId = "legacy") {
  if (appUrl === "https://app.anttodo.com") return "official";
  return createHash("sha256").update(`${appUrl}\n${instanceId}`).digest("hex").slice(0, 32);
}

export function setActiveServiceKey(serviceKey: string) {
  activeServiceKey = serviceKey;
}

export function getActiveServiceKey() {
  return activeServiceKey;
}

function serviceDirectory(serviceKey = activeServiceKey) {
  return serviceKey && serviceKey !== "official"
    ? join(STATE_DIR, "services", serviceKey)
    : STATE_DIR;
}

export function storageFile(name: string, serviceKey = activeServiceKey) {
  return join(serviceDirectory(serviceKey), name);
}

async function ensureDirectory(path = STATE_DIR) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (platform() !== "win32") await chmod(path, 0o700);
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function atomicWrite(path: string, value: unknown) {
  await ensureDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  if (platform() !== "win32") await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export async function readServiceRegistry() {
  const registry = await readJson<ServiceRegistry>(SERVICES_FILE, {});
  return {
    selectedServiceKey: registry.selectedServiceKey,
    services: registry.services ?? {},
  };
}

async function writeServiceRegistry(registry: ServiceRegistry) {
  await atomicWrite(SERVICES_FILE, {
    selectedServiceKey: registry.selectedServiceKey,
    services: registry.services ?? {},
  });
}

export async function saveServiceConfig(config: ServiceConfig, select = false) {
  const registry = await readServiceRegistry();
  registry.services[config.serviceKey] = {
    ...config,
    lastVerifiedAt: new Date().toISOString(),
  };
  if (select) registry.selectedServiceKey = config.serviceKey;
  await writeServiceRegistry(registry);
}

export async function selectServiceKey(serviceKey: string) {
  const registry = await readServiceRegistry();
  if (serviceKey !== "official" && !registry.services[serviceKey]) return false;
  registry.selectedServiceKey = serviceKey === "official" ? undefined : serviceKey;
  await writeServiceRegistry(registry);
  return true;
}

export async function getSelectedServiceKey() {
  return (await readServiceRegistry()).selectedServiceKey;
}

export async function listStoredServices() {
  return Object.values((await readServiceRegistry()).services);
}

export async function getStoredService(serviceKey: string) {
  return (await readServiceRegistry()).services[serviceKey] ?? null;
}

export class FileAuthStorage implements SupportedStorage {
  private readonly path: string;

  constructor(serviceKey = activeServiceKey) {
    this.path = storageFile("auth.json", serviceKey);
  }

  async getItem(key: string) {
    const data = await readJson<Record<string, string>>(this.path, {});
    return data[key] ?? null;
  }

  async setItem(key: string, value: string) {
    const data = await readJson<Record<string, string>>(this.path, {});
    data[key] = value;
    await atomicWrite(this.path, data);
  }

  async removeItem(key: string) {
    const data = await readJson<Record<string, string>>(this.path, {});
    delete data[key];
    if (Object.keys(data).length) await atomicWrite(this.path, data);
    else await unlink(this.path).catch(() => undefined);
  }
}

export async function readCliCredential(serviceKey = activeServiceKey) {
  const value = await readJson<unknown>(storageFile("auth.json", serviceKey), null);
  if (!value || typeof value !== "object") return { credential: null, legacy: false };
  const candidate = value as Partial<CliCredential>;
  if (candidate.schemaVersion !== 2) return { credential: null, legacy: true };
  if (typeof candidate.deviceId !== "string" || typeof candidate.secret !== "string"
    || !candidate.user || typeof candidate.user.id !== "string") {
    return { credential: null, legacy: false };
  }
  return { credential: candidate as CliCredential, legacy: false };
}

export async function saveCliCredential(credential: CliCredential, serviceKey = activeServiceKey) {
  await atomicWrite(storageFile("auth.json", serviceKey), credential);
}

export async function updateCliAccessToken(
  accessToken: string,
  accessTokenExpiresAt: string,
  serviceKey = activeServiceKey,
) {
  const { credential } = await readCliCredential(serviceKey);
  if (!credential) return;
  await saveCliCredential({ ...credential, accessToken, accessTokenExpiresAt }, serviceKey);
}

export async function clearAuthStorage(serviceKey = activeServiceKey) {
  await unlink(storageFile("auth.json", serviceKey)).catch(() => undefined);
}

type Settings = { workspaceByUser?: Record<string, string> };

export async function getDefaultWorkspace(userId: string, serviceKey = activeServiceKey) {
  const settings = await readJson<Settings>(storageFile("settings.json", serviceKey), {});
  return settings.workspaceByUser?.[userId] ?? null;
}

export async function setDefaultWorkspace(userId: string, workspaceId: string, serviceKey = activeServiceKey) {
  const path = storageFile("settings.json", serviceKey);
  const settings = await readJson<Settings>(path, {});
  await atomicWrite(path, {
    ...settings,
    workspaceByUser: { ...settings.workspaceByUser, [userId]: workspaceId },
  });
}

export async function clearWorkspaceSettings(serviceKey = activeServiceKey) {
  await unlink(storageFile("settings.json", serviceKey)).catch(() => undefined);
}

export async function clearCache(serviceKey = activeServiceKey) {
  await unlink(storageFile("cache.json", serviceKey)).catch(() => undefined);
}

export async function savePendingAuthorization(pending: PendingAuthorization) {
  const path = storageFile("pending-authorizations.json", pending.serviceKey);
  const all = await readJson<Record<string, PendingAuthorization>>(path, {});
  all[pending.deviceCode] = pending;
  await atomicWrite(path, all);
}

export async function loadPendingAuthorization(deviceCode: string, serviceKey?: string) {
  const discoveredServiceKeys = serviceKey ? [] : await readdir(join(STATE_DIR, "services"), { withFileTypes: true })
    .then((entries) => entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name))
    .catch(() => [] as string[]);
  const keys = serviceKey
    ? [serviceKey]
    : ["official", ...(await listStoredServices()).map((service) => service.serviceKey), ...discoveredServiceKeys];
  for (const key of [...new Set(keys)]) {
    const all = await readJson<Record<string, PendingAuthorization>>(storageFile("pending-authorizations.json", key), {});
    if (all[deviceCode]) return all[deviceCode];
  }
  return null;
}

export async function removePendingAuthorization(deviceCode: string, serviceKey = activeServiceKey) {
  const path = storageFile("pending-authorizations.json", serviceKey);
  const all = await readJson<Record<string, PendingAuthorization>>(path, {});
  delete all[deviceCode];
  if (Object.keys(all).length) await atomicWrite(path, all);
  else await unlink(path).catch(() => undefined);
}

export async function clearPendingAuthorizations(serviceKey = activeServiceKey) {
  await unlink(storageFile("pending-authorizations.json", serviceKey)).catch(() => undefined);
}

export async function readCachedPublicConfig(serviceKey = activeServiceKey) {
  return readJson<{ config: PublicConfig; cachedAt: string } | null>(storageFile("public-config.json", serviceKey), null);
}

export async function cachePublicConfig(config: PublicConfig, serviceKey = activeServiceKey) {
  await atomicWrite(storageFile("public-config.json", serviceKey), {
    config,
    cachedAt: new Date().toISOString(),
  });
}

export async function authFileMode(serviceKey = activeServiceKey) {
  const path = storageFile("auth.json", serviceKey);
  await access(path, constants.F_OK);
  const { stat } = await import("node:fs/promises");
  return (await stat(path)).mode & 0o777;
}
