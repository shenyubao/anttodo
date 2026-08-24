import { describe, expect, it } from "vitest";
import {
  connectorSyncSubtitle,
  demoConnectorListResponse,
  emptyConnectorListResponse,
  formatLastEvent,
  formatLastSyncedAt,
  isDemoWorkspace,
  manualSyncConnectors,
} from "./connectorAdmin";
import type { Connector, Workspace } from "../types";

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
  });

  it("returns an empty list fallback without assuming SSO is enabled", () => {
    expect(emptyConnectorListResponse(workspace)).toMatchObject({
      ssoEnabled: false,
      connectors: [],
      yunxiaoConnectors: [],
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
    expect(manualSyncConnectors([dingtalkConnector])).toEqual([]);
  });

  it("describes connector sync status for the rail menu", () => {
    expect(connectorSyncSubtitle(dingtalkConnector, { syncing: true })).toBe("同步中…");
    expect(connectorSyncSubtitle({ ...dingtalkConnector, enabled: false })).toBe("已停用");
    expect(connectorSyncSubtitle({ ...dingtalkConnector, last_synced_at: null })).toBe("尚未同步");
    expect(connectorSyncSubtitle(dingtalkConnector)).toBe(formatLastSyncedAt(dingtalkConnector.last_synced_at));
  });
});
