import { describe, expect, it } from "vitest";
import {
  buildWorkspaceInviteUrl,
  higherWorkspaceRole,
  workspaceInviteIdFromPath,
  workspaceInviteRoleLabel,
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
});
