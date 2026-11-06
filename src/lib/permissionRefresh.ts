import { CancelledError, isCancelledError, type Query, type QueryClient, type QueryKey } from "@tanstack/react-query";
import type { WorkspaceBundle } from "../types";

export type PermissionScope = "workspace" | "okr" | "weekly";
export type PermissionRefreshStatus = "ready" | "pending" | "error";
type Entry = {
  status: PermissionRefreshStatus;
  scopes: Set<PermissionScope>;
  dirty: boolean;
  running: boolean;
  timer?: ReturnType<typeof setTimeout>;
  mutations: number;
  revision: number;
  listeners: Set<() => void>;
};
type State = { entries: Map<string, Entry>; listeners: Set<() => void> };
const states = new WeakMap<QueryClient, State>();
function stateFor(client: QueryClient): State {
  let state = states.get(client);
  if (!state) { state = { entries: new Map(), listeners: new Set() }; states.set(client, state); }
  return state;
}
function entryFor(client: QueryClient, workspaceId: string): Entry {
  const state = stateFor(client);
  let entry = state.entries.get(workspaceId);
  if (!entry) {
    entry = { status: "ready", scopes: new Set(), dirty: false, running: false, mutations: 0, revision: 0, listeners: new Set() };
    state.entries.set(workspaceId, entry);
  }
  return entry;
}
function notify(client: QueryClient, entry: Entry) {
  entry.listeners.forEach((listener) => listener());
  stateFor(client).listeners.forEach((listener) => listener());
}
export function subscribePermissionRefresh(client: QueryClient, listener: () => void, workspaceId?: string) {
  const listeners = workspaceId ? entryFor(client, workspaceId).listeners : stateFor(client).listeners;
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function pendingPermissionRefreshes(client: QueryClient) {
  return [...stateFor(client).entries].filter(([, entry]) => entry.status !== "ready")
    .map(([workspaceId, entry]) => ({ workspaceId, scopes: [...entry.scopes] }));
}
export function restorePendingPermissionRefreshes(client: QueryClient, pending: ReturnType<typeof pendingPermissionRefreshes>) {
  for (const { workspaceId, scopes } of pending) {
    const entry = entryFor(client, workspaceId);
    scopes.forEach((scope) => entry.scopes.add(scope));
    entry.status = "pending";
  }
}
export function permissionRefreshStatus(client: QueryClient, workspaceId: string, scope?: PermissionScope): PermissionRefreshStatus {
  const entry = entryFor(client, workspaceId);
  return scope && !entry.scopes.has("workspace") && !entry.scopes.has(scope) ? "ready" : entry.status;
}
export function assertPermissionReady(client: QueryClient, workspaceId: string, scope?: PermissionScope) {
  if (permissionRefreshStatus(client, workspaceId, scope) !== "ready") {
    throw new Error("权限正在重新核对，请稍后重试。");
  }
}

const scopedPrefixes = new Set([
  "workspace-bundle", "notifications", "my-active-okr-tree", "task-okr-link", "task-okr-link-ids",
]);
export function permissionQueryScope(key: QueryKey): PermissionScope | undefined {
  const prefix = String(key[0]);
  if (prefix === "okr-display-v2") return undefined;
  if (prefix.startsWith("weekly-report")) return "weekly";
  if (prefix.startsWith("okr-") || prefix === "my-active-okr-tree" || prefix.startsWith("task-okr-link")) return "okr";
  if (scopedPrefixes.has(prefix)) return "workspace";
  return undefined;
}

/** ID-only queries declare meta.workspaceId so inactive detail caches are covered too. */
export function permissionQueryMatches(key: QueryKey, meta: Record<string, unknown> | undefined, workspaceId: string) {
  return Boolean(permissionQueryScope(key)) && (meta?.workspaceId === workspaceId || key.includes(workspaceId));
}
function legacyDetailQuery(key: QueryKey, meta?: Record<string, unknown>) {
  return !meta?.workspaceId && ["okr-versions", "okr-progress-records", "okr-progress-counts", "task-okr-link", "task-okr-link-ids"].includes(String(key[0]));
}
export function canPersistPermissionQuery(client: QueryClient, key: QueryKey, meta?: Record<string, unknown>) {
  const scope = permissionQueryScope(key);
  if (!scope) return true;
  for (const [workspaceId, entry] of stateFor(client).entries) {
    // Older builds did not scope these detail queries. Discard their snapshots
    // conservatively; workspace-scoped caches and preferences stay intact.
    if (entry.status !== "ready" && (legacyDetailQuery(key, meta) || permissionQueryMatches(key, meta, workspaceId))
      && includesScope(entry.scopes, key)) return false;
  }
  return true;
}

function includesScope(scopes: Set<PermissionScope>, key: QueryKey) {
  return scopes.has("workspace") || scopes.has(permissionQueryScope(key)!)
    || (key[0] === "weekly-report-okr" && scopes.has("okr"));
}

function denied(error: unknown) {
  const value = error as { code?: string; status?: number } | null;
  return value?.code === "42501" || value?.status === 403 || value?.status === 404;
}
async function verifyQuery(client: QueryClient, query: Query) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("网络连接不可用");
  // A request started before the commit cannot verify the new permissions.
  if (query.promise && query.state.fetchStatus !== "idle") await query.promise.catch(() => undefined);
  if (!query.isActive()) {
    query.setState({ data: undefined, status: "pending", error: null });
    client.removeQueries({ queryKey: query.queryKey, exact: true });
    return;
  }
  try {
    // Fetch directly so a cancelled/paused refetch is never reported as success.
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("网络连接不可用");
    let confirmed = false;
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.query === query && event.type === "updated" && event.action.type === "success" && !event.action.manual) confirmed = true;
    });
    try { await query.fetch(undefined, { cancelRefetch: false }); }
    finally { unsubscribe(); }
    // cancelQueries({ revert: true }) resolves with previous data in this Query
    // version. Resolution alone does not prove that a server read succeeded.
    if (!confirmed || query.state.fetchStatus !== "idle") throw new CancelledError();
  } catch (error) {
    if (denied(error)) {
      query.setState({ data: undefined, status: "error", error: error as Error });
      return;
    }
    throw error;
  }
}

