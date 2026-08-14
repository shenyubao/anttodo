import type { SyncStatus } from "./types";

export type LocalCommand = {
  operationId: string;
  workspaceId: string;
  deviceId: string;
  deviceSeq: number;
  entityType: string;
  entityId: string;
  baseVersion?: number | null;
  payload: Record<string, unknown>;
  dependsOn?: string[];
};

export type WorkspaceRepository = {
  enqueue: (command: LocalCommand) => Promise<void>;
  listPending: (workspaceId: string) => Promise<unknown[]>;
  markResult: (operationId: string, state: string, error?: string) => Promise<void>;
  getSyncStatus: (workspaceId: string) => Promise<SyncStatus>;
};

export function createDesktopWorkspaceRepository(): WorkspaceRepository | null {
  const sync = window.anttodoDesktop?.sync;
  if (!sync) return null;
  return {
    async enqueue(command) {
      const accepted = await sync.enqueue(command);
      if (!accepted) throw new Error("本地数据库不可用");
    },
    listPending(workspaceId) {
      return sync.listOutbox({ workspaceId, limit: 50 });
    },
    async markResult(operationId, state, error) {
      await sync.markOutbox({ operationId, state, error });
    },
    getSyncStatus(workspaceId) {
      return sync.getStatus(workspaceId);
    },
  };
}
