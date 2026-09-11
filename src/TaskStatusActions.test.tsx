import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoBundle } from "./lib/demo";
import type { Task } from "./types";
import { TaskStatusActionsProvider, TaskStatusMenuItems } from "./TaskStatusActions";
import { NoticeToast, useNotice } from "./NoticeToast";
import { TaskStatusIcon } from "./TaskStatusIcon";
import { TaskStatusConflict, type TaskStatusRecord } from "./lib/taskStatus";

let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.useRealTimers(); });

const base = createDemoBundle().tasks.find((task) => task.kind === "todo" && task.status === "open")!;
async function mount(options: { tasks?: Task[]; online?: boolean; deny?: boolean; failAbandon?: string; conflictUndo?: string; retryUndo?: string } = {}) {
  const writes = vi.fn();
  const records = (options.tasks ?? [base]).map((task) => ({ ...task }));
  function Harness() {
    const [tasks, setTasks] = useState(records);
    const [online, setOnline] = useState(options.online ?? true);
    const { notice, noticeTone, noticeOptions, setNotice } = useNotice();
    return <TaskStatusActionsProvider tasks={tasks} online={online} canEdit={() => !options.deny} onNotice={setNotice}
      write={async (expected, status) => {
        writes(expected.id, status, expected.version);
        if (status === "cancelled" && expected.id === options.failAbandon) throw new Error("write failed");
        if (status === "open" && expected.id === options.conflictUndo) throw new TaskStatusConflict();
        if (status === "open" && expected.id === options.retryUndo) throw new Error("network");
        const saved: TaskStatusRecord = { id: expected.id, status, completed_at: null, version: expected.version + 1, updated_at: "saved" };
        setTasks((current) => current.map((task) => task.id === saved.id ? { ...task, ...saved } : task));
        return saved;
      }}>
      <TaskStatusMenuItems tasks={tasks} />
      <button onClick={() => setOnline(false)}>offline</button>
      <button onClick={() => setNotice("new notice")}>replace notice</button>
      {tasks.map((task) => <TaskStatusIcon key={task.id} status={task.status} />)}
      {notice && <NoticeToast key={noticeOptions.id} message={notice} tone={noticeTone} options={noticeOptions} online={online} onNotice={setNotice} onDismiss={() => setNotice("")} />}
    </TaskStatusActionsProvider>;
  }
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<Harness />));
  return { container, writes };
}
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find((button) => button.textContent === text || button.getAttribute("aria-label") === text)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}

describe("abandon and undo", () => {
  it("shows a cross and undo, then reopens without a completion tick", async () => {
    const { writes } = await mount();
    await click("放弃");
    expect(document.querySelector('[data-task-status="cancelled"]')).toBeTruthy();
    expect(document.querySelector(".toast")?.textContent).toBe("任务已放弃");
    await click("撤销放弃");
    expect(writes.mock.calls.map((args) => args[1])).toEqual(["cancelled", "open"]);
    expect(document.querySelector('[data-task-status="cancelled"]')).toBeNull();
    expect(document.querySelector(".toast")?.textContent).toBe("已撤销放弃");
  });

  it("undoes only successful items and never retries a version conflict", async () => {
    const tasks = [base, { ...base, id: "failed" }, { ...base, id: "conflict" }];
    const { writes } = await mount({ tasks, failAbandon: "failed", conflictUndo: "conflict" });
    await click("放弃");
    expect(document.querySelector(".toast")?.textContent).toContain("已放弃 2 项任务，1 项失败");
    await click("撤销放弃");
    expect(writes.mock.calls.filter((args) => args[1] === "open").map((args) => args[0])).toEqual([base.id, "conflict"]);
    expect(document.querySelector('[aria-label="撤销放弃"]')).toBeNull();
  });

  it("keeps only retryable failures in the next undo action", async () => {
    const { writes } = await mount({ tasks: [base, { ...base, id: "retry" }], retryUndo: "retry" });
    await click("放弃"); await click("撤销放弃"); await click("撤销放弃");
    expect(writes.mock.calls.filter((args) => args[1] === "open").map((args) => args[0])).toEqual([base.id, "retry", "retry"]);
  });

  it("disables status writes and undo offline", async () => {
    const { writes } = await mount(); await click("放弃"); await click("offline");
    const undo = document.querySelector<HTMLButtonElement>('[aria-label="撤销放弃"]')!;
    expect(undo.disabled).toBe(true); await click("撤销放弃"); expect(writes).toHaveBeenCalledTimes(1);
  });

  it("disables actions without edit permission", async () => {
    const { writes } = await mount({ deny: true }); await click("放弃"); expect(writes).not.toHaveBeenCalled();
  });

  it("discards undo when another notice replaces it", async () => {
    await mount(); await click("放弃"); await click("replace notice");
    expect(document.querySelector('[aria-label="撤销放弃"]')).toBeNull();
  });

  it("expires after eight unpaused seconds but keeps restart available", async () => {
    vi.useFakeTimers(); await mount(); await click("放弃");
    await act(async () => { vi.advanceTimersByTime(3000); });
    const toast = document.querySelector(".toast")!;
    await act(async () => { toast.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(document.querySelector(".toast")).toBeTruthy();
    await act(async () => { toast.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })); });
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(document.querySelector(".toast")).toBeNull();
    await click("重新开始"); expect(document.querySelector('[data-task-status="cancelled"]')).toBeNull();
  });
});
