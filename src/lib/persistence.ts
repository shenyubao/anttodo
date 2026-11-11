import { del, get, set } from "idb-keyval";
import { dehydrate, type QueryClient } from "@tanstack/react-query";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import { confirmedTaskCreationData } from "./taskCreation";
import { canPersistPermissionQuery, pendingPermissionRefreshes, restorePendingPermissionRefreshes, subscribePermissionRefresh } from "./permissionRefresh";
import type { DehydrateOptions } from "@tanstack/react-query";

export const confirmedQueryDehydrateOptions: DehydrateOptions = {
  shouldDehydrateQuery: (query) => query.state.status === "success" && query.meta?.persist !== false,
  shouldDehydrateMutation: () => false,
};

const indexedDbStorage = {
  getItem: async (key: string) => {
    const value = await get<string>(key);
    return value ?? null;
  },
  setItem: async (key: string, value: string) => {
    await set(key, value);
  },
  removeItem: async (key: string) => {
    await del(key);
  },
};

export function createQueryPersister(namespace = "official", client?: QueryClient) {
  const confirmedClient = (persisted: PersistedClient, includePendingCounts: boolean): PersistedClient => client ? {
    ...persisted,
    clientState: {
      ...persisted.clientState,
      mutations: [],
      queries: persisted.clientState.queries.filter((query) => query.meta?.persist !== false && canPersistPermissionQuery(client, query.queryKey, query.meta)).map((query) => ({
        ...query,
        state: { ...query.state, data: confirmedTaskCreationData(client, query.queryKey, query.state.data, includePendingCounts) },
      })),
    },
  } : persisted;
  const key = namespace === "official"
      ? "ANTTODO_QUERY_CACHE"
      : `ANTTODO_QUERY_CACHE:${namespace}`;
  const markerKey = `${key}:pending-permissions`;
  // This is a cache invalidation marker, never queued business data. It closes
  // the reload window before an asynchronous IDB purge has committed.
  if (client && typeof window !== "undefined") {
    try {
      const pending: unknown = JSON.parse(window.localStorage.getItem(markerKey) ?? "[]");
      if (Array.isArray(pending)) restorePendingPermissionRefreshes(client, pending.filter((value) =>
        value && typeof value.workspaceId === "string" && Array.isArray(value.scopes)
        && value.scopes.length > 0 && value.scopes.every((scope: unknown) => ["workspace", "okr", "weekly"].includes(String(scope)))));
    } catch { /* Storage may be unavailable in embedded/private browsing. */ }
  }
  let latest: PersistedClient | undefined;
  let revision = 0;
  let queued: Promise<void> | undefined;
  const clearVerifiedMarker = () => {
    if (client && typeof window !== "undefined" && !pendingPermissionRefreshes(client).length) {
      try { window.localStorage.removeItem(markerKey); } catch { /* Optional storage. */ }
    }
  };
  // Serialize IDB writes and coalesce snapshots. A previously queued snapshot must
  // never restore data removed by a permission event, even after verification.
  const write = (): Promise<void> => {
    if (!queued) queued = Promise.resolve().then(async () => {
      let written: number;
      do {
        written = revision;
        if (latest) await indexedDbStorage.setItem(key, JSON.stringify(confirmedClient(latest, true)));
        else await indexedDbStorage.removeItem(key);
      } while (written !== revision);
    }).finally(() => { queued = undefined; });
    return queued;
  };
  if (client) subscribePermissionRefresh(client, () => {
    if (typeof window !== "undefined") {
      try {
        const pending = pendingPermissionRefreshes(client);
        if (pending.length) window.localStorage.setItem(markerKey, JSON.stringify(pending));
      } catch { /* The serialized IDB purge still runs when localStorage is unavailable. */ }
    }
    if (!latest) return;
    latest = confirmedClient({ ...latest, timestamp: Date.now(), clientState: dehydrate(client, {
      shouldDehydrateQuery: (query) => query.state.status === "success" && query.meta?.persist !== false,
      shouldDehydrateMutation: () => false,
    }) }, true);
    revision++;
    void write().then(clearVerifiedMarker).catch(() => undefined);
  });
  return {
    persistClient: async (persisted) => {
      latest = confirmedClient(persisted, true);
      revision++;
      await write();
      clearVerifiedMarker();
    },
    restoreClient: async () => {
      if (queued) await queued;
      const value = await indexedDbStorage.getItem(key);
      if (!value) return undefined;
      try {
        latest = confirmedClient(JSON.parse(value) as PersistedClient, false);
        return latest;
      } catch {
        await indexedDbStorage.removeItem(key);
        return undefined;
      }
    },
    removeClient: async () => {
      latest = undefined; revision++; await write();
      // Keep unresolved invalidation markers: signing out must not make an old
      // permission snapshot trusted on a subsequent restore.
    },
  } satisfies Persister;
}
