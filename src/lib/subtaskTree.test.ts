import { describe, expect, it } from "vitest";
import type { Subtask } from "../types";
import {
  ancestorChain,
  canAddChild,
  canIndent,
  canOutdent,
  flattenSubtaskTree,
  indentSubtaskPatch,
  nextSiblingPosition,
  outdentSubtaskPatch,
  subtaskDepth,
  subtaskProgress,
} from "./subtaskTree";

function item(
  id: string,
  position: number,
  parent: string | null = null,
  completed = false,
): Subtask {
  return {
    id,
    task_id: "task",
    parent_subtask_id: parent,
    title: id,
    description: "",
    completed,
    position,
    priority: "none",
    due_at: null,
    due_start_at: null,
    due_is_all_day: false,
    due_timezone: null,
    estimate_hours: null,
    actual_hours: null,
    estimate_pomodoros: null,
    actual_pomodoros: null,
    assignee_id: null,
    cli_assignee: null,
    created_by: "u1",
    reminders: [],
    reminder_persistent: false,
    dependencies: [],
  };
}

describe("subtaskTree", () => {
  const tree = [
    item("a", 0),
    item("b", 1),
    item("a1", 0, "a"),
    item("a2", 1, "a"),
    item("a1a", 0, "a1"),
    item("a1a1", 0, "a1a"),
  ];

  it("computes depth from the root task", () => {
    expect(subtaskDepth(tree, null)).toBe(1);
    expect(subtaskDepth(tree, "a")).toBe(2);
    expect(subtaskDepth(tree, "a1")).toBe(3);
    expect(subtaskDepth(tree, "a1a")).toBe(4);
    expect(subtaskDepth(tree, "a1a1")).toBe(5);
  });

  it("blocks a sixth-level child", () => {
    expect(canAddChild(tree, "a1a1")).toBe(false);
    expect(canAddChild(tree, "a1a")).toBe(true);
  });

  it("flattens siblings before descendants of later siblings", () => {
    expect(flattenSubtaskTree(tree).map((row) => row.subtask.id)).toEqual([
      "a",
      "a1",
      "a1a",
      "a1a1",
      "a2",
      "b",
    ]);
  });

  it("indents under the previous sibling", () => {
    expect(canIndent(tree, "a2")).toBe(true);
    expect(indentSubtaskPatch(tree, "a2")).toEqual({
      parent_subtask_id: "a1",
      position: 1,
    });
    expect(canIndent(tree, "a")).toBe(false);
  });

  it("rejects indent that would exceed max depth", () => {
    const deep = [item("a", 0), item("a1", 0, "a"), item("a1a", 0, "a1"), item("x", 0, "a1a"), item("y", 1, "a1a")];
    expect(canIndent(deep, "y")).toBe(false);
  });

  it("outdents to the next sibling of the parent", () => {
    expect(canOutdent(tree, "a1")).toBe(true);
    expect(outdentSubtaskPatch(tree, "a1")).toEqual({
      parent_subtask_id: null,
      position: 1,
    });
    expect(canOutdent(tree, "a")).toBe(false);
  });

  it("places new siblings after the last child", () => {
    expect(nextSiblingPosition(tree, "a")).toBe(2);
    expect(nextSiblingPosition(tree, null)).toBe(2);
  });

  it("returns the ancestor chain including the node", () => {
    expect(ancestorChain(tree, "a1a").map((row) => row.id)).toEqual(["a", "a1", "a1a"]);
  });

  it("counts completed descendants in the flat list", () => {
    expect(subtaskProgress([item("a", 0, null, true), item("b", 1)])).toEqual({
      completed: 1,
      total: 2,
    });
  });
});
