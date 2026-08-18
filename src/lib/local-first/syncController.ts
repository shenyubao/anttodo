import {
  IDLE_SYNC_STATUS,
  type SyncController,
  type SyncReason,
  type SyncRunResult,
  type SyncStatus,
} from "./types";
import type { LocalCommand } from "./repository";

type SyncBridge = NonNullable<Window["anttodoDesktop"]>["sync"];

export function syncErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    // PostgREST details can contain the full rejected row. Keep those out of
    // user-facing notices while retaining the actionable message and hint.
    const parts = [value.message, value.hint]
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (parts.length > 0) {
      const code = typeof value.code === "string" && value.code.trim() ? ` (${value.code})` : "";
      return `${[...new Set(parts)].join(" ")}${code}`;
    }
  }
  return "同步失败";
}

function desktopSyncBridge(): SyncBridge | null {
  return window.anttodoDesktop?.sync ?? null;
}

export async function flushLocalOperation(input: {
  operationId: string;
  workspaceId: string;
  listPending: (workspaceId: string) => Promise<LocalCommand[]>;
  syncNow: (reason: "local-write") => Promise<SyncRunResult>;
  maxAttempts?: number;
}) {
  const maxAttempts = Math.max(1, input.maxAttempts ?? 3);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await input.syncNow("local-write");
    const pending = await input.listPending(input.workspaceId);
    const operation = pending.find((item) => item.operationId === input.operationId);
    if (!operation) return true;
    if (
      result.status === "failed"
      || result.status === "offline"
      || (operation as LocalCommand & { state?: string }).state === "failed"
    ) {
      return false;
    }
  }
  return false;
}

export function createSyncController(input: {
  workspaceId: string | null;
  online: boolean;
  runRemote?: (workspaceId: string, reason: SyncReason) => Promise<SyncRunResult>;
  onOnlineChange?: (listener: () => void) => () => void;
}): SyncController {
  let status: SyncStatus = { ...IDLE_SYNC_STATUS };
  let currentRun: Promise<SyncRunResult> | null = null;
  const listeners = new Set<(next: SyncStatus) => void>();
  const bridge = desktopSyncBridge();

  const emit = (next: SyncStatus) => {
    status = next;
    for (const listener of listeners) listener(status);
  };

  const refreshFromBridge = async () => {
    if (!bridge || typeof input.workspaceId !== "string") return;
    try {
      const remote = await bridge.getStatus(input.workspaceId);
      // A late status read must not clobber an in-flight sync or its error.
      if (currentRun || status.phase === "syncing" || status.phase === "error") return;
      emit({
        ...status,
        pendingCount: remote.pendingCount,
        conflictCount: remote.conflictCount,
        lastSyncedAt: remote.lastSyncedAt ?? status.lastSyncedAt,
        phase: remote.pendingCount > 0 ? "pending" : status.phase === "offline" ? "offline" : "idle",
      });
    } catch {
      // Local store may still be opening or briefly locked; keep UI status as-is.
    }
  };

  const syncNow = async (reason: SyncReason): Promise<SyncRunResult> => {
    if (currentRun) return currentRun;
    if (!input.online || !input.workspaceId) {
      const result: SyncRunResult = {
        status: "offline",
        applied: 0,
        conflicts: status.conflictCount,
      };
      emit({ ...status, phase: "offline" });
      return result;
    }

    const workspaceId = input.workspaceId;
    const run = (async (): Promise<SyncRunResult> => {
      emit({ ...status, phase: "syncing", errorMessage: null });
      try {
        const result: SyncRunResult = input.runRemote
          ? await input.runRemote(workspaceId, reason)
          : bridge
          ? await bridge.syncNow({ workspaceId, reason })
          : { status: "succeeded", applied: 0, conflicts: status.conflictCount };
        const nextPhase = result.status === "failed" ? "error" : "idle";
        emit({
          ...status,
          phase: nextPhase,
          pendingCount: Math.max(0, status.pendingCount - result.applied),
          conflictCount: result.conflicts,
          lastSyncedAt: result.status === "succeeded" || result.status === "conflict"
            ? new Date().toISOString()
            : status.lastSyncedAt,
          errorMessage: result.errorMessage ?? null,
        });
        return result;
      } catch (error) {
        const errorMessage = syncErrorMessage(error);
        const result: SyncRunResult = {
          status: "failed",
          applied: 0,
          conflicts: status.conflictCount,
          errorMessage,
        };
        emit({ ...status, phase: "error", errorMessage });
        return result;
      } finally {
        currentRun = null;
      }
    })();
    currentRun = run;
    return run;
  };

  const unsubscribeOnline = input.onOnlineChange?.(() => {
    if (navigator.onLine) {
      emit({ ...status, phase: status.pendingCount ? "pending" : "idle" });
      void syncNow("reconnect");
    } else {
      emit({ ...status, phase: "offline" });
    }
  });

  if (!input.online) emit({ ...status, phase: "offline" });
  void refreshFromBridge();

  return {
    syncNow,
    subscribe(listener) {
      listeners.add(listener);
      listener(status);
      return () => listeners.delete(listener);
    },
    getStatus: () => status,
    dispose() {
      unsubscribeOnline?.();
      listeners.clear();
    },
  };
}
