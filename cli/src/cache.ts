import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { atomicWrite, CACHE_FILE, readJson } from "./storage.js";
import type { TaskPriority, TaskStatus } from "./types.js";

export const CACHE_FRESH_MS = 30_000;
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CACHE_VERSION = 1;
const MAX_CACHE_ENTRIES = 100;

type CacheEntry = {
  cachedAt: string;
  value: unknown;
};

type CacheFile = {
  version: typeof CACHE_VERSION;
  entries: Record<string, CacheEntry>;
};

export type TaskListCacheOptions = {
  status?: TaskStatus | "all";
  priority?: TaskPriority;
  assignee?: string;
  tag?: string;
  search?: string;
  trash?: boolean;
  includeTrash?: boolean;
  limit: number;
  offset: number;
};

export type CacheRefreshRequest =
  | { type: "workspaces"; userId: string }
  | {
      type: "task-list";
      userId: string;
      workspaceId: string;
      taskKind: "todo" | "note";
      options: TaskListCacheOptions;
    }
  | {
      type: "task";
      userId: string;
      workspaceId: string;
      taskKind: "todo" | "note";
      taskId: string;
    };

export type CacheReadOptions = {
  userId: string;
  refresh: CacheRefreshRequest;
};

function emptyCache(): CacheFile {
  return { version: CACHE_VERSION, entries: {} };
}

async function loadCache(): Promise<CacheFile> {
  const value = await readJson<unknown>(CACHE_FILE, null);
  if (!value || typeof value !== "object") return emptyCache();
  const candidate = value as Partial<CacheFile>;
  if (candidate.version !== CACHE_VERSION || !candidate.entries || typeof candidate.entries !== "object") {
    return emptyCache();
  }
  return {
    version: CACHE_VERSION,
    entries: candidate.entries as Record<string, CacheEntry>,
  };
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

export function workspaceCacheKey(userId: string) {
  return `workspaces:${userId}`;
}

export function taskListCacheKey(
  userId: string,
  workspaceId: string,
  taskKind: "todo" | "note",
  options: TaskListCacheOptions,
) {
  return `tasks:${userId}:${workspaceId}:list:${taskKind}:${hash(options)}`;
}

export function taskCacheKey(
  userId: string,
  workspaceId: string,
  taskKind: "todo" | "note",
  taskId: string,
) {
  return `tasks:${userId}:${workspaceId}:item:${taskKind}:${taskId}`;
}

export async function writeCacheEntry(key: string, value: unknown) {
  const cache = await loadCache();
  cache.entries[key] = { cachedAt: new Date().toISOString(), value };
  const entries = Object.entries(cache.entries)
    .sort(([, left], [, right]) => Date.parse(right.cachedAt) - Date.parse(left.cachedAt))
    .slice(0, MAX_CACHE_ENTRIES);
  await atomicWrite(CACHE_FILE, {
    version: CACHE_VERSION,
    entries: Object.fromEntries(entries),
  } satisfies CacheFile);
}

export async function invalidateCache(prefixes: string[]) {
  if (!prefixes.length) return;
  const cache = await loadCache();
  const entries = Object.fromEntries(
    Object.entries(cache.entries).filter(([key]) => !prefixes.some((prefix) => key.startsWith(prefix))),
  );
  if (Object.keys(entries).length === Object.keys(cache.entries).length) return;
  await atomicWrite(CACHE_FILE, { version: CACHE_VERSION, entries } satisfies CacheFile);
}

export async function invalidateTaskCachesForWorkspace(workspaceId: string) {
  const cache = await loadCache();
  const marker = `:${workspaceId}:`;
  const entries = Object.fromEntries(
    Object.entries(cache.entries).filter(([key]) => !(key.startsWith("tasks:") && key.includes(marker))),
  );
  if (Object.keys(entries).length === Object.keys(cache.entries).length) return;
  await atomicWrite(CACHE_FILE, { version: CACHE_VERSION, entries } satisfies CacheFile);
}

export async function invalidateWorkspaceListCaches() {
  await invalidateCache(["workspaces:"]);
}

export function taskWorkspaceCachePrefix(userId: string, workspaceId: string) {
  return `tasks:${userId}:${workspaceId}:`;
}

function startBackgroundRefresh(request: CacheRefreshRequest) {
  const entrypoint = process.argv[1];
  if (!entrypoint) return;
  const encoded = Buffer.from(JSON.stringify(request), "utf8").toString("base64url");
  try {
    const child = spawn(process.execPath, [entrypoint, "--_cache-refresh", encoded], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ANTTODO_CACHE_REFRESH: "1" },
    });
    child.unref();
  } catch {
    // Cache refresh is best effort and must never delay or fail the read command.
  }
}

export async function readThroughCache<T>(
  key: string,
  options: CacheReadOptions,
  fetchValue: () => Promise<T>,
): Promise<T> {
  const cache = await loadCache();
  const entry = cache.entries[key];
  if (!entry || !entry.cachedAt) {
    const value = await fetchValue();
    await writeCacheEntry(key, value).catch(() => undefined);
    return value;
  }

  const age = Date.now() - Date.parse(entry.cachedAt);
  if (!Number.isFinite(age) || age > CACHE_MAX_AGE_MS) {
    try {
      const value = await fetchValue();
      await writeCacheEntry(key, value).catch(() => undefined);
      return value;
    } catch (error) {
      return entry.value as T;
    }
  }

  if (age > CACHE_FRESH_MS) startBackgroundRefresh(options.refresh);
  return entry.value as T;
}

export async function readCacheEntry<T>(key: string) {
  const cache = await loadCache();
  return cache.entries[key]?.value as T | undefined;
}
