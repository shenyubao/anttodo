import { instanceStorageKey } from "./instanceConfig";

export type FeatureModulePreferences = {
  weeklyReportsEnabled: boolean;
  okrEnabled: boolean;
  calendarEnabled: boolean;
  matrixEnabled: boolean;
  focusEnabled: boolean;
  mindMapEnabled: boolean;
};

export const FEATURE_MODULE_PREFERENCES_STORAGE_KEY = "anttodo:feature-modules";

export const DEFAULT_FEATURE_MODULE_PREFERENCES: FeatureModulePreferences = {
  weeklyReportsEnabled: false,
  okrEnabled: false,
  calendarEnabled: true,
  matrixEnabled: true,
  focusEnabled: true,
  mindMapEnabled: false,
};

function preferenceStorageKey(namespace?: string) {
  return instanceStorageKey(FEATURE_MODULE_PREFERENCES_STORAGE_KEY, namespace);
}

export function parseFeatureModulePreferences(
  raw: string | null | undefined,
): FeatureModulePreferences {
  if (!raw?.trim()) return { ...DEFAULT_FEATURE_MODULE_PREFERENCES };
  try {
    const parsed = JSON.parse(raw) as Partial<FeatureModulePreferences>;
    return {
      weeklyReportsEnabled: typeof parsed.weeklyReportsEnabled === "boolean"
        ? parsed.weeklyReportsEnabled
        : DEFAULT_FEATURE_MODULE_PREFERENCES.weeklyReportsEnabled,
      okrEnabled: typeof parsed.okrEnabled === "boolean"
        ? parsed.okrEnabled
        : DEFAULT_FEATURE_MODULE_PREFERENCES.okrEnabled,
      calendarEnabled: typeof parsed.calendarEnabled === "boolean"
        ? parsed.calendarEnabled
        : DEFAULT_FEATURE_MODULE_PREFERENCES.calendarEnabled,
      matrixEnabled: typeof parsed.matrixEnabled === "boolean"
        ? parsed.matrixEnabled
        : DEFAULT_FEATURE_MODULE_PREFERENCES.matrixEnabled,
      focusEnabled: typeof parsed.focusEnabled === "boolean"
        ? parsed.focusEnabled
        : DEFAULT_FEATURE_MODULE_PREFERENCES.focusEnabled,
      mindMapEnabled: typeof parsed.mindMapEnabled === "boolean"
        ? parsed.mindMapEnabled
        : DEFAULT_FEATURE_MODULE_PREFERENCES.mindMapEnabled,
    };
  } catch {
    return { ...DEFAULT_FEATURE_MODULE_PREFERENCES };
  }
}

export function loadFeatureModulePreferences(
  storage: Pick<Storage, "getItem"> | null | undefined =
    typeof window === "undefined" ? undefined : window.localStorage,
  namespace?: string,
): FeatureModulePreferences {
  if (!storage) return { ...DEFAULT_FEATURE_MODULE_PREFERENCES };
  try {
    return parseFeatureModulePreferences(storage.getItem(preferenceStorageKey(namespace)));
  } catch {
    return { ...DEFAULT_FEATURE_MODULE_PREFERENCES };
  }
}

export function saveFeatureModulePreferences(
  preferences: FeatureModulePreferences,
  storage: Pick<Storage, "setItem"> | null | undefined =
    typeof window === "undefined" ? undefined : window.localStorage,
  namespace?: string,
) {
  if (!storage) return;
  storage.setItem(preferenceStorageKey(namespace), JSON.stringify(preferences));
}
