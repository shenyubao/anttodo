import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEATURE_MODULE_PREFERENCES,
  FEATURE_MODULE_PREFERENCES_STORAGE_KEY,
  loadFeatureModulePreferences,
  parseFeatureModulePreferences,
  saveFeatureModulePreferences,
} from "./featureModulePreferences";

describe("featureModulePreferences", () => {
  it("defaults to weekly reports, OKR and mind map hidden with the core modules enabled", () => {
    expect(DEFAULT_FEATURE_MODULE_PREFERENCES).toEqual({
      weeklyReportsEnabled: false,
      okrEnabled: false,
      calendarEnabled: true,
      matrixEnabled: true,
      focusEnabled: true,
      mindMapEnabled: false,
    });
    expect(loadFeatureModulePreferences({ getItem: () => null })).toEqual(
      DEFAULT_FEATURE_MODULE_PREFERENCES,
    );
  });

  it("parses complete and partial preferences", () => {
    expect(parseFeatureModulePreferences(JSON.stringify({
      weeklyReportsEnabled: false,
      okrEnabled: false,
      calendarEnabled: false,
      matrixEnabled: false,
      focusEnabled: false,
      mindMapEnabled: true,
    }))).toEqual({
      weeklyReportsEnabled: false,
      okrEnabled: false,
      calendarEnabled: false,
      matrixEnabled: false,
      focusEnabled: false,
      mindMapEnabled: true,
    });
    expect(parseFeatureModulePreferences(JSON.stringify({ mindMapEnabled: true }))).toEqual({
      weeklyReportsEnabled: false,
      okrEnabled: false,
      calendarEnabled: true,
      matrixEnabled: true,
      focusEnabled: true,
      mindMapEnabled: true,
    });
  });

  it("falls back field by field for malformed values and invalid JSON", () => {
    expect(parseFeatureModulePreferences("{"))
      .toEqual(DEFAULT_FEATURE_MODULE_PREFERENCES);
    expect(parseFeatureModulePreferences(JSON.stringify({
      weeklyReportsEnabled: "yes",
      okrEnabled: "yes",
      calendarEnabled: "yes",
      matrixEnabled: "yes",
      focusEnabled: false,
      mindMapEnabled: 1,
    }))).toEqual({
      weeklyReportsEnabled: false,
      okrEnabled: false,
      calendarEnabled: true,
      matrixEnabled: true,
      focusEnabled: false,
      mindMapEnabled: false,
    });
  });

  it("loads and saves with instance-isolated storage keys", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    const preferences = {
      weeklyReportsEnabled: false,
      okrEnabled: false,
      calendarEnabled: false,
      matrixEnabled: false,
      focusEnabled: true,
      mindMapEnabled: true,
    };

    saveFeatureModulePreferences(preferences, storage, "company-instance");

    expect(store.get(`${FEATURE_MODULE_PREFERENCES_STORAGE_KEY}:company-instance`))
      .toBe(JSON.stringify(preferences));
    expect(loadFeatureModulePreferences(storage, "company-instance")).toEqual(preferences);
    expect(loadFeatureModulePreferences(storage, "another-instance"))
      .toEqual(DEFAULT_FEATURE_MODULE_PREFERENCES);
  });
});