async function flush(client: QueryClient, workspaceId: string) {
  const entry = entryFor(client, workspaceId);
  entry.timer = undefined;
  if (entry.running || !entry.dirty) return;
  if (entry.mutations) { schedule(client, workspaceId); return; }
  entry.running = true;
  entry.dirty = false;
  const scopes = new Set(entry.scopes);
  const started = performance.now();
  const results = await Promise.allSettled(client.getQueryCache().findAll({
    predicate: (query) => (permissionQueryMatches(query.queryKey, query.meta, workspaceId) || legacyDetailQuery(query.queryKey, query.meta))
      && includesScope(scopes, query.queryKey),
  }).map((query) => verifyQuery(client, query)));
  entry.running = false;
  const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  if (entry.dirty || errors.some(isCancelledError)) {
    entry.dirty = true;
    schedule(client, workspaceId);
    return;
  }
  entry.status = errors.length ? "error" : "ready";
  if (!errors.length) entry.scopes.clear();
  // Aggregate duration only, never member identities or permission payloads.
  performance.measure("anttodo.permission-refresh", { start: started, detail: { outcome: entry.status } });
  notify(client, entry);
}
function schedule(client: QueryClient, workspaceId: string) {
  const entry = entryFor(client, workspaceId);
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => { void flush(client, workspaceId); }, 150);
}
export function requestPermissionRefresh(client: QueryClient, workspaceId: string, scope: PermissionScope = "workspace") {
  const entry = entryFor(client, workspaceId);
  entry.scopes.add(scope);
  entry.status = "pending";
  entry.dirty = true;
  notify(client, entry);
  schedule(client, workspaceId);
}
export function retryPermissionRefresh(client: QueryClient, workspaceId: string) {
  const entry = entryFor(client, workspaceId);
  if (entry.status !== "ready") requestPermissionRefresh(client, workspaceId, [...entry.scopes][0] ?? "workspace");
}

/** Hold verification until the transaction's response has updated the local cache. */
export function beginUserGroupSave(client: QueryClient, workspaceId: string) {
  const entry = entryFor(client, workspaceId);
  entry.mutations++;
  entry.revision++;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    entry.mutations--;
    entry.revision++;
    notify(client, entry);
    if (entry.dirty) schedule(client, workspaceId);
  };
}

/** Also protects focus/Realtime reads that race a user-group transaction. */
export async function readAfterUserGroupSaves<T>(client: QueryClient, workspaceId: string, read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const entry = entryFor(client, workspaceId);
  for (;;) {
    if (signal?.aborted) throw signal.reason;
    if (entry.mutations) await new Promise<void>((resolve, reject) => {
      const cleanup = () => { entry.listeners.delete(check); signal?.removeEventListener("abort", abort); };
      const check = () => { if (!entry.mutations) { cleanup(); resolve(); } };
      const abort = () => { cleanup(); reject(signal?.reason); };
      entry.listeners.add(check);
      signal?.addEventListener("abort", abort, { once: true });
      check();
    });
    if (signal?.aborted) throw signal.reason;
    const revision = entry.revision;
    const result = await read();
    if (signal?.aborted) throw signal.reason;
    if (revision === entry.revision) return result;
  }
}

// Lightweight refresh for remote renames; no task/connector/permission reads.
const groupReads = new WeakMap<QueryClient, Map<string, { timer?: ReturnType<typeof setTimeout>; running: boolean; dirty: boolean; read: () => Promise<WorkspaceBundle["userGroups"]> }>>();
export function requestUserGroupsRefresh(client: QueryClient, workspaceId: string, read: () => Promise<WorkspaceBundle["userGroups"]>) {
  let entries = groupReads.get(client);
  if (!entries) { entries = new Map(); groupReads.set(client, entries); }
  let entry = entries.get(workspaceId);
  if (!entry) { entry = { running: false, dirty: false, read }; entries.set(workspaceId, entry); }
  entry.read = read;
  entry.dirty = true;
  if (entry.timer) clearTimeout(entry.timer);
  const flushGroups = async () => {
    entry!.timer = undefined;
    if (entry!.running || !entry!.dirty) return;
    if (entryFor(client, workspaceId).mutations) { entry!.timer = setTimeout(() => { void flushGroups(); }, 150); return; }
    entry!.running = true;
    entry!.dirty = false;
    try {
      const groups = await readAfterUserGroupSaves(client, workspaceId, () => entry!.read());
      client.setQueryData<WorkspaceBundle>(["workspace-bundle", workspaceId], (bundle) => bundle ? { ...bundle, userGroups: groups } : bundle);
    } catch {
      // Leave confirmed names intact. A later Realtime/reconnect event retries the read.
    } finally {
      entry!.running = false;
      if (entry!.dirty) entry!.timer = setTimeout(() => { void flushGroups(); }, 150);
    }
  };
  entry.timer = setTimeout(() => { void flushGroups(); }, 150);
}
