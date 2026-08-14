import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DISPLAY_PREFERENCE,
  DISPLAY_PREFERENCE_STORAGE_KEY,
  formatContactDisplayName,
  loadDisplayPreference,
  parseDisplayPreference,
  saveDisplayPreference,
  subscribeDisplayPreference,
} from "./displayPreference";

describe("displayPreference", () => {
  afterEach(() => {
    saveDisplayPreference(DEFAULT_DISPLAY_PREFERENCE, {
      setItem: () => undefined,
    });
  });

  it("parses valid preference and falls back on invalid payloads", () => {
    expect(parseDisplayPreference(null)).toEqual(DEFAULT_DISPLAY_PREFERENCE);
    expect(parseDisplayPreference("{")).toEqual(DEFAULT_DISPLAY_PREFERENCE);
    expect(parseDisplayPreference(JSON.stringify({ showContactNames: true }))).toEqual({
      showContactNames: true,
    });
    expect(parseDisplayPreference(JSON.stringify({ showContactNames: "yes" }))).toEqual(
      DEFAULT_DISPLAY_PREFERENCE,
    );
  });

  it("defaults to hiding contact names", () => {
    expect(DEFAULT_DISPLAY_PREFERENCE.showContactNames).toBe(false);
    expect(loadDisplayPreference({ getItem: () => null })).toEqual(DEFAULT_DISPLAY_PREFERENCE);
  });

  it("loads and saves preference via storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };

    expect(loadDisplayPreference(storage)).toEqual(DEFAULT_DISPLAY_PREFERENCE);
    saveDisplayPreference({ showContactNames: true }, storage);
    expect(store.get(DISPLAY_PREFERENCE_STORAGE_KEY)).toBe(
      JSON.stringify({ showContactNames: true }),
    );
    expect(loadDisplayPreference(storage)).toEqual({ showContactNames: true });
  });

  it("notifies subscribers when preference is saved", () => {
    let notified = 0;
    const unsubscribe = subscribeDisplayPreference(() => {
      notified += 1;
    });
    saveDisplayPreference({ showContactNames: true }, { setItem: () => undefined });
    expect(notified).toBe(1);
    unsubscribe();
    saveDisplayPreference({ showContactNames: false }, { setItem: () => undefined });
    expect(notified).toBe(1);
  });
});

describe("formatContactDisplayName", () => {
  it("keeps names of three characters or fewer", () => {
    expect(formatContactDisplayName("沈宇宝")).toBe("沈宇宝");
    expect(formatContactDisplayName(" 产品 ")).toBe("产品");
  });

  it("truncates names longer than three characters", () => {
    expect(formatContactDisplayName("产品同学")).toBe("产品同...");
  });
});
