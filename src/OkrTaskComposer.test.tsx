import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OkrTaskComposer, type OkrTaskCreation } from "./OkrTaskComposer";
import { createDemoBundle } from "./lib/demo";
import { createDemoOkrData } from "./lib/demoOkr";
import { DEFAULT_DATE_TIME_PREFERENCES } from "./lib/dateTimePreferences";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
let container: HTMLDivElement;
let creation: OkrTaskCreation;
const notice = vi.fn();
const openTask = vi.fn();
const keyResults = createDemoOkrData().sets[0]!.objectives[0]!.key_results;
const target = { kind: "key_result" as const, id: keyResults[0]!.id, label: "KR1" };

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const bundle = createDemoBundle();
  creation = {
    formProps: {
      now: new Date("2026-10-21T09:00:00+08:00"),
      dateTimePreferences: DEFAULT_DATE_TIME_PREFERENCES,
      currentUserId: "demo-user", members: bundle.members, labels: bundle.labels,
      labelPermissionLevels: bundle.labelPermissionLevels,
    },
    onCreateTask: vi.fn().mockResolvedValue({ id: "created-task" }),
    onRetryLink: vi.fn().mockResolvedValue(undefined),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  document.body.replaceChildren();
});

async function render(options: { online?: boolean; editable?: boolean; objective?: boolean } = {}) {
  await act(async () => root.render(<QueryClientProvider client={client}>
    <OkrTaskComposer workspaceId="workspace-team" target={options.objective ? { kind: "objective", id: "o-1", label: "O1" } : target}
      keyResults={keyResults} creation={creation} online={options.online ?? true} editable={options.editable ?? true}
      onNotice={notice} onOpenTask={openTask} />
  </QueryClientProvider>));
}

async function input(title: string) {
  await act(async () => {
    const node = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, title);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("OKR quick task creation", () => {
  it("delegates parsed input and KR context to the shared creation operation", async () => {
    await render();
    await input("明天 验收输入框 ~2h");
    await submit();
    expect(creation.onCreateTask).toHaveBeenCalledWith(expect.objectContaining({
      title: "验收输入框", estimateHours: 2, due: expect.objectContaining({ due_is_all_day: true }),
    }), { keyResultId: target.id, objectiveId: keyResults[0]!.objective_id,
      title: keyResults[0]!.title, position: keyResults[0]!.position });
    expect(creation.onRetryLink).not.toHaveBeenCalled();
    expect(container.querySelector("input")!.value).toBe("");
  });

  it.each([{ online: false }, { editable: false }])("blocks writes when %j", async (options) => {
    await render(options);
    expect(container.querySelector("input")!.disabled).toBe(true);
    await input("不应写入");
    await submit();
    expect(creation.onCreateTask).not.toHaveBeenCalled();
    expect(creation.onRetryLink).not.toHaveBeenCalled();
  });

  it("restores the input when task creation fails", async () => {
    vi.mocked(creation.onCreateTask).mockRejectedValue(new Error("保存失败"));
    await render();
    await input("保留输入");
    await submit();
    expect(container.querySelector("input")!.value).toBe("保留输入");
    expect(creation.onRetryLink).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith("保存失败", "error");
  });

  it("retries a failed association without creating a second task and disables retry offline", async () => {
    vi.mocked(creation.onCreateTask).mockResolvedValueOnce({ id: "created-task", okrLinkError: "网络错误" });
    await render();
    await input("只创建一次");
    await submit();
    expect(container.textContent).toContain("待办已创建，尚未关联 KR");
    expect(container.querySelector("input")!.disabled).toBe(true);
    await render({ online: false });
    const retry = [...container.querySelectorAll("button")].find((button) => button.textContent === "重试关联")!;
    expect(retry.disabled).toBe(true);
    await render();
    await act(async () => retry.click());
    expect(creation.onCreateTask).toHaveBeenCalledTimes(1);
    expect(creation.onRetryLink).toHaveBeenCalledTimes(1);
    expect(creation.onRetryLink).toHaveBeenCalledWith("created-task", expect.objectContaining({ keyResultId: target.id }));
    expect(container.querySelector("input")!.disabled).toBe(false);
  });

  it("uses the selected KR when creating from an Objective", async () => {
    await render({ objective: true });
    const select = container.querySelector("select")!;
    await act(async () => {
      select.value = keyResults[1]!.id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await input("关联第二个 KR");
    await submit();
    expect(creation.onCreateTask).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ keyResultId: keyResults[1]!.id }));
  });
});
