import { describe, expect, it } from "vitest";
import { detectMentionQuery, filterMentionCandidates, visibleMentionIds } from "./mentions";
import type { Member } from "../types";

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
  {
    workspace_id: "workspace",
    user_id: "self",
    role: "member",
    profile: { id: "self", display_name: "自己", avatar_url: null },
  },
];

describe("mentions", () => {
  it("detects an @query at the caret", () => {
    expect(detectMentionQuery("请看 @小", 5)).toEqual({ start: 3, query: "小" });
    expect(detectMentionQuery("请看 @小 艾", 7)).toBeNull();
    expect(detectMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("only keeps selected mentions still present as @tokens", () => {
    expect(visibleMentionIds("@小艾 请确认", ["alice", "bob", "alice"], members))
      .toEqual(["alice"]);
  });

  it("filters candidates by permission set and query", () => {
    expect(filterMentionCandidates({
      members,
      candidateIds: ["alice", "bob", "self"],
      currentUserId: "self",
      query: "小",
    }).map((member) => member.user_id)).toEqual(["alice", "bob"]);
  });
});
