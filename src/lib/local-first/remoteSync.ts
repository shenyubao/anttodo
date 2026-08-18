import type { SupabaseClient } from "@supabase/supabase-js";
import type { SyncReason, SyncRunResult } from "./types";
import type { LocalFirstStore } from "./localStore";

type RemoteSyncAdapter = {
  run: (workspaceId: string, reason: SyncReason) => Promise<SyncRunResult>;
};

function namespacedKey(key: string, namespace: string) {
  return namespace === "official" ? key : `${key}:${namespace}`;
}

export function deviceIdForUser(userId: string, namespace = "official"): string {
  const key = namespacedKey(`anttodo:sync-device:${userId}`, namespace);
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  window.localStorage.setItem(key, id);
  return id;
}

export function nextDeviceSeq(userId: string, namespace = "official"): number {
  const key = namespacedKey(`anttodo:sync-device-seq:${userId}`, namespace);
  const next = Number(window.localStorage.getItem(key) ?? 0) + 1;
  window.localStorage.setItem(key, String(next));
  return next;
}

function cursorKey(userId: string, workspaceId: string, namespace: string) {
  return namespacedKey(`anttodo:sync-cursor:${userId}:${workspaceId}`, namespace);
}

export function createRemoteSyncAdapter(
  client: SupabaseClient,
  userId: string,
  localStore: LocalFirstStore | null = null,
  namespace = "official",
): RemoteSyncAdapter {
  const deviceId = deviceIdForUser(userId, namespace);
  const bridge = window.anttodoDesktop?.sync;
  let deviceRegistered = false;

  return {
    async run(workspaceId, _reason) {
      // Register once per session. Re-registering every sync updates
      // client_devices and would churn realtime subscribers.
      if (!deviceRegistered) {
        const { error: registrationError } = await client.rpc("register_client_device", {
          p_device_id: deviceId,
          p_platform: window.anttodoDesktop ? "mac" : "web",
          p_name: window.anttodoDesktop ? "AntTodo Mac" : "AntTodo Web",
        });
        if (registrationError) throw registrationError;
        deviceRegistered = true;
      }

      const cursor = Number(window.localStorage.getItem(cursorKey(userId, workspaceId, namespace)) ?? 0);
      const { data: pulled, error: pullError } = await client.rpc("pull_client_changes", {
        p_workspace_id: workspaceId,
        p_cursor: cursor,
        p_limit: 500,
      });
      if (pullError) throw pullError;

      const pending = localStore
        ? await localStore.listPending(workspaceId)
        : bridge
        ? await bridge.listOutbox({ workspaceId, limit: 50 })
        : [];
      let applied = Array.isArray(pulled) ? pulled.length : 0;
      let conflicts = 0;
      if (pending.length > 0) {
        const { data: results, error: pushError } = await client.rpc("apply_client_operations", {
          p_operations: pending,
        });
        if (pushError) throw pushError;
        for (const result of Array.isArray(results) ? results : []) {
          const state = result?.status;
          if (state === "conflict") conflicts += 1;
          if (result?.operationId && (localStore || bridge)) {
            const operationId = String(result.operationId);
            const nextState = state === "applied" || state === "duplicate" ? "succeeded" : "failed";
            if (localStore) await localStore.markPending(operationId, nextState, result?.code);
            else await bridge!.markOutbox({ operationId, state: nextState, error: result?.code });
          }
          if (state === "applied" || state === "duplicate") applied += 1;
        }
      }

      const nextCursor = Array.isArray(pulled) && pulled.length > 0
        ? Number(pulled[pulled.length - 1]?.seq ?? cursor)
        : cursor;
      if (nextCursor > cursor) {
        window.localStorage.setItem(cursorKey(userId, workspaceId, namespace), String(nextCursor));
        const { error: ackError } = await client.rpc("ack_client_cursor", {
          p_device_id: deviceId,
          p_workspace_id: workspaceId,
          p_cursor: nextCursor,
        });
        if (ackError) throw ackError;
      }

      return {
        status: conflicts > 0 ? "conflict" : "succeeded",
        applied,
        conflicts,
      };
    },
  };
}
