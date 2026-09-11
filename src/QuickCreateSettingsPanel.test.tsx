import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickCreateSettingsPanel } from "./QuickCreateSettingsPanel";
import type { Connector, Workspace } from "./types";
import type { ConnectorListResponse } from "./lib/connectorAdmin";

const mocks = vi.hoisted(() => ({
  invokeConnectorAdmin: vi.fn(async () => undefined),
  refresh: vi.fn(async () => undefined),
  updateEnabled: vi.fn(),
  useConnectorSettings: vi.fn(),
}));

vi.mock("./lib/connectorAdmin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/connectorAdmin")>();
  return {
    ...actual,
    invokeConnectorAdmin: mocks.invokeConnectorAdmin,
    useConnectorSettings: mocks.useConnectorSettings,
  };
});

const workspace: Workspace = {
  id: "workspace-prod",
  name: "产品团队",
  slug: "product",
  role: "owner",
  created_by: "user-1",
};

const dingtalkConnector = {
  id: "connector-dingtalk",
  workspace_id: workspace.id,
  type: "dingtalk",
  name: "钉钉群机器人",
  enabled: true,
  schedule_minutes: 5,
  public_config: { kind: "group_robot", timezone: "Asia/Shanghai" },
  target_label_id: null,
  credential_hint: null,
  last_synced_at: null,
  next_sync_at: "2026-09-04T00:00:00.000Z",
  created_by: "user-1",
} as Connector;

function settingsData(kind: "dingtalk" | "yunxiao"): ConnectorListResponse {
  return {
    canManage: true,
    ssoEnabled: true,
    callbackUrl: "https://example.com/callback",
    connectors: kind === "dingtalk"
      ? [{
          id: dingtalkConnector.id,
          type: "dingtalk-group-robot",
          name: dingtalkConnector.name,
          enabled: true,
          lastEventAt: null,
          createdAt: "2026-09-04T00:00:00.000Z",
        }]
      : [],
    yunxiaoConnectors: [],
    yunxiaoQuickCreate: kind === "yunxiao"
      ? {
          id: "connector-yunxiao-quick-create",
          type: "yunxiao-quick-create",
          name: "输入框拓展-云效工单",
          enabled: true,
          organizationId: "org-1",
          targetLabelId: "label-1",
          credentialHint: "****token",
          lastEventAt: null,
          createdAt: "2026-09-04T00:00:00.000Z",
        }
      : null,
  };
}

describe("quick-create settings enable toggle", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    mocks.invokeConnectorAdmin.mockReset();
    mocks.invokeConnectorAdmin.mockResolvedValue(undefined);
    mocks.refresh.mockReset();
    mocks.updateEnabled.mockReset();
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  async function render(kind: "dingtalk" | "yunxiao") {
    mocks.useConnectorSettings.mockReturnValue({
      demo: false,
      connectorQuery: { isLoading: false, isError: false },
      data: settingsData(kind),
      refresh: mocks.refresh,
      updateEnabled: mocks.updateEnabled,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(
      <QuickCreateSettingsPanel
        workspace={workspace}
        connectors={kind === "dingtalk" ? [dingtalkConnector] : []}
        labels={[]}
        labelPermissionLevels={{}}
        online
        onNavigateToSso={() => undefined}
        onNotice={() => undefined}
      />,
    ));
  }

  it.each([
    ["dingtalk", "connector-dingtalk", "set-enabled"],
    ["yunxiao", "connector-yunxiao-quick-create", "set-yunxiao-enabled"],
  ] as const)("updates the %s cache without refreshing workspace data", async (
    kind,
    connectorId,
    action,
  ) => {
    await render(kind);
    const toggle = [...container!.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("停用"));
    expect(toggle).toBeTruthy();

    await act(async () => toggle?.click());

    await vi.waitFor(() => {
      expect(mocks.invokeConnectorAdmin).toHaveBeenCalledWith({
        action,
        connectorId,
        enabled: false,
      });
      expect(mocks.updateEnabled).toHaveBeenCalledWith(connectorId, false);
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
