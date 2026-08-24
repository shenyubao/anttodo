import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTaskContextMenuVariant, TaskContextMenu } from "./TaskContextMenu";
import { DEFAULT_DATE_TIME_PREFERENCES } from "./lib/dateTimePreferences";
import type { Task } from "./types";

const task = (patch: Partial<Task> = {}): Task => ({
  id: "task-1",
  workspace_id: "workspace-1",
  title: "外部待办",
  description: "",
  status: "open",
  priority: "none",
  due_at: null,
  due_start_at: null,
  due_is_all_day: false,
  due_timezone: null,
  assignee_id: null,
  created_by: "user-1",
  completed_at: null,
  deleted_at: null,
  version: 1,
  created_at: "2026-08-20T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
  label_ids: [],
  participant_ids: [],
  children: [],
  external_id: null,
  connector_id: null,
  connector_platform: null,
  parent_task_id: null,
  position: 0,
  cli_assignee: null,
  kind: "todo",
  reminders: [],
  reminder_persistent: false,
  recurrence: null,
  estimate_hours: null,
  actual_hours: null,
  estimate_pomodoros: null,
  actual_pomodoros: null,
  description_mentions: [],
  ...patch,
});

const noopAsync = vi.fn(async () => undefined);

function menuItem(container: HTMLElement, label: string) {
  return [...container.querySelectorAll('[role="menuitem"]')]
    .find((item) => item.textContent?.includes(label)) as HTMLButtonElement | undefined;
}

