export type ThemeId = "default" | "dark";

export type ThemePreference = {
  followSystem: boolean;
  theme: ThemeId;
};

export const THEME_PREFERENCE_STORAGE_KEY = "anttodo:theme-preference";

export const DEFAULT_THEME_PREFERENCE: ThemePreference = {
  followSystem: true,
  theme: "default",
};

export const THEME_COLOR_LIGHT = "#f6f7f9";
export const THEME_COLOR_DARK = "#1f1f1f";

const THEME_IDS = new Set<ThemeId>(["default", "dark"]);

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_IDS.has(value as ThemeId);
}

export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  if (!raw?.trim()) return { ...DEFAULT_THEME_PREFERENCE };
  try {
    const parsed = JSON.parse(raw) as Partial<ThemePreference>;
    return {
      followSystem:
        typeof parsed.followSystem === "boolean"
          ? parsed.followSystem
          : DEFAULT_THEME_PREFERENCE.followSystem,
      theme: isThemeId(parsed.theme) ? parsed.theme : DEFAULT_THEME_PREFERENCE.theme,
    };
  } catch {
    return { ...DEFAULT_THEME_PREFERENCE };
  }
}

export function loadThemePreference(
  storage: Pick<Storage, "getItem"> | null | undefined = globalThis.localStorage,
): ThemePreference {
  if (!storage) return { ...DEFAULT_THEME_PREFERENCE };
  try {
    return parseThemePreference(storage.getItem(THEME_PREFERENCE_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_THEME_PREFERENCE };
  }
}

export function saveThemePreference(
  preference: ThemePreference,
  storage: Pick<Storage, "setItem"> | null | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  storage.setItem(THEME_PREFERENCE_STORAGE_KEY, JSON.stringify(preference));
}

export function getSystemPrefersDark(
  media: Pick<MediaQueryList, "matches"> | null | undefined =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null,
): boolean {
  return Boolean(media?.matches);
}

export function resolveIsDark(
  preference: ThemePreference,
  systemPrefersDark: boolean = getSystemPrefersDark(),
): boolean {
  if (preference.followSystem) return systemPrefersDark;
  return preference.theme === "dark";
}

export function applyResolvedTheme(
  isDark: boolean,
  documentRef: Document = document,
): void {
  documentRef.documentElement.classList.toggle("dark", isDark);
  const meta = documentRef.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", isDark ? THEME_COLOR_DARK : THEME_COLOR_LIGHT);
  }
}

export function applyThemePreference(
  preference: ThemePreference,
  options?: {
    systemPrefersDark?: boolean;
    documentRef?: Document;
  },
): boolean {
  const isDark = resolveIsDark(
    preference,
    options?.systemPrefersDark ?? getSystemPrefersDark(),
  );
  applyResolvedTheme(isDark, options?.documentRef ?? document);
  return isDark;
}

export function subscribeSystemTheme(
  onChange: (systemPrefersDark: boolean) => void,
  media: MediaQueryList | null =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null,
): () => void {
  if (!media) return () => undefined;

  const listener = (event: MediaQueryListEvent) => {
    onChange(event.matches);
  };

  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }

  // Safari < 14
  media.addListener(listener);
  return () => media.removeListener(listener);
}
