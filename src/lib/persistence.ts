import { del, get, set } from "idb-keyval";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";

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

export function createQueryPersister(namespace = "official") {
  return createAsyncStoragePersister({
    storage: indexedDbStorage,
    key: namespace === "official"
      ? "ANTTODO_QUERY_CACHE"
      : `ANTTODO_QUERY_CACHE:${namespace}`,
    throttleTime: 750,
  });
}
