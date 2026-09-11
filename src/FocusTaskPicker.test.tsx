import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoBundle } from "./lib/demo";
import { FocusTaskPicker } from "./FocusTaskPicker";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

describe("FocusTaskPicker generic multi mode", () => {
  it("selects several task ids and confirms them without dependency semantics", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const tasks = createDemoBundle().tasks.filter((task) => !task.parent_task_id).slice(0, 2);
    const onConfirmTaskIds = vi.fn();
    const onTimeChange = vi.fn();
    const onAssigneeChange = vi.fn();
    await act(async () => root!.render(
      <FocusTaskPicker
        open
        mode="multi"
        title="选择周报待办"
        tasks={tasks}
        selectedTaskId={null}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
        onConfirmTaskIds={onConfirmTaskIds}
        filters={[
          {
            id: "time",
            label: "时间",
            value: "through_this_week",
            options: [
              { value: "through_this_week", label: "截止本周" },
              { value: "all", label: "全部" },
            ],
            onChange: onTimeChange,
          },
          {
            id: "assignee",
            label: "指派人",
            value: "me",
            options: [
              { value: "me", label: "指派我" },
              { value: "unassigned", label: "无指派" },
            ],
            onChange: onAssigneeChange,
          },
        ]}
        anchorPoint={{ left: 20, top: 20 }}
      />,
    ));
    const rows = [...document.querySelectorAll<HTMLButtonElement>(".focus-task-picker-item")];
    const timeFilter = document.querySelector<HTMLSelectElement>('[aria-label="时间筛选"]')!;
    const assigneeFilter = document.querySelector<HTMLSelectElement>('[aria-label="指派人筛选"]')!;
    await act(async () => {
      timeFilter.value = "all";
      timeFilter.dispatchEvent(new Event("change", { bubbles: true }));
      assigneeFilter.value = "unassigned";
      assigneeFilter.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onTimeChange).toHaveBeenCalledWith("all");
    expect(onAssigneeChange).toHaveBeenCalledWith("unassigned");
    await act(async () => rows[0]?.click());
    await act(async () => rows[1]?.click());
    await act(async () => document.querySelector<HTMLButtonElement>(".focus-task-picker-footer .primary")?.click());
    expect(onConfirmTaskIds).toHaveBeenCalledWith(tasks.map((task) => task.id));
    expect(document.querySelector('[aria-label="选择周报待办"]')).toBeTruthy();
  });
});
