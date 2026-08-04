import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_COLOR_DARK,
  THEME_COLOR_LIGHT,
  THEME_PREFERENCE_STORAGE_KEY,
  applyResolvedTheme,
  applyThemePreference,
  loadThemePreference,
  parseThemePreference,
  resolveIsDark,
  saveThemePreference,
} from "./themePreference";

describe("themePreference", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses valid preference and falls back on invalid payloads", () => {
    expect(parseThemePreference(null)).toEqual(DEFAULT_THEME_PREFERENCE);
    expect(parseThemePreference("{")).toEqual(DEFAULT_THEME_PREFERENCE);
    expect(parseThemePreference(JSON.stringify({ followSystem: false, theme: "dark" }))).toEqual({
      followSystem: false,
      theme: "dark",
    });
    expect(
      parseThemePreference(JSON.stringify({ followSystem: "yes", theme: "neon" })),
    ).toEqual(DEFAULT_THEME_PREFERENCE);
  });

  it("loads and saves preference via storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };

    expect(loadThemePreference(storage)).toEqual(DEFAULT_THEME_PREFERENCE);
    saveThemePreference({ followSystem: false, theme: "dark" }, storage);
    expect(store.get(THEME_PREFERENCE_STORAGE_KEY)).toBe(
      JSON.stringify({ followSystem: false, theme: "dark" }),
    );
    expect(loadThemePreference(storage)).toEqual({ followSystem: false, theme: "dark" });
  });

  it("resolves dark mode from follow-system and explicit theme", () => {
    expect(resolveIsDark({ followSystem: true, theme: "default" }, true)).toBe(true);
    expect(resolveIsDark({ followSystem: true, theme: "dark" }, false)).toBe(false);
    expect(resolveIsDark({ followSystem: false, theme: "dark" }, false)).toBe(true);
    expect(resolveIsDark({ followSystem: false, theme: "default" }, true)).toBe(false);
  });

  it("applies html.dark and theme-color meta", () => {
    const classList = {
      toggle: vi.fn(),
    };
    const meta = { setAttribute: vi.fn() };
    const documentRef = {
      documentElement: { classList },
      querySelector: vi.fn(() => meta),
    } as unknown as Document;

    applyResolvedTheme(true, documentRef);
    expect(classList.toggle).toHaveBeenCalledWith("dark", true);
    expect(meta.setAttribute).toHaveBeenCalledWith("content", THEME_COLOR_DARK);

    applyThemePreference(
      { followSystem: false, theme: "default" },
      { systemPrefersDark: true, documentRef },
    );
    expect(classList.toggle).toHaveBeenLastCalledWith("dark", false);
    expect(meta.setAttribute).toHaveBeenLastCalledWith("content", THEME_COLOR_LIGHT);
  });
});
