import { describe, expect, it } from "vitest";
import {
  buildWorkspaceTeamLoginUrl,
  buildWorkspaceTeamOrigin,
  resolveAppLocation,
} from "./appHost";

describe("appHost", () => {
  it("parses canonical team paths", () => {
    expect(resolveAppLocation("/team/yucekj")).toEqual({
      kind: "team",
      slug: "yucekj",
    });
    expect(resolveAppLocation("/team/AntTodo-Product/")).toEqual({
      kind: "team",
      slug: "anttodo-product",
    });
    expect(resolveAppLocation("/team/acme")).toEqual({
      kind: "team",
      slug: "acme",
    });
  });

  it("rejects invalid or nested team paths", () => {
    expect(resolveAppLocation("/team/产品")).toEqual({
      kind: "main",
    });
    expect(resolveAppLocation("/team/acme/settings")).toEqual({ kind: "main" });
    expect(resolveAppLocation("/")).toEqual({ kind: "main" });
  });

  it("builds team login origins from the public app URL", () => {
    expect(
      buildWorkspaceTeamOrigin("yucekj", "https://app.anttodo.com"),
    ).toBe("https://app.anttodo.com");
    expect(
      buildWorkspaceTeamLoginUrl("yucekj", "https://app.anttodo.com"),
    ).toBe("https://app.anttodo.com/team/yucekj");
    expect(buildWorkspaceTeamLoginUrl("坏", "https://app.anttodo.com")).toBeNull();
  });
});
