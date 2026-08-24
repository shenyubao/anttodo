import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CalendarTaskCreatePopover,
  type CalendarTaskDraft,
} from "./CalendarTaskCreatePopover";
import { DEFAULT_DATE_TIME_PREFERENCES } from "./lib/dateTimePreferences";
import type { WorkspaceBundle } from "./types";

const bundle = {
  labels: [{
    id: "label-1",
    workspace_id: "workspace-1",
    parent_id: null,
    name: "产品研发",
    color: "#4772fa",
    kind: "team",
    view_scope: "all",
    manage_scope: "all",
    inherit_permissions: false,
    position: 0,
    created_by: "user-1",
  }],
  userLabelOrder: [],
  labelPermissionLevels: { "label-1": 2 },
} as unknown as WorkspaceBundle;

describe("CalendarTaskCreatePopover", () => {
  let root: Root | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }
    document.body.replaceChildren();
  });

  function renderPopover(options?: {
    online?: boolean;
    onCreate?: (draft: CalendarTaskDraft) => Promise<void>;
  }) {
    const container = document.createElement("div");
    const anchor = document.createElement("button");
    anchor.getBoundingClientRect = () => ({
      x: 200,
      y: 20,
      top: 20,
      right: 230,
      bottom: 50,
      left: 200,
      width: 30,
      height: 30,
      toJSON: () => ({}),
    });
    document.body.append(container, anchor);
    root = createRoot(container);
    const onCreate = options?.onCreate ?? vi.fn(async () => undefined);
    const onClose = vi.fn();
    const onNotice = vi.fn();
    return {
      onCreate,
      onClose,
      onNotice,
      render: () => root?.render(
        <CalendarTaskCreatePopover
          anchor={anchor}
          bundle={bundle}
          online={options?.online ?? true}
          now={new Date("2026-08-24T04:00:00.000Z")}
          dateTimePreferences={DEFAULT_DATE_TIME_PREFERENCES}
          onCreate={onCreate}
          onClose={onClose}
          onNotice={onNotice}
        />,
      ),
    };
  }

  async function fillTitle(value: string) {
    const title = document.querySelector('[aria-label="任务标题"]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(title, value);
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return title;
  }

  it("discards an empty draft when Escape closes the popover", async () => {
    const view = renderPopover();
    await act(async () => view.render());

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(view.onCreate).not.toHaveBeenCalled();
    expect(view.onClose).toHaveBeenCalledTimes(1);
  });

  it("moves Enter from the single-line title into the description", async () => {
    const view = renderPopover();
    await act(async () => view.render());
    const title = await fillTitle("第一行\n第二行");
    const description = document.querySelector(
      '[aria-label="任务描述"]',
    ) as HTMLTextAreaElement;

    await act(async () => {
      title.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(title.value).toBe("第一行 第二行");
    expect(document.activeElement).toBe(description);
  });

  it("creates a trimmed draft exactly once when clicking outside", async () => {
    let resolveCreate: (() => void) | null = null;
    const onCreate = vi.fn(() => new Promise<void>((resolve) => {
      resolveCreate = resolve;
    }));
    const view = renderPopover({ onCreate });
    await act(async () => view.render());
    await fillTitle("  日历快捷任务  ");

    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      title: "日历快捷任务",
      description: "",
      priority: "low",
      labelIds: [],
      schedulePatch: expect.objectContaining({ due_is_all_day: true }),
    }));

    await act(async () => resolveCreate?.());
    expect(view.onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft open after creation fails", async () => {
    const view = renderPopover({
      onCreate: vi.fn(async () => {
        throw new Error("服务暂不可用");
      }),
    });
    await act(async () => view.render());
    const title = await fillTitle("保留这条草稿");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(view.onClose).not.toHaveBeenCalled();
    expect(view.onNotice).toHaveBeenCalledWith("服务暂不可用");
    expect(document.querySelector('[role="dialog"][aria-label="创建任务"]')).not.toBeNull();
    expect(title.value).toBe("保留这条草稿");
  });

  it("does not write a non-empty draft while offline", async () => {
    const view = renderPopover({ online: false });
    await act(async () => view.render());
    await fillTitle("离线草稿");

    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(view.onCreate).not.toHaveBeenCalled();
    expect(view.onClose).not.toHaveBeenCalled();
    expect(view.onNotice).toHaveBeenCalledWith("离线模式下不可创建任务");
  });
});
