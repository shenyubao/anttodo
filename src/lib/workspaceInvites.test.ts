import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  buildWorkspaceInviteUrl,
  clearPendingWorkspaceInvite,
  higherWorkspaceRole,
  PENDING_WORKSPACE_INVITE_KEY,
  readPendingWorkspaceInvite,
  workspaceInviteIdFromPath,
  workspaceInviteRoleLabel,
  writePendingWorkspaceInvite,
} from "./workspaceInvites";

const linkId = "7e74efbb-780a-411b-aa7a-1867efbfa40a";

describe("workspace invite links", () => {
  it("parses only canonical invite paths", () => {
    expect(workspaceInviteIdFromPath(`/invite/${linkId}`)).toBe(linkId);
    expect(workspaceInviteIdFromPath(`/?invite=${linkId}`)).toBeNull();
    expect(workspaceInviteIdFromPath("/invite/not-a-token")).toBeNull();
  });

  it("prefers the configured public web URL and rejects file origins", () => {
    expect(
      buildWorkspaceInviteUrl(linkId, "https://todo.example.com/app", "file://"),
    ).toBe(`https://todo.example.com/invite/${linkId}`);
    expect(buildWorkspaceInviteUrl(linkId, undefined, "file://")).toBeNull();
  });

  it("never downgrades an existing role", () => {
    expect(higherWorkspaceRole("owner", "member")).toBe("owner");
    expect(higherWorkspaceRole("admin", "member")).toBe("admin");
    expect(higherWorkspaceRole("member", "admin")).toBe("admin");
    expect(workspaceInviteRoleLabel("admin")).toBe("管理员");
  });

  describe("pending invite storage", () => {
    const store = new Map<string, string>();

    beforeEach(() => {
      store.clear();
      vi.stubGlobal("sessionStorage", {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("reads and clears the pending invite link id", () => {
      writePendingWorkspaceInvite(linkId);
      expect(store.get(PENDING_WORKSPACE_INVITE_KEY)).toBe(linkId);
      expect(readPendingWorkspaceInvite()).toBe(linkId);
      clearPendingWorkspaceInvite();
      expect(readPendingWorkspaceInvite()).toBeNull();
    });
  });
});
