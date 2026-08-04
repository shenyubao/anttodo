import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import type { SupportedStorage } from "@supabase/supabase-js";
import type { PendingAuthorization, PublicConfig } from "./types.js";

function stateDirectory() {
  if (process.env.ANTTODO_STATE_DIR) return process.env.ANTTODO_STATE_DIR;
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "anttodo-cli");
  if (platform() === "win32") return join(process.env.APPDATA ?? homedir(), "anttodo-cli");
  return join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "anttodo-cli");
}

export const STATE_DIR = stateDirectory();
const AUTH_FILE = join(STATE_DIR, "auth.json");
const SETTINGS_FILE = join(STATE_DIR, "settings.json");
const PENDING_FILE = join(STATE_DIR, "pending-authorizations.json");
const PUBLIC_CONFIG_FILE = join(STATE_DIR, "public-config.json");

async function ensureStateDirectory() {
  await mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  if (platform() !== "win32") await chmod(STATE_DIR, 0o700);
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function atomicWrite(path: string, value: unknown) {
  await ensureStateDirectory();
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  if (platform() !== "win32") await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export class FileAuthStorage implements SupportedStorage {
  async getItem(key: string) {
    const data = await readJson<Record<string, string>>(AUTH_FILE, {});
    return data[key] ?? null;
  }

  async setItem(key: string, value: string) {
    const data = await readJson<Record<string, string>>(AUTH_FILE, {});
    data[key] = value;
    await atomicWrite(AUTH_FILE, data);
  }

  async removeItem(key: string) {
    const data = await readJson<Record<string, string>>(AUTH_FILE, {});
    delete data[key];
    if (Object.keys(data).length) await atomicWrite(AUTH_FILE, data);
    else await unlink(AUTH_FILE).catch(() => undefined);
  }
}

export async function clearAuthStorage() {
  await unlink(AUTH_FILE).catch(() => undefined);
}

type Settings = { workspaceByUser?: Record<string, string> };

export async function getDefaultWorkspace(userId: string) {
  const settings = await readJson<Settings>(SETTINGS_FILE, {});
  return settings.workspaceByUser?.[userId] ?? null;
}

export async function setDefaultWorkspace(userId: string, workspaceId: string) {
  const settings = await readJson<Settings>(SETTINGS_FILE, {});
  await atomicWrite(SETTINGS_FILE, {
    ...settings,
    workspaceByUser: { ...settings.workspaceByUser, [userId]: workspaceId },
  });
}

export async function clearWorkspaceSettings() {
  await unlink(SETTINGS_FILE).catch(() => undefined);
}

export async function savePendingAuthorization(pending: PendingAuthorization) {
  const all = await readJson<Record<string, PendingAuthorization>>(PENDING_FILE, {});
  all[pending.deviceCode] = pending;
  await atomicWrite(PENDING_FILE, all);
}

export async function loadPendingAuthorization(deviceCode: string) {
  const all = await readJson<Record<string, PendingAuthorization>>(PENDING_FILE, {});
  return all[deviceCode] ?? null;
}

export async function removePendingAuthorization(deviceCode: string) {
  const all = await readJson<Record<string, PendingAuthorization>>(PENDING_FILE, {});
  delete all[deviceCode];
  if (Object.keys(all).length) await atomicWrite(PENDING_FILE, all);
  else await unlink(PENDING_FILE).catch(() => undefined);
}

export async function clearPendingAuthorizations() {
  await unlink(PENDING_FILE).catch(() => undefined);
}

export async function readCachedPublicConfig() {
  return readJson<{ config: PublicConfig; cachedAt: string } | null>(PUBLIC_CONFIG_FILE, null);
}

export async function cachePublicConfig(config: PublicConfig) {
  await atomicWrite(PUBLIC_CONFIG_FILE, { config, cachedAt: new Date().toISOString() });
}

export async function authFileMode() {
  await access(AUTH_FILE, constants.F_OK);
  const { stat } = await import("node:fs/promises");
  return (await stat(AUTH_FILE)).mode & 0o777;
}
