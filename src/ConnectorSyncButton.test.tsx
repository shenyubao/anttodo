import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorSyncButton } from "./ConnectorSyncButton";
import type { Connector } from "./types";

const { invokeConnectorSync } = vi.hoisted(() => ({
  invokeConnectorSync: vi.fn(async () => undefined),
}));

vi.mock("./lib/connectorAdmin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/connectorAdmin")>();
  return { ...actual, invokeConnectorSync };
});

const yunxiao = {
  id: "connector-yunxiao",
  workspace_id: "workspace-prod",
  type: "yunxiao",
  name: "云效工作项同步",
  enabled: true,
  schedule_minutes: 30,
  public_config: {},
  target_label_id: "label-1",
  credential_hint: "****abcd",
  last_synced_at: "2026-08-20T04:00:00.000Z",
  next_sync_at: "2026-08-20T05:00:00.000Z",
  created_by: "user-1",
} as Connector;

const dingtalk = {
  ...yunxiao,
  id: "connector-dingtalk",
  type: "dingtalk",
  name: "钉钉群机器人",
  target_label_id: null,
} as Connector;

describe("connector sync button", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    invokeConnectorSync.mockReset();
    invokeConnectorSync.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }
    container?.remove();
    container = null;
    document.body.replaceChildren();
  });

  function renderButton(props?: {
    connectors?: Connector[];
    workspaceId?: string;
    online?: boolean;
    onNotice?: (message: string) => void;
  }) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onNotice = props?.onNotice ?? vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return {
      onNotice,
      render: () => root?.render(
        <QueryClientProvider client={queryClient}>
          <ConnectorSyncButton
            workspaceId={props?.workspaceId ?? "workspace-prod"}
            connectors={props?.connectors ?? [yunxiao]}
            online={props?.online ?? true}
            onNotice={onNotice}
          />
        </QueryClientProvider>,
      ),
    };
  }

  it("hides when no Yunxiao connector is configured", async () => {
    const { render } = renderButton({ connectors: [dingtalk] });
    await act(async () => { render(); });
    expect(container?.querySelector('[aria-label="同步连接器"]')).toBeNull();
  });

  it("shows the rail icon after a Yunxiao connector is configured", async () => {
    const { render } = renderButton({ connectors: [dingtalk, yunxiao] });
    await act(async () => { render(); });
    expect(container?.querySelector('[aria-label="同步连接器"]')).not.toBeNull();
  });

  it("lists connectors and triggers sync for the chosen item", async () => {
    const { render, onNotice } = renderButton();
    await act(async () => { render(); });
    const trigger = container?.querySelector('[aria-label="同步连接器"]') as HTMLButtonElement;
    await act(async () => { trigger.click(); });
    const item = [...container?.querySelectorAll('[role="menuitem"]') ?? []]
      .find((candidate) => candidate.textContent?.includes("云效工作项同步")) as HTMLButtonElement;
    expect(item).toBeTruthy();
    await act(async () => { item.click(); });
    await vi.waitFor(() => {
      expect(invokeConnectorSync).toHaveBeenCalledWith("connector-yunxiao");
      expect(onNotice).toHaveBeenCalledWith("云效同步完成");
    });
  });

  it("does not sync a disabled connector from the list", async () => {
    const { render } = renderButton({
      connectors: [{ ...yunxiao, enabled: false }],
    });
    await act(async () => { render(); });
    const trigger = container?.querySelector('[aria-label="同步连接器"]') as HTMLButtonElement;
    await act(async () => { trigger.click(); });
    const item = container?.querySelector('[role="menuitem"]') as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(item.textContent).toContain("已停用");
    await act(async () => { item.click(); });
    expect(invokeConnectorSync).not.toHaveBeenCalled();
  });
});
