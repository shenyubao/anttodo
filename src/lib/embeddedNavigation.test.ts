import { describe, expect, it } from "vitest";
import { embeddedNavigationEnabled } from "./embeddedNavigation";

describe("embeddedNavigationEnabled", () => {
  it("enables the mode only for the exact Web query parameter", () => {
    expect(embeddedNavigationEnabled({ search: "?hideMenu=true" })).toBe(true);
    expect(embeddedNavigationEnabled({ search: "?demo=1&hideMenu=true" })).toBe(true);
    expect(embeddedNavigationEnabled({ search: "?hideMenu=1" })).toBe(false);
    expect(embeddedNavigationEnabled({ search: "?hideMenu=True" })).toBe(false);
    expect(embeddedNavigationEnabled({ search: "?hideMenu=false" })).toBe(false);
    expect(embeddedNavigationEnabled({ search: "" })).toBe(false);
  });

  it("does not enable the mode in Electron or Capacitor", () => {
    expect(embeddedNavigationEnabled({
      search: "?hideMenu=true",
      desktop: true,
    })).toBe(false);
    expect(embeddedNavigationEnabled({
      search: "?hideMenu=true",
      native: true,
    })).toBe(false);
  });
});
