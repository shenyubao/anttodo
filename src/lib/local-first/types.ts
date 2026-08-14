export type SyncPhase = "idle" | "pending" | "syncing" | "offline" | "error";

export type SyncStatus = {
  phase: SyncPhase;
  pendingCount: number;
  conflictCount: number;
  lastSyncedAt: string | null;
  errorMessage: string | null;
};

export type SyncRunResult = {
  status: "succeeded" | "offline" | "failed" | "conflict";
  applied: number;
  conflicts: number;
  errorMessage?: string;
};

export type SyncReason =
  | "manual"
  | "local-write"
  | "reconnect"
  | "realtime"
  | "timer";

export type SyncController = {
  syncNow: (reason: SyncReason) => Promise<SyncRunResult>;
  subscribe: (listener: (status: SyncStatus) => void) => () => void;
  getStatus: () => SyncStatus;
  dispose: () => void;
};

export const IDLE_SYNC_STATUS: SyncStatus = {
  phase: "idle",
  pendingCount: 0,
  conflictCount: 0,
  lastSyncedAt: null,
  errorMessage: null,
};
