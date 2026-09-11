import { describe, expect, it } from "vitest";
import { DEFAULT_FEATURE_MODULE_PREFERENCES } from "./featureModulePreferences";
import { visiblePrimaryNavigationItems } from "./primaryNavigation";

describe("primary navigation", () => {
  it("places the enabled matrix directly after calendar", () => {
    const sections = visiblePrimaryNavigationItems({
      ...DEFAULT_FEATURE_MODULE_PREFERENCES,
      mindMapEnabled: true,
    }).map((item) => item.section);
    expect(sections.indexOf("matrix")).toBe(sections.indexOf("calendar") + 1);
  });

  it("places weekly reports directly after tasks", () => {
    const sections = visiblePrimaryNavigationItems(DEFAULT_FEATURE_MODULE_PREFERENCES)
      .map((item) => item.section);
    expect(sections.indexOf("weekly_reports")).toBe(sections.indexOf("tasks") + 1);
  });

  it("hides matrix when its feature module is disabled", () => {
    expect(visiblePrimaryNavigationItems({
      weeklyReportsEnabled: false,
      okrEnabled: false,
      calendarEnabled: false,
      matrixEnabled: false,
      focusEnabled: false,
      mindMapEnabled: false,
    }).map((item) => item.section)).toEqual(["tasks", "search"]);
  });
});
