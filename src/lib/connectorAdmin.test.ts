import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  connectorSyncSubtitle,
  connectorSettingsQueryKey,
  demoConnectorListResponse,
  emptyConnectorListResponse,
  formatLastEvent,
  formatLastSyncedAt,
  isDemoWorkspace,
  manualSyncConnectors,
  patchWorkspaceConnector,
  setConnectorEnabledInCache,
  type ConnectorListResponse,
} from "./connectorAdmin";
import type { Connector, Workspace, WorkspaceBundle } from "../types";

const workspace: Workspace = {
  id: "workspace-team",
  name: "AntTodo 产品团队",
  slug: "anttodo-product",
  role: "owner",
  created_by: "user-1",
};

const dingtalkConnector = {
  id: "connector-dingtalk-group-robot",
  workspace_id: "workspace-team",
  type: "dingtalk",
  name: "钉钉群机器人",
  enabled: true,
  schedule_minutes: 5,
  public_config: { kind: "group_robot", timezone: "Asia/Shanghai" },
  target_label_id: null,
  credential_hint: null,
  last_synced_at: "2026-08-20T04:00:00.000Z",
  next_sync_at: "2026-08-20T05:00:00.000Z",
  created_by: "user-1",
} as Connector;

describe("connector admin helpers", () => {
  it("recognizes demo workspaces", () => {
    expect(isDemoWorkspace("workspace-team")).toBe(true);
    expect(isDemoWorkspace("workspace-personal")).toBe(true);
    expect(isDemoWorkspace("workspace-prod")).toBe(false);
  });

  it("maps the demo DingTalk group robot into the settings list", () => {
    const response = demoConnectorListResponse(workspace, [dingtalkConnector]);
    expect(response.ssoEnabled).toBe(true);
    expect(response.canManage).toBe(true);
    expect(response.connectors).toEqual([
      {
        id: "connector-dingtalk-group-robot",
        type: "dingtalk-group-robot",
        name: "钉钉群机器人",
        enabled: true,
        lastEventAt: "2026-08-20T04:00:00.000Z",
        createdAt: "2026-08-20T05:00:00.000Z",
      },
    ]);
    expect(response.yunxiaoConnectors).toEqual([]);
    expect(response.yunxiaoQuickCreate).toBeNull();
  });

  it("returns an empty list fallback without assuming SSO is enabled", () => {
    expect(emptyConnectorListResponse(workspace)).toMatchObject({
      ssoEnabled: false,
      connectors: [],
      yunxiaoConnectors: [],
      yunxiaoQuickCreate: null,
    });
  });

  it("formats a missing last-event time for the DingTalk robot", () => {
    expect(formatLastEvent(null)).toBe("尚未收到群消息");
  });

  it("only treats Yunxiao connectors as manual-sync targets", () => {
    const yunxiao = {
      ...dingtalkConnector,
      id: "connector-yunxiao",
      type: "yunxiao" as const,
      name: "云效工作项同步",
      last_synced_at: null,
    };
    expect(manualSyncConnectors([dingtalkConnector, yunxiao])).toEqual([yunxiao]);
    expect(manualSyncConnectors([
      dingtalkConnector,
      yunxiao,
      {
        ...yunxiao,
        id: "connector-yunxiao-quick-create",
        name: "输入框拓展-云效工单",
        public_config: { kind: "quick_create", organizationId: "org" },
      },
    ])).toEqual([yunxiao]);
    expect(manualSyncConnectors([dingtalkConnector])).toEqual([]);
  });

  it("describes connector sync status for the rail menu", () => {
    expect(connectorSyncSubtitle(dingtalkConnector, { syncing: true })).toBe("同步中…");
    expect(connectorSyncSubtitle({ ...dingtalkConnector, enabled: false })).toBe("已停用");
    expect(connectorSyncSubtitle({ ...dingtalkConnector, last_synced_at: null })).toBe("尚未同步");
    expect(connectorSyncSubtitle(dingtalkConnector)).toBe(formatLastSyncedAt(dingtalkConnector.last_synced_at));
  });

  it("updates only the selected connector in the workspace bundle", () => {
    const bundle = {
      connectors: [dingtalkConnector, { ...dingtalkConnector, id: "connector-other" }],
    } as WorkspaceBundle;

    const updated = patchWorkspaceConnector(
      bundle,
      dingtalkConnector.id,
      { enabled: false },
    );

    expect(updated.connectors[0].enabled).toBe(false);
    expect(updated.connectors[1]).toBe(bundle.connectors[1]);
  });

  it("updates quick-create and bundle caches without invalidating either query", () => {
    const queryClient = new QueryClient();
    const workspaceId = "workspace-prod";
    const quickCreate = {
      id: "connector-yunxiao-quick-create",
      type: "yunxiao-quick-create" as const,
      name: "输入框拓展-云效工单",
      enabled: true,
      organizationId: "org",
      targetLabelId: "label-1",
      credentialHint: "***token",
      lastEventAt: null,
      createdAt: "2026-08-20T05:00:00.000Z",
    };
    const settings = {
      ...emptyConnectorListResponse({ ...workspace, id: workspaceId }),
      yunxiaoQuickCreate: quickCreate,
    } satisfies ConnectorListResponse;
    const bundle = {
      connectors: [{
        ...dingtalkConnector,
        id: quickCreate.id,
        workspace_id: workspaceId,
        type: "yunxiao",
        public_config: { kind: "quick_create", organizationId: "org" },
      }],
    } as WorkspaceBundle;
    queryClient.setQueryData(connectorSettingsQueryKey(workspaceId), settings);
    queryClient.setQueryData(["workspace-bundle", workspaceId], bundle);

    setConnectorEnabledInCache(
      queryClient,
      workspaceId,
      quickCreate.id,
      false,
    );

    expect(queryClient.getQueryData<ConnectorListResponse>(
      connectorSettingsQueryKey(workspaceId),
    )?.yunxiaoQuickCreate?.enabled).toBe(false);
    expect(queryClient.getQueryData<WorkspaceBundle>(
      ["workspace-bundle", workspaceId],
    )?.connectors[0].enabled).toBe(false);
    expect(queryClient.getQueryState(connectorSettingsQueryKey(workspaceId))?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(["workspace-bundle", workspaceId])?.isInvalidated).toBe(false);
  });
});
