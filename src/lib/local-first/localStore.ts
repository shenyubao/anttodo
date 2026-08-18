import { Capacitor } from "@capacitor/core";
import { get, set } from "idb-keyval";
import type { TaskComment, Workspace, WorkspaceBundle } from "../../types";
import type { LocalCommand } from "./repository";

/** Desktop and native hosts persist a writable local-first store; the web app does not. */
export function isLocalFirstHost() {
  return Boolean(window.anttodoDesktop) || Capacitor.isNativePlatform();
}

export function offlineCacheBannerText(localFirst = isLocalFirstHost()) {
  return localFirst
    ? "当前显示离线缓存，恢复网络后会自动刷新"
    : "当前显示上次缓存，恢复网络后会自动刷新";
}

export async function loadLocalFirstSnapshot<T>(input: {
  localEnabled: boolean;
  online: boolean;
  preferLocal: boolean;
  pendingLocalWrites?: boolean;
  readLocal: () => Promise<T | null>;
  readRemote: () => Promise<T>;
  writeLocal: (value: T) => Promise<void>;
}) {
  const shouldReadLocalFirst = input.localEnabled && (
    input.preferLocal
    || !input.online
    || Boolean(input.pendingLocalWrites)
  );
  if (shouldReadLocalFirst) {
    const cached = await input.readLocal();
    if (cached !== null) return cached;
  }

  try {
    const value = await input.readRemote();
    if (input.localEnabled) await input.writeLocal(value);
    return value;
  } catch (error) {
    if (!input.localEnabled) throw error;
    const cached = await input.readLocal();
    if (cached === null) throw error;
    return cached;
  }
}

type LocalState = {
  workspaces: Workspace[];
  bundles: Record<string, WorkspaceBundle>;
  comments: Record<string, TaskComment[]>;
  outbox: LocalCommand[];
};

export type LocalFirstStore = {
  enabled: boolean;
  open: () => Promise<void>;
  getWorkspaces: () => Promise<Workspace[] | null>;
  saveWorkspaces: (workspaces: Workspace[]) => Promise<void>;
  getBundle: (workspaceId: string) => Promise<WorkspaceBundle | null>;
  saveBundle: (workspaceId: string, bundle: WorkspaceBundle) => Promise<void>;
  getComments: (taskId: string) => Promise<TaskComment[] | null>;
  saveComments: (taskId: string, comments: TaskComment[]) => Promise<void>;
  commitComments: (input: {
    taskId: string;
    comments: TaskComment[];
    command: LocalCommand;
  }) => Promise<void>;
  commitBundle: (input: {
    workspaceId: string;
    bundle: WorkspaceBundle;
    command: LocalCommand;
  }) => Promise<void>;
  listPending: (workspaceId: string) => Promise<LocalCommand[]>;
  markPending: (operationId: string, state: string, error?: string) => Promise<void>;
};

function emptyState(): LocalState {
  return { workspaces: [], bundles: {}, comments: {}, outbox: [] };
}

function stateKey(userId: string, namespace: string) {
  return namespace === "official"
    ? `anttodo:local-first:${userId}`
    : `anttodo:local-first:${namespace}:${userId}`;
}

export function createLocalFirstStore(
  userId: string,
  enabled: boolean,
  namespace = "official",
): LocalFirstStore {
  const bridge = window.anttodoDesktop?.sync;
  const desktop = enabled && Boolean(bridge);
  const key = stateKey(userId, namespace);
  let opened = false;
  let statePromise: Promise<LocalState> | null = null;

  const readIndexedState = async () => {
    const stored = await get<LocalState>(key);
    return stored ? { ...emptyState(), ...stored } : emptyState();
  };

  const readState = async () => {
    if (!statePromise) statePromise = readIndexedState();
    return statePromise;
  };

  const writeState = async (next: LocalState) => {
    statePromise = Promise.resolve(next);
    await set(key, next);
  };

  return {
    enabled,
    async open() {
      if (!enabled || opened) return;
      if (desktop) {
        await bridge!.open(namespace, userId);
      } else {
        await readState();
      }
      opened = true;
    },
    async getWorkspaces() {
      if (!enabled) return null;
      if (desktop) return bridge!.getWorkspaces();
      const value = (await readState()).workspaces;
      return value.length > 0 ? value : null;
    },
    async saveWorkspaces(workspaces) {
      if (!enabled) return;
      if (desktop) {
        await bridge!.saveWorkspaces({ workspaces });
        return;
      }
      const current = await readState();
      await writeState({ ...current, workspaces });
    },
    async getBundle(workspaceId) {
      if (!enabled) return null;
      if (desktop) return bridge!.getBundle(workspaceId);
      return (await readState()).bundles[workspaceId] ?? null;
    },
    async saveBundle(workspaceId, bundle) {
      if (!enabled) return;
      if (desktop) {
        await bridge!.saveBundle({ workspaceId, bundle });
        return;
      }
      const current = await readState();
      await writeState({
        ...current,
        bundles: { ...current.bundles, [workspaceId]: bundle },
      });
    },
    async getComments(taskId) {
      if (!enabled) return null;
      const commentKey = taskId;
      if (desktop) return bridge!.getComments(commentKey);
      return (await readState()).comments[commentKey] ?? null;
    },
    async saveComments(taskId, comments) {
      if (!enabled) return;
      const commentKey = taskId;
      if (desktop) {
        await bridge!.saveComments({ commentKey, comments });
        return;
      }
      const current = await readState();
      await writeState({ ...current, comments: { ...current.comments, [commentKey]: comments } });
    },
    async commitComments({ taskId, comments, command }) {
      if (!enabled) return;
      const commentKey = taskId;
      if (desktop) {
        await bridge!.commitComments({ commentKey, comments, operation: command });
        return;
      }
      const current = await readState();
      if (current.outbox.some((item) => item.operationId === command.operationId)) return;
      await writeState({
        ...current,
        comments: { ...current.comments, [commentKey]: comments },
        outbox: [...current.outbox, command],
      });
    },
    async commitBundle({ workspaceId, bundle, command }) {
      if (!enabled) return;
      if (desktop) {
        await bridge!.commitBundle({ workspaceId, bundle, operation: command });
        return;
      }
      const current = await readState();
      if (current.outbox.some((item) => item.operationId === command.operationId)) {
        return;
      }
      await writeState({
        ...current,
        bundles: { ...current.bundles, [workspaceId]: bundle },
        outbox: [...current.outbox, command],
      });
    },
    async listPending(workspaceId) {
      if (!enabled) return [];
      if (desktop) return (await bridge!.listOutbox({ workspaceId, limit: 50 })) as LocalCommand[];
      return (await readState()).outbox.filter((item) => item.workspaceId === workspaceId);
    },
    async markPending(operationId, state, error) {
      if (!enabled) return;
      if (desktop) {
        await bridge!.markOutbox({ operationId, state, error });
        return;
      }
      const current = await readState();
      if (state === "succeeded") {
        await writeState({ ...current, outbox: current.outbox.filter((item) => item.operationId !== operationId) });
      }
    },
  };
}