describe("task context menu", () => {
  let root: Root | null = null;
  const writeText = vi.fn<(value: string) => Promise<void>>(async () => undefined);

  beforeEach(() => {
    writeText.mockReset();
    Object.assign(navigator, { clipboard: { writeText } });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }
    document.body.replaceChildren();
  });

  it("uses a slim variant for connector-synced tasks", () => {
    expect(resolveTaskContextMenuVariant(task())).toBe("default");
    expect(resolveTaskContextMenuVariant(task({
      connector_id: "connector-1",
      connector_platform: "yunxiao",
      external_id: "workitem-1",
    }))).toBe("external");
    expect(resolveTaskContextMenuVariant(task({
      connector_id: "connector-1",
    }), "trash")).toBe("trash");
  });

  it("only shows mount dependency, copy link, and delete for external tasks", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const external = task({
      connector_id: "connector-1",
      connector_platform: "yunxiao",
      external_id: "workitem-1",
    });

    await act(async () => {
      root?.render(
        <TaskContextMenu
          task={external}
          workspaceId="workspace-1"
          x={80}
          y={80}
          online
          now={new Date("2026-08-20T04:00:00.000Z")}
          dateTimePreferences={DEFAULT_DATE_TIME_PREFERENCES}
          onClose={vi.fn()}
          onUpdateTask={noopAsync}
          onSaveTaskSchedule={noopAsync}
          onSaveChildTaskSchedule={noopAsync}
          onCreateTask={noopAsync}
          onCreateChildTask={noopAsync}
          onUpdateChildTask={noopAsync}
          onDeleteChildTask={noopAsync}
          onPurgeTask={noopAsync}
          onExpandChildTasks={vi.fn()}
          onNotice={vi.fn()}
          onAddDependencies={noopAsync}
        />,
      );
    });

    const labels = [...container.querySelectorAll('[role="menuitem"]')]
      .map((item) => item.textContent?.trim());
    expect(labels).toEqual(["挂载依赖任务", "复制链接", "删除"]);
    expect(
      [...container.querySelectorAll('[role="menuitem"]')]
        .find((item) => item.textContent?.includes("删除"))
        ?.hasAttribute("disabled"),
    ).toBe(false);
    expect(container.textContent).not.toContain("添加子级任务");
    expect(container.textContent).not.toContain("创建副本");
    expect(container.textContent).not.toContain("转换为笔记");
    expect(container.querySelector('[aria-label="快速设置日期"]')).toBeNull();
    expect(container.querySelector('[aria-label="设置优先级"]')).toBeNull();
  });

  function renderMenu(props: {
    first: Task;
    second?: Task;
    third?: Task;
    variant?: "default" | "trash";
    onUpdateTask?: (taskId: string, patch: Partial<Task>) => Promise<void>;
    onPurgeTask?: (taskId: string) => Promise<void>;
    onNotice?: (message: string) => void;
    onAddDependencies?: (taskId: string, targets: { taskId: string }[]) => Promise<void>;
  }) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const {
      first,
      second,
      third,
      variant = "default",
      onUpdateTask = noopAsync,
      onPurgeTask = noopAsync,
      onNotice = vi.fn(),
      onAddDependencies = noopAsync,
    } = props;
    const selected = second ? [first, second] : [first];
    return {
      container,
      render: () => root?.render(
        <TaskContextMenu
          task={first}
          selectedTasks={selected}
          workspaceId="workspace-1"
          x={80}
          y={80}
          online
          now={new Date("2026-08-20T04:00:00.000Z")}
          dateTimePreferences={DEFAULT_DATE_TIME_PREFERENCES}
          variant={variant}
          onClose={vi.fn()}
          onUpdateTask={onUpdateTask}
          onSaveTaskSchedule={noopAsync}
          onSaveChildTaskSchedule={noopAsync}
          onCreateTask={noopAsync}
          onCreateChildTask={noopAsync}
          onUpdateChildTask={noopAsync}
          onDeleteChildTask={noopAsync}
          onPurgeTask={onPurgeTask}
          onExpandChildTasks={vi.fn()}
          onNotice={onNotice}
          pickerTasks={[first, ...(second ? [second] : []), ...(third ? [third] : [])]}
          onAddDependencies={onAddDependencies}
        />,
      ),
    };
  }

  it("copies every selected task link", async () => {
    const first = task({ id: "task-1", title: "第一项" });
    const second = task({ id: "task-2", title: "第二项" });
    const onNotice = vi.fn();
    const { container, render } = renderMenu({ first, second, onNotice });

    await act(async () => {
      render();
    });
    await act(async () => {
      menuItem(container, "复制链接")?.click();
    });

    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("/workspaces/workspace-1/tasks/task-1"),
    );
    expect(writeText.mock.calls[0]?.[0]).toContain("/workspaces/workspace-1/tasks/task-2");
    expect(onNotice).toHaveBeenCalledWith("已复制 2 条链接");
  });

  it("deletes every selected task", async () => {
    const first = task({ id: "task-1", title: "第一项" });
    const second = task({ id: "task-2", title: "第二项" });
    const onUpdateTask = vi.fn(async () => undefined);
    const { container, render } = renderMenu({ first, second, onUpdateTask });

    await act(async () => {
      render();
    });
    await act(async () => {
      menuItem(container, "删除")?.click();
    });

    expect(onUpdateTask).toHaveBeenCalledWith("task-1", {
      deleted_at: expect.any(String),
    });
    expect(onUpdateTask).toHaveBeenCalledWith("task-2", {
      deleted_at: expect.any(String),
    });
  });

  it("mounts the chosen dependency onto every selected task", async () => {
    const first = task({ id: "task-1", title: "第一项" });
    const second = task({ id: "task-2", title: "第二项" });
    const third = task({ id: "task-3", title: "依赖项" });
    const onAddDependencies = vi.fn(async () => undefined);
    const { container, render } = renderMenu({
      first,
      second,
      third,
      onAddDependencies,
    });

    await act(async () => {
      render();
    });
    await act(async () => {
      menuItem(container, "挂载依赖任务")?.click();
    });
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((item) => item.textContent?.includes("依赖项"))
        ?.click();
    });
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((item) => item.textContent === "确定")
        ?.click();
    });

    expect(onAddDependencies).toHaveBeenCalledWith("task-1", [{ taskId: "task-3" }]);
    expect(onAddDependencies).toHaveBeenCalledWith("task-2", [{ taskId: "task-3" }]);
  });

  it("shows restore and permanent delete in the trash menu, including connector tasks", async () => {
    const first = task({
      id: "task-1",
      title: "外部待办",
      deleted_at: "2026-08-20T00:00:00.000Z",
      connector_id: "connector-1",
      connector_platform: "yunxiao",
      external_id: "workitem-1",
    });
    const { container, render } = renderMenu({ first, variant: "trash" });

    await act(async () => {
      render();
    });

    const labels = [...container.querySelectorAll('[role="menuitem"]')]
      .map((item) => item.textContent?.trim());
    expect(labels).toEqual(["还原", "彻底删除"]);
  });

  it("restores every selected trashed task", async () => {
    const first = task({ id: "task-1", title: "第一项", deleted_at: "2026-08-20T00:00:00.000Z" });
    const second = task({ id: "task-2", title: "第二项", deleted_at: "2026-08-20T00:00:00.000Z" });
    const onUpdateTask = vi.fn(async () => undefined);
    const { container, render } = renderMenu({ first, second, variant: "trash", onUpdateTask });

    await act(async () => {
      render();
    });
    await act(async () => {
      menuItem(container, "还原")?.click();
    });

    expect(onUpdateTask).toHaveBeenCalledWith("task-1", { deleted_at: null });
    expect(onUpdateTask).toHaveBeenCalledWith("task-2", { deleted_at: null });
  });

  it("permanently deletes every selected trashed task after confirm", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const first = task({
      id: "task-1",
      title: "第一项",
      deleted_at: "2026-08-20T00:00:00.000Z",
    });
    const second = task({
      id: "task-2",
      title: "外部待办",
      deleted_at: "2026-08-20T00:00:00.000Z",
      connector_id: "connector-1",
      connector_platform: "yunxiao",
      external_id: "workitem-2",
    });
    const onPurgeTask = vi.fn(async () => undefined);
    const { container, render } = renderMenu({ first, second, variant: "trash", onPurgeTask });

    await act(async () => {
      render();
    });
    await act(async () => {
      menuItem(container, "彻底删除")?.click();
    });

    expect(confirm).toHaveBeenCalledWith("彻底删除已选择的 2 项？此操作不可撤销。");
    expect(onPurgeTask).toHaveBeenCalledWith("task-1");
    expect(onPurgeTask).toHaveBeenCalledWith("task-2");
    confirm.mockRestore();
  });
});
