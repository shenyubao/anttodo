import { del, get, set } from "idb-keyval";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { QueryClient } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { confirmedTaskCreationData } from "./taskCreation";

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
      queries: persisted.clientState.queries.map((query) => ({
        ...query,
        state: { ...query.state, data: confirmedTaskCreationData(client, query.queryKey, query.state.data, includePendingCounts) },
      })),
    },
  } : persisted;
  return createAsyncStoragePersister({
    storage: indexedDbStorage,
    key: namespace === "official"
      ? "ANTTODO_QUERY_CACHE"
      : `ANTTODO_QUERY_CACHE:${namespace}`,
    throttleTime: 750,
    serialize: (persisted) => JSON.stringify(confirmedClient(persisted, true)),
    // Retain existing offline caches, removing only legacy optimistic rows.
    deserialize: (value) => confirmedClient(JSON.parse(value) as PersistedClient, false),
  });
}
