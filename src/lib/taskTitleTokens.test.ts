import { describe, expect, it } from "vitest";
import {
  applyTitleTokenSelection,
  detectTitleTokenAtCaret,
  filterAssigneeCandidates,
  filterLabelCandidates,
  mergeLabelIds,
  memberDisplayName,
} from "./taskTitleTokens";
import type { Label, Member } from "../types";

const members: Member[] = [
  {
    workspace_id: "w",
    user_id: "u1",
    role: "owner",
    profile: { id: "u1", display_name: "张三", avatar_url: null },
  },
  {
    workspace_id: "w",
    user_id: "u2",
    role: "member",
    profile: { id: "u2", display_name: "李四", avatar_url: null },
  },
  {
    workspace_id: "w",
    user_id: "u3",
    role: "member",
    profile: { id: "u3", display_name: "Alice", avatar_url: null },
  },
];

const labels: Label[] = [
  {
    id: "l1",
    workspace_id: "w",
    parent_id: null,
    name: "工作",
    color: "#4ca1ff",
    kind: "team",
    view_scope: "all",
    manage_scope: "all",
    inherit_permissions: true,
    position: 0,
    created_by: "u1",
  },
  {
    id: "l2",
    workspace_id: "w",
    parent_id: null,
    name: "生活",
    color: "#35d870",
    kind: "private",
    view_scope: "all",
    manage_scope: "all",
    inherit_permissions: true,
    position: 1,
    created_by: "u1",
  },
  {
    id: "l3",
    workspace_id: "w",
    parent_id: null,
    name: "只读",
    color: "#ff6161",
    kind: "team",
    view_scope: "all",
    manage_scope: "all",
    inherit_permissions: true,
    position: 2,
    created_by: "u1",
  },
];

describe("detectTitleTokenAtCaret", () => {
  const both = { assignee: true, labels: true };

  it("detects @ at start and after whitespace", () => {
    expect(detectTitleTokenAtCaret("@", 1, both)).toEqual({
      kind: "assignee",
      start: 0,
      query: "",
    });
    expect(detectTitleTokenAtCaret("写文档 @张", 6, both)).toEqual({
      kind: "assignee",
      start: 4,
      query: "张",
    });
  });

  it("detects # for labels", () => {
    expect(detectTitleTokenAtCaret("任务 #工", 5, both)).toEqual({
      kind: "label",
      start: 3,
      query: "工",
    });
  });

  it("ignores disabled features", () => {
    expect(detectTitleTokenAtCaret("任务 #工", 5, { assignee: true, labels: false })).toBeNull();
    expect(detectTitleTokenAtCaret("@张", 2, { assignee: false, labels: true })).toBeNull();
  });

  it("does not match mid-word", () => {
    expect(detectTitleTokenAtCaret("email@x", 7, both)).toBeNull();
    expect(detectTitleTokenAtCaret("c#code", 6, both)).toBeNull();
  });

  it("prefers the token at caret over earlier ones", () => {
    const value = "@张 #工";
    expect(detectTitleTokenAtCaret(value, value.length, both)?.kind).toBe("label");
    expect(detectTitleTokenAtCaret(value, 2, both)?.kind).toBe("assignee");
  });
});

describe("applyTitleTokenSelection", () => {
  it("strips the trigger and query", () => {
    expect(applyTitleTokenSelection("写文档 @张", 6, {
      kind: "assignee",
      start: 4,
      query: "张",
    })).toEqual({ title: "写文档 ", caret: 4 });
  });

  it("also strips a trailing space after the query", () => {
    expect(applyTitleTokenSelection("任务 #工作 ", 7, {
      kind: "label",
      start: 3,
      query: "工作",
    })).toEqual({ title: "任务 ", caret: 3 });
  });
});

describe("filterAssigneeCandidates", () => {
  it("filters by display name and prioritizes current user", () => {
    const result = filterAssigneeCandidates(members, "u2", "");
    expect(result[0]?.user_id).toBe("u2");
    expect(result.map((member) => member.user_id).sort()).toEqual(["u1", "u2", "u3"]);
    expect(filterAssigneeCandidates(members, "u1", "李").map((m) => m.user_id)).toEqual(["u2"]);
    expect(filterAssigneeCandidates(members, "u1", "ALICE").map((m) => m.user_id)).toEqual(["u3"]);
  });
});

describe("filterLabelCandidates", () => {
  it("requires manage permission and excludes selected ids", () => {
    const result = filterLabelCandidates(
      labels,
      { l1: 2, l2: 2, l3: 1 },
      "",
      undefined,
      ["l1"],
    );
    expect(result.map((label) => label.id)).toEqual(["l2"]);
  });

  it("filters by name case-insensitively", () => {
    expect(
      filterLabelCandidates(labels, { l1: 2, l2: 2, l3: 2 }, "生").map((label) => label.id),
    ).toEqual(["l2"]);
  });
});

describe("mergeLabelIds", () => {
  it("dedupes while preserving order", () => {
    expect(mergeLabelIds(["a", "b"], ["b", "c", "a"])).toEqual(["a", "b", "c"]);
  });
});

describe("memberDisplayName", () => {
  it("falls back when profile is missing", () => {
    expect(memberDisplayName({ workspace_id: "w", user_id: "x", role: "member" })).toBe(
      "团队成员",
    );
  });
});
