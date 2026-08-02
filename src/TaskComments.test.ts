import { describe, expect, it } from "vitest";
import { commentRelativeTime, visibleMentionIds } from "./TaskComments";
import type { Member } from "./types";

const members: Member[] = [
  {
    workspace_id: "workspace",
    user_id: "alice",
    role: "member",
    profile: { id: "alice", display_name: "小艾", avatar_url: null },
  },
  {
    workspace_id: "workspace",
    user_id: "bob",
    role: "member",
    profile: { id: "bob", display_name: "小波", avatar_url: null },
  },
];

describe("task comments", () => {
  it("only submits selected mentions whose visible token remains in the body", () => {
    expect(visibleMentionIds("@小艾 请确认", ["alice", "bob", "alice"], members))
      .toEqual(["alice"]);
  });

  it("formats relative time in Chinese", () => {
    expect(commentRelativeTime(
      "2026-08-02T09:59:00.000Z",
      new Date("2026-08-02T10:00:00.000Z"),
    )).toContain("1 分钟");
  });
});
