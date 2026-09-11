import { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, dehydrate } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OkrWorkspace, ProgressRecordPanel, type ProgressTarget } from "./OkrWorkspace";
import { createDemoBundle } from "./lib/demo";

vi.mock("./lib/supabase", () => ({ supabase: null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let queryClient: QueryClient | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  queryClient?.clear();
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
});

describe("OKR demo without a configured Supabase client", () => {
  it.each([true, false])("renders read-only examples with online=%s without persisting them", async (online) => {
    window.history.replaceState(null, "", "/?demo=1");
    const bundle = createDemoBundle();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onOpenTask = vi.fn();
    await act(async () => root!.render(
      <QueryClientProvider client={queryClient!}>
        <OkrWorkspace
          workspaceId="workspace-team"
          currentUserId="demo-user"
          currentRole="owner"
          members={bundle.members}
          userGroups={bundle.userGroups}
          online={online}
          onNavigate={vi.fn()}
          onOpenTask={onOpenTask}
          onMenu={vi.fn()}
          onNotice={vi.fn()}
        />
      </QueryClientProvider>,
    ));

    expect(container.querySelectorAll('[aria-label="OKR 周期"] option')).toHaveLength(3);
    expect(container.querySelector(".okr-progress-meter")).toBeTruthy();
    expect(container.querySelector(".okr-progress-bounds")).toBeNull();
    expect([...container.querySelectorAll(".okr-card-toolbar-meta")].every((item) => item.textContent === "进度分数记录")).toBe(true);
    expect(container.querySelectorAll(".okr-kr-row")).toHaveLength(4);
    expect([...container.querySelectorAll(".okr-objective-note-label")].map((item) => item.textContent))
      .toEqual(["备注", "备注"]);
    expect(container.querySelectorAll<HTMLTextAreaElement>('[aria-label="备注"]')[0]?.readOnly).toBe(true);
    expect(container.textContent).not.toContain("备注：");
    expect(container.querySelector('[aria-label="编辑 Objective"]')).toBeNull();
    expect([...container.querySelectorAll<HTMLInputElement>('[aria-label="评分"]')]
      .every((input) => input.disabled)).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>(".okr-progress-meter-hit")!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("70%");
    const tasksTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent === "待办清单");
    await act(async () => tasksTab?.click());
    expect(document.querySelector(".okr-linked-task")?.textContent).toContain("完成 AntTodo 项目框架验收");
    await act(async () => document.querySelector<HTMLButtonElement>(".okr-linked-task")?.click());
    expect(onOpenTask).toHaveBeenCalledWith("task-1");
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="关闭 OKR 详情"]')?.click();
    });
    await act(async () => container.querySelectorAll<HTMLButtonElement>(".okr-status-trigger")[0]!.click());
    const statusPopover = document.querySelector(".okr-status-popover");
    expect(statusPopover?.textContent).toContain("高级设置");
    expect(statusPopover?.querySelector('[aria-label="状态"]')).toBeTruthy();
    expect(queryClient.getQueryCache().getAll().every((query) =>
      query.state.status === "pending" && query.state.fetchStatus === "idle")).toBe(true);
    expect(dehydrate(queryClient).queries).toEqual([]);
  });
});

describe("OKR progress records", () => {
  it("opens and focuses the progress composer when its tab is entered", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const target: ProgressTarget = {
      kind: "objective",
      id: "objective-1",
      label: "O1",
      title: "Improve activation",
      startValue: 0,
      targetValue: 100,
      currentValue: 40,
      status: "normal",
      score: null,
      progressMode: "manual",
      statusMode: "manual",
      metricUnit: "percent",
      customUnit: null,
    };
    function EditablePanel() {
      const [composerOpen, setComposerOpen] = useState(false);
      const openComposer = useCallback(() => setComposerOpen(true), []);
      return <ProgressRecordPanel
        target={target}
        records={[]}
        members={[]}
        editable
        value="40"
        status="normal"
        detail=""
        composerOpen={composerOpen}
        submitting={false}
        onValueChange={vi.fn()}
        onStatusChange={vi.fn()}
        onDetailChange={vi.fn()}
        onComposerOpen={openComposer}
        onCancel={() => setComposerOpen(false)}
        onSubmit={vi.fn()}
      />;
    }

    await act(async () => root!.render(<EditablePanel />));

    const composer = container.querySelector(".okr-progress-composer");
    const detailInput = container.querySelector<HTMLTextAreaElement>('[aria-label="记录进展"]');
    expect(composer?.classList.contains("expanded")).toBe(true);
    expect(document.activeElement).toBe(detailInput);
    expect(container.querySelector(".okr-progress-composer-fields")).toBeTruthy();

    await act(async () => container.querySelector<HTMLButtonElement>(".button.secondary")!.click());
    expect(composer?.classList.contains("expanded")).toBe(false);
    expect(container.querySelector(".okr-progress-composer-fields")).toBeNull();
  });
});
