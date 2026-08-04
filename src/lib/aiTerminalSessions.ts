import { useSyncExternalStore } from "react";

const EMPTY_RUNNING_TASK_IDS: ReadonlySet<string> = new Set();
const sessionsByTask = new Map<string, Set<string>>();
const listeners = new Set<() => void>();

let cachedKey = "";
let cachedIds: ReadonlySet<string> = EMPTY_RUNNING_TASK_IDS;

function snapshotKey() {
  return [...sessionsByTask.entries()]
    .map(([taskId, sessions]) => `${taskId}:${[...sessions].sort().join(",")}`)
    .sort()
    .join("|");
}

function emit() {
  const nextKey = snapshotKey();
  if (nextKey === cachedKey) return;
  cachedKey = nextKey;
  cachedIds = nextKey
    ? new Set(sessionsByTask.keys())
    : EMPTY_RUNNING_TASK_IDS;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getRunningTaskIds() {
  return cachedIds;
}

export function trackAiTerminalSession(taskId: string, sessionId: string) {
  let sessions = sessionsByTask.get(taskId);
  if (!sessions) {
    sessions = new Set();
    sessionsByTask.set(taskId, sessions);
  }
  if (sessions.has(sessionId)) return;
  sessions.add(sessionId);
  emit();
}

export function untrackAiTerminalSession(sessionId: string) {
  let changed = false;
  for (const [taskId, sessions] of sessionsByTask) {
    if (!sessions.delete(sessionId)) continue;
    changed = true;
    if (sessions.size === 0) sessionsByTask.delete(taskId);
  }
  if (changed) emit();
}

export function getAiTerminalRunningTaskIds(): ReadonlySet<string> {
  return cachedIds;
}

export function useAiTerminalRunningTaskIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getRunningTaskIds, () => EMPTY_RUNNING_TASK_IDS);
}
