import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DragEndEvent } from "@dnd-kit/core";
import { useTaskListTreeDrag } from "./useTaskListTreeDrag";
import { createOptimisticTask } from "./lib/taskCache";

const roots = ["a", "b"].map((id) => createOptimisticTask({ workspaceId: "workspace", userId: "user", title: id, labelIds: [], optimisticId: id }));
const child = createOptimisticTask({ workspaceId: "workspace", userId: "user", title: "child", labelIds: [], optimisticId: "child", parentTaskId: "a" });
const event = { active: { id: "child" }, over: { id: "b", rect: { top: 0, height: 40 } } } as unknown as DragEndEvent;

describe("list tree move lifecycle", () => {
  const container = document.createElement("div");
  let root: ReturnType<typeof createRoot>;
  let drag: ReturnType<typeof useTaskListTreeDrag>;
  afterEach(async () => { await act(async () => root?.unmount()); });

  async function mount(onUpdate: Parameters<typeof useTaskListTreeDrag>[0]["onUpdate"], enabled = true, manualOrder = true) {
    function Harness() {
      drag = useTaskListTreeDrag({ tasks: [...roots, child], groups: [{ id: "all", title: "", tasks: roots }],
        listKey: "all", enabled, manualOrder, canEdit: () => true,
        canPersistOrder: (tasks) => tasks.map((task) => task.id), onUpdate });
      return null;
    }
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
  }

  it("submits promotion and target list placement as one operation", async () => {
    const update = vi.fn(async () => {});
    await mount(update);
    await act(async () => { await drag.finish(event); });
    expect(update).toHaveBeenCalledWith("child", { parent_task_id: null, position: 0 }, {
      treeMove: true, listMove: { listKey: "all", sectionId: null, taskIds: ["a", "child", "b"] },
    });
  });
  it("holds pending state, ignores duplicate drops and clears pending after rejection", async () => {
    let reject!: (error: Error) => void;
    const update = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    await mount(update);
    let completion!: Promise<boolean>;
    await act(async () => { completion = drag.finish(event); });
    expect(drag.value.pending).toBe(true);
    await act(async () => { await drag.finish(event); });
    expect(update).toHaveBeenCalledTimes(1);
    const rejection = expect(completion).rejects.toThrow("permission");
    await act(async () => { reject(new Error("permission")); await rejection; });
    expect(drag.value.pending).toBe(false);
    expect(drag.value.expandedIds.size).toBe(0);
  });
  it("keeps automatic sorting and does not submit any list placement", async () => {
    const update = vi.fn(async () => {});
    await mount(update, true, false);
    await act(async () => { await drag.finish(event); });
    expect(update).toHaveBeenCalledWith("child", { parent_task_id: null, position: 0 }, { treeMove: true, listMove: undefined });
  });
  it("never submits writes while offline", async () => {
    const update = vi.fn(async () => {});
    await mount(update, false);
    await act(async () => { expect(await drag.finish(event)).toBe(false); });
    expect(update).not.toHaveBeenCalled();
  });
});
