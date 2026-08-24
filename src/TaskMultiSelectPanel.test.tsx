import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskMultiSelectPanel } from "./TaskMultiSelectPanel";
import { createDemoBundle } from "./lib/demo";
import { DEFAULT_DATE_TIME_PREFERENCES } from "./lib/dateTimePreferences";

describe("TaskMultiSelectPanel", () => {
  let root: Root | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }
    document.body.replaceChildren();
  });

  it("shows the selected count and Dida-style bulk actions", async () => {
    const bundle = createDemoBundle();
    const tasks = bundle.tasks.filter((task) => !task.parent_task_id).slice(0, 3);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TaskMultiSelectPanel
          tasks={tasks}
          bundle={bundle}
          currentUserId="demo-user"
          online
          now={new Date("2026-08-20T04:00:00.000Z")}
          dateTimePreferences={DEFAULT_DATE_TIME_PREFERENCES}
          aiWorkSettings={{
            user_id: "demo-user",
            workspace_id: "workspace-team",
            cli_tools: [],
            default_working_path: null,
          }}
          isTrashView={false}
          canEditTask={() => true}
          canCompleteTask={() => true}
          onSaveSchedule={vi.fn(async () => undefined)}
          onSetPriority={vi.fn(async () => undefined)}
          onToggleLabel={vi.fn(async () => undefined)}
          onComplete={vi.fn(async () => undefined)}
          onDelete={vi.fn(async () => undefined)}
          onRestore={vi.fn(async () => undefined)}
          onPurge={vi.fn(async () => undefined)}
          onPin={vi.fn(async () => undefined)}
          onLinkParent={vi.fn(async () => undefined)}
          onMerge={vi.fn(async () => undefined)}
          onDuplicate={vi.fn(async () => undefined)}
          onConvertToNote={vi.fn(async () => undefined)}
          onCopyText={vi.fn(async () => undefined)}
          onClose={vi.fn()}
        />,
      );
    });

    const panel = container.querySelector(".task-multi-select");
    expect(panel?.getAttribute("aria-label")).toBe(`已选择 ${tasks.length} 项`);
    expect(container.textContent).toContain(`已选择 ${tasks.length} 项`);
    expect(container.textContent).toContain("取消");
    expect(container.querySelector('[aria-label="清单"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="标签"]')).toBeTruthy();
    expect(container.textContent).toContain("完成");
    expect(container.textContent).toContain("置顶");
    expect(container.textContent).toContain("关联主任务");
    expect(container.textContent).toContain("合并");
    expect(container.textContent).toContain("创建副本");
    expect(container.textContent).toContain("转换为笔记");
    expect(container.textContent).toContain("复制文本");
    expect(container.textContent).toContain("删除");
    expect(container.querySelector('[aria-label="完成"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="移至回收站"]')).toBeTruthy();
  });

  it("keeps delete and labels available for connector-synced tasks", async () => {
    const bundle = createDemoBundle();
    const tasks = bundle.tasks.filter((task) => !task.parent_task_id).slice(0, 2).map((task) => ({
      ...task,
      connector_id: "connector-1",
      connector_platform: "yunxiao" as const,
      external_id: `workitem-${task.id}`,
    }));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TaskMultiSelectPanel
          tasks={tasks}
          bundle={bundle}
          currentUserId="demo-user"
          online
          now={new Date("2026-08-20T04:00:00.000Z")}
          dateTimePreferences={DEFAULT_DATE_TIME_PREFERENCES}
          aiWorkSettings={{
            user_id: "demo-user",
            workspace_id: "workspace-team",
            cli_tools: [],
            default_working_path: null,
          }}
          isTrashView={false}
          canEditTask={() => false}
          canOrganizeTask={() => true}
          canCompleteTask={() => false}
          onSaveSchedule={vi.fn(async () => undefined)}
          onSetPriority={vi.fn(async () => undefined)}
          onToggleLabel={vi.fn(async () => undefined)}
          onComplete={vi.fn(async () => undefined)}
          onDelete={vi.fn(async () => undefined)}
          onRestore={vi.fn(async () => undefined)}
          onPurge={vi.fn(async () => undefined)}
          onPin={vi.fn(async () => undefined)}
          onLinkParent={vi.fn(async () => undefined)}
          onMerge={vi.fn(async () => undefined)}
          onDuplicate={vi.fn(async () => undefined)}
          onConvertToNote={vi.fn(async () => undefined)}
          onCopyText={vi.fn(async () => undefined)}
          onClose={vi.fn()}
        />,
      );
    });

    expect(container.querySelector('[aria-label="清单"]')?.hasAttribute("disabled")).toBe(false);
    expect(container.querySelector('[aria-label="标签"]')?.hasAttribute("disabled")).toBe(false);
    expect(container.querySelector('[aria-label="移至回收站"]')?.hasAttribute("disabled")).toBe(false);
    expect(container.querySelector('[aria-label="完成"]')?.hasAttribute("disabled")).toBe(true);
  });

  it("shows restore and permanent delete in the trash bulk panel", async () => {
    const bundle = createDemoBundle();
    const tasks = bundle.tasks.filter((task) => !task.parent_task_id).slice(0, 2).map((task) => ({
      ...task,
      deleted_at: "2026-08-20T00:00:00.000Z",
    }));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onRestore = vi.fn(async () => undefined);
    const onPurge = vi.fn(async () => undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    await act(async () => {
      root?.render(
        <TaskMultiSelectPanel
          tasks={tasks}
          bundle={bundle}
          currentUserId="demo-user"
          online
          now={new Date("2026-08-20T04:00:00.000Z")}
          dateTimePreferences={DEFAULT_DATE_TIME_PREFERENCES}
          aiWorkSettings={{
            user_id: "demo-user",
            workspace_id: "workspace-team",
            cli_tools: [],
            default_working_path: null,
          }}
          isTrashView
          canEditTask={() => true}
          canCompleteTask={() => true}
          onSaveSchedule={vi.fn(async () => undefined)}
          onSetPriority={vi.fn(async () => undefined)}
          onToggleLabel={vi.fn(async () => undefined)}
          onComplete={vi.fn(async () => undefined)}
          onDelete={vi.fn(async () => undefined)}
          onRestore={onRestore}
          onPurge={onPurge}
          onPin={vi.fn(async () => undefined)}
          onLinkParent={vi.fn(async () => undefined)}
          onMerge={vi.fn(async () => undefined)}
          onDuplicate={vi.fn(async () => undefined)}
          onConvertToNote={vi.fn(async () => undefined)}
          onCopyText={vi.fn(async () => undefined)}
          onClose={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("恢复");
    expect(container.textContent).toContain("彻底删除");
    expect(container.textContent).not.toContain("完成");
    expect(container.textContent).not.toContain("移至回收站");

    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent?.includes("恢复"))
        ?.click();
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent?.includes("彻底删除"))
        ?.click();
    });

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(`彻底删除已选择的 ${tasks.length} 项？此操作不可撤销。`);
    expect(onPurge).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });
});
