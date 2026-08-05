import { afterEach, describe, expect, it } from "vitest";
import {
  PENDING_DOWNLOAD_GUIDE_KEY,
  buildWorkspaceTeamClientInviteUrl,
  buildWorkspaceTeamLoginUrl,
  buildWorkspaceTeamOrigin,
  claimPendingDownloadGuide,
  consumePendingDownloadGuide,
  isTeamClientDownloadInvite,
  markPendingDownloadGuide,
  resolveAppLocation,
} from "./appHost";

describe("appHost", () => {
  afterEach(() => {
    window.sessionStorage.removeItem(PENDING_DOWNLOAD_GUIDE_KEY);
  });

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

  it("detects the client download invite query", () => {
    expect(isTeamClientDownloadInvite("?download=1")).toBe(true);
    expect(isTeamClientDownloadInvite("download=1")).toBe(true);
    expect(isTeamClientDownloadInvite("?download=1&demo=1")).toBe(true);
    expect(isTeamClientDownloadInvite("?download=0")).toBe(false);
    expect(isTeamClientDownloadInvite("")).toBe(false);
    expect(isTeamClientDownloadInvite("?demo=1")).toBe(false);
  });

  it("builds team client invite URLs with download=1", () => {
    expect(
      buildWorkspaceTeamClientInviteUrl("yucekj", "https://app.anttodo.com"),
    ).toBe("https://app.anttodo.com/team/yucekj?download=1");
    expect(
      buildWorkspaceTeamClientInviteUrl("坏", "https://app.anttodo.com"),
    ).toBeNull();
  });

  it("marks and consumes the pending download guide once", () => {
    expect(consumePendingDownloadGuide()).toBe(false);
    markPendingDownloadGuide();
    expect(window.sessionStorage.getItem(PENDING_DOWNLOAD_GUIDE_KEY)).toBe("1");
    expect(consumePendingDownloadGuide()).toBe(true);
    expect(consumePendingDownloadGuide()).toBe(false);
    expect(window.sessionStorage.getItem(PENDING_DOWNLOAD_GUIDE_KEY)).toBeNull();
  });

  it("claims the pending download guide only once per mark", () => {
    markPendingDownloadGuide();
    expect(claimPendingDownloadGuide()).toBe(true);
    expect(claimPendingDownloadGuide()).toBe(false);
    markPendingDownloadGuide();
    expect(claimPendingDownloadGuide()).toBe(true);
  });
});
