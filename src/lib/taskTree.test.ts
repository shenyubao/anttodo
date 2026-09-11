import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import {
  ancestorChain,
  canAddChild,
  canIndent,
  canOutdent,
  childrenOf,
  flattenTaskTree,
  indentTaskPatch,
  isRootTask,
  nextSiblingPosition,
  outdentTaskPatch,
  siblingReorderPatch,
  applyTaskTreeMove,
  taskDepth,
  taskCollectionProgress,
  taskProgress,
  visibleFlattenedTasks,
} from "./taskTree";

function item(
  id: string,
  position: number,
  parent: string | null = null,
  completed = false,
): Task {
  return {
    id,
    workspace_id: "workspace",
    parent_task_id: parent,
    title: id,
    description: "",
    kind: "todo",
    status: completed ? "completed" : "open",
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
    completed_at: completed ? "2026-08-01T00:00:00.000Z" : null,
    deleted_at: null,
    recurrence: null,
    version: 1,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    external_id: null,
    connector_id: null,
    connector_platform: null,
    label_ids: [],
    participant_ids: [],
    children: [],
    description_mentions: [],
    reminders: [],
    reminder_persistent: false,
    dependencies: [],
  };
}

describe("taskTree", () => {
  const tree = [
    item("a", 0),
    item("b", 1),
    item("a1", 0, "a"),
    item("a2", 1, "a"),
    item("a1a", 0, "a1"),
    item("a1a1", 0, "a1a"),
    item("a1a1a", 0, "a1a1"),
  ];

  it("treats tasks without parent_task_id as roots", () => {
    expect(isRootTask(item("a", 0))).toBe(true);
    expect(isRootTask(item("a1", 0, "a"))).toBe(false);
  });

  it("computes depth from the root task", () => {
    expect(taskDepth(tree, "a")).toBe(1);
    expect(taskDepth(tree, "a1")).toBe(2);
    expect(taskDepth(tree, "a1a")).toBe(3);
    expect(taskDepth(tree, "a1a1")).toBe(4);
    expect(taskDepth(tree, "a1a1a")).toBe(5);
  });

  it("blocks a sixth-level child", () => {
    expect(canAddChild(tree, "a1a1a")).toBe(false);
    expect(canAddChild(tree, "a1a1")).toBe(true);
  });

  it("flattens siblings before descendants of later siblings", () => {
    expect(flattenTaskTree(tree).map((row) => row.task.id)).toEqual([
      "a",
      "a1",
      "a1a",
      "a1a1",
      "a1a1a",
      "a2",
      "b",
    ]);
  });

  it("indents under the previous sibling", () => {
    expect(canIndent(tree, "a2")).toBe(true);
    expect(indentTaskPatch(tree, "a2")).toEqual({
      parent_task_id: "a1",
      position: 1,
    });
    expect(canIndent(tree, "a")).toBe(false);
  });

  it("rejects indent that would exceed max depth", () => {
    const deep = [item("a", 0), item("a1", 0, "a"), item("a1a", 0, "a1"), item("a1a1", 0, "a1a"), item("x", 0, "a1a1"), item("y", 1, "a1a1")];
    expect(canIndent(deep, "y")).toBe(false);
  });

  it("outdents to the next sibling of the parent", () => {
    expect(canOutdent(tree, "a1")).toBe(true);
    expect(outdentTaskPatch(tree, "a1")).toEqual({
      parent_task_id: null,
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
    expect(taskCollectionProgress([item("a", 0, null, true), item("b", 1)])).toEqual({
      completed: 1,
      total: 2,
    });
  });

  it("hides deleted children from the visible tree", () => {
    const deleted = {
      ...item("a2", 1, "a"),
      deleted_at: "2026-08-18T10:16:12.314Z",
    };
    const tasks = [item("a", 0), item("a1", 0, "a"), deleted];
    expect(childrenOf(tasks, "a").map((task) => task.id)).toEqual(["a1"]);
    expect(visibleFlattenedTasks(tasks, "a", new Set()).map((row) => row.task.id)).toEqual(["a1"]);
    expect(nextSiblingPosition(tasks, "a")).toBe(2);
    expect(taskProgress(tasks, "a")).toEqual({ completed: 0, total: 1 });
  });

  it("reorders siblings without changing parent", () => {
    const moved = applyTaskTreeMove(tree, "a2", "a", 0);
    expect(childrenOf(moved.tasks, "a").map((task) => task.id)).toEqual(["a2", "a1"]);
    expect(moved.tasks.find((task) => task.id === "a2")).toMatchObject({
      parent_task_id: "a",
      position: 0,
    });
    expect(moved.tasks.find((task) => task.id === "a1")).toMatchObject({
      parent_task_id: "a",
      position: 1,
    });
    expect(moved.tasks.find((task) => task.id === "a1a")?.parent_task_id).toBe("a1");
    expect(moved.changedIds.sort()).toEqual(["a1", "a2"]);
  });

  it("moves a first sibling to the end", () => {
    const moved = applyTaskTreeMove(tree, "a1", "a", 1);
    expect(childrenOf(moved.tasks, "a").map((task) => task.id)).toEqual(["a2", "a1"]);
    expect(moved.tasks.find((task) => task.id === "a1")?.position).toBe(1);
    expect(moved.tasks.find((task) => task.id === "a2")?.position).toBe(0);
    expect(moved.tasks.find((task) => task.id === "a1a")?.parent_task_id).toBe("a1");
  });

  it("shifts both sibling groups when changing parent", () => {
    const moved = applyTaskTreeMove(tree, "a2", "a1", 1);
    expect(childrenOf(moved.tasks, "a").map((task) => task.id)).toEqual(["a1"]);
    expect(childrenOf(moved.tasks, "a1").map((task) => task.id)).toEqual(["a1a", "a2"]);
    expect(moved.tasks.find((task) => task.id === "a2")).toMatchObject({
      parent_task_id: "a1",
      position: 1,
    });
  });

  it("keeps deleted sibling holes when taking another live task's slot", () => {
    const tasks = [
      item("a", 0),
      item("a1", 0, "a"),
      { ...item("gone", 1, "a"), deleted_at: "2026-08-18T10:16:12.314Z" },
      item("a2", 2, "a"),
    ];
    const moved = applyTaskTreeMove(tasks, "a1", "a", 2);
    expect(childrenOf(moved.tasks, "a").map((task) => task.id)).toEqual(["a2", "a1"]);
    expect(moved.tasks.find((task) => task.id === "a1")?.position).toBe(2);
    expect(moved.tasks.find((task) => task.id === "gone")?.position).toBe(0);
    expect(moved.tasks.find((task) => task.id === "a2")?.position).toBe(1);
  });

  it("builds a same-parent reorder patch and rejects cross-parent drops", () => {
    expect(siblingReorderPatch(tree, "a2", "a1")).toEqual({
      parent_task_id: "a",
      position: 0,
    });
    expect(siblingReorderPatch(tree, "b", "a")).toEqual({
      parent_task_id: null,
      position: 0,
    });
    expect(siblingReorderPatch(tree, "a2", "a2")).toBeNull();
    expect(siblingReorderPatch(tree, "a2", "a1a")).toBeNull();
    expect(siblingReorderPatch(tree, "a2", "missing")).toBeNull();
  });
});
