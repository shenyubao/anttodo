import { useSyncExternalStore } from "react";

export type DisplayPreference = {
  showContactNames: boolean;
};

export const DISPLAY_PREFERENCE_STORAGE_KEY = "anttodo:display-preference";

export const DEFAULT_DISPLAY_PREFERENCE: DisplayPreference = {
  showContactNames: false,
};

const listeners = new Set<() => void>();
let snapshot: DisplayPreference = { ...DEFAULT_DISPLAY_PREFERENCE };
let snapshotInitialized = false;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function formatContactDisplayName(name: string) {
  const trimmed = name.trim();
  return trimmed.length > 3 ? `${trimmed.slice(0, 3)}...` : trimmed;
}

export function parseDisplayPreference(raw: string | null | undefined): DisplayPreference {
  if (!raw?.trim()) return { ...DEFAULT_DISPLAY_PREFERENCE };
  try {
    const parsed = JSON.parse(raw) as Partial<DisplayPreference>;
    return {
      showContactNames:
        typeof parsed.showContactNames === "boolean"
          ? parsed.showContactNames
          : DEFAULT_DISPLAY_PREFERENCE.showContactNames,
    };
  } catch {
    return { ...DEFAULT_DISPLAY_PREFERENCE };
  }
}

export function loadDisplayPreference(
  storage: Pick<Storage, "getItem"> | null | undefined = globalThis.localStorage,
): DisplayPreference {
  if (!storage) return { ...DEFAULT_DISPLAY_PREFERENCE };
  try {
    return parseDisplayPreference(storage.getItem(DISPLAY_PREFERENCE_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_DISPLAY_PREFERENCE };
  }
}

export function saveDisplayPreference(
  preference: DisplayPreference,
  storage: Pick<Storage, "setItem"> | null | undefined = globalThis.localStorage,
): void {
  snapshot = { ...preference };
  snapshotInitialized = true;
  if (storage) {
    storage.setItem(DISPLAY_PREFERENCE_STORAGE_KEY, JSON.stringify(preference));
  }
  emit();
}

function getSnapshot(): DisplayPreference {
  if (!snapshotInitialized) {
    snapshot = loadDisplayPreference();
    snapshotInitialized = true;
  }
  return snapshot;
}

export function subscribeDisplayPreference(listener: () => void) {
  return subscribe(listener);
}

export function useShowContactNames() {
  const preference = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULT_DISPLAY_PREFERENCE,
  );
  return preference.showContactNames;
}
