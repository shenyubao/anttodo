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

  it("orders enabled modules as calendar, OKR, weekly reports, matrix, focus, and mind map", () => {
    const sections = visiblePrimaryNavigationItems({
      ...DEFAULT_FEATURE_MODULE_PREFERENCES,
      weeklyReportsEnabled: true,
      okrEnabled: true,
      mindMapEnabled: true,
    })
      .map((item) => item.section);
    expect(sections).toEqual(["tasks", "calendar", "okr", "weekly_reports", "matrix", "focus", "mindmap", "search"]);
  });

  it("hides weekly reports and OKR by default", () => {
    const sections = visiblePrimaryNavigationItems(DEFAULT_FEATURE_MODULE_PREFERENCES)
      .map((item) => item.section);
    expect(sections).not.toContain("weekly_reports");
    expect(sections).not.toContain("okr");
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
