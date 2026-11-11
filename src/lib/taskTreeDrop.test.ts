import { describe, expect, it } from "vitest";
import { createOptimisticTask } from "./taskCache";
import { resolveTaskTreeDrop, taskTreeMoveError, type TaskDropPlacement } from "./taskTreeDrop";
import type { Task } from "../types";

const item = (id: string, parent: string | null = null, position = 0) => createOptimisticTask({
  workspaceId: "workspace", userId: "user", title: id, labelIds: [],
  parentTaskId: parent, optimisticId: id, position,
});

describe("list tree drop intent", () => {
  const tasks = [item("a"), item("a1", "a"), item("a2", "a", 1), item("nested", "a1"), item("b", null, 1), item("b1", "b")];
  const resolve = (taskId: string, overId: string, placement: TaskDropPlacement, tree = tasks, canEdit = (_task: Task) => true) =>
    resolveTaskTreeDrop({ tasks: tree, taskId, overId, placement, canEdit });

  it("promotes a child at a root insertion line", () => {
    expect(resolve("a1", "b", "before")).toMatchObject({ parentTaskId: null, position: 1, depth: 1, reason: null, label: "提升为顶级任务" });
  });
  it("moves into another root or a nested task", () => {
    expect(resolve("a1", "b", "inside")).toMatchObject({ parentTaskId: "b", position: 1, reason: null });
    expect(resolve("a2", "b1", "inside")).toMatchObject({ parentTaskId: "b1", position: 0, depth: 3, reason: null });
  });
  it("inserts alongside another parent's child", () => {
    expect(resolve("a1", "b1", "after")).toMatchObject({ parentTaskId: "b", position: 1, reason: null });
  });
  it("closes the old sibling slot before calculating before/after positions", () => {
    expect(resolve("a1", "a2", "before")?.position).toBe(0);
    expect(resolve("a1", "a2", "after")?.position).toBe(1);
    expect(resolve("a2", "a1", "before")?.position).toBe(0);
    expect(resolve("a1", "a", "inside")?.position).toBe(1);
  });
  it("rejects the source's descendants and checks full subtree height", () => {
    expect(resolve("a1", "nested", "inside")?.reason).toContain("自己");
    const deep = [...tasks, item("b2", "b1"), item("b3", "b2")];
    expect(resolve("a1", "b3", "inside", deep)?.reason).toContain("五层");
    expect(resolve("a2", "b3", "inside", deep)?.reason).toBeNull();
  });
  it("checks both source and destination permissions", () => {
    expect(resolve("a1", "b", "inside", tasks, (task) => task.id !== "b")?.reason).toContain("权限");
    expect(resolve("a1", "b1", "before", tasks, (task) => task.id !== "b")?.reason).toContain("权限");
    expect(resolve("a1", "b", "before", tasks, (task) => task.id !== "b")?.reason).toBeNull();
  });
  it("rejects notes as parents, external parents, trash and different workspaces", () => {
    for (const patch of [{ kind: "note" as const }, { connector_id: "connector" }, { deleted_at: "2026-10-22" }, { workspace_id: "other" }]) {
      expect(resolve("a1", "b", "inside", tasks.map((task) => task.id === "b" ? { ...task, ...patch } : task))?.reason).toBeTruthy();
    }
    expect(resolve("a1", "a1", "inside")).toBeNull();
  });
  it("keeps remote permission and concurrent-update errors understandable", () => {
    expect(taskTreeMoveError({ message: "Move would remove task visibility" })).toContain("参与者");
    expect(taskTreeMoveError(new Error("Task changed; refresh and retry"))).toContain("刷新");
  });
});
