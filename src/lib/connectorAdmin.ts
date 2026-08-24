import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { edgeFunctionErrorMessage } from "./sso";
import { supabase } from "./supabase";
import type { Connector, Workspace, YunxiaoConnectorConfig } from "../types";

export type ConnectorListItem = {
  id: string;
  type: "dingtalk-group-robot";
  name: string;
  enabled: boolean;
  lastEventAt: string | null;
  createdAt: string;
};

export type YunxiaoConnectorListItem = {
  id: string;
  type: "yunxiao";
  name: string;
  enabled: boolean;
  scheduleMinutes: number;
  targetLabelId: string;
  config: YunxiaoConnectorConfig;
  credentialHint: string | null;
  lastSyncedAt: string | null;
  nextSyncAt: string;
  createdAt: string;
  lastRun: {
    status?: string;
    error_message?: string | null;
    pulled_count?: number;
    finished_at?: string | null;
  } | null;
};

export type ConnectorListResponse = {
  canManage: boolean;
  ssoEnabled: boolean;
  callbackUrl: string;
  connectors: ConnectorListItem[];
  yunxiaoConnectors: YunxiaoConnectorListItem[];
};

export function connectorSettingsQueryKey(workspaceId: string) {
  return ["connector-settings", workspaceId] as const;
}

export function isDemoWorkspace(workspaceId: string) {
  return workspaceId === "workspace-team" || workspaceId === "workspace-personal";
}

export function emptyConnectorListResponse(workspace: Workspace): ConnectorListResponse {
  return {
    canManage: workspace.role === "owner" || workspace.role === "admin",
    ssoEnabled: false,
    callbackUrl: "",
    connectors: [],
    yunxiaoConnectors: [],
  };
}

export function demoConnectorListResponse(
  workspace: Workspace,
  connectors: Connector[],
): ConnectorListResponse {
  return {
    canManage: workspace.role === "owner" || workspace.role === "admin",
    ssoEnabled: workspace.id === "workspace-team",
    callbackUrl: "https://example.supabase.co/functions/v1/dingtalk-group-bot",
    connectors: connectors.flatMap((connector) =>
      connector.type === "dingtalk" && "kind" in connector.public_config
        && connector.public_config.kind === "group_robot"
        ? [{
            id: connector.id,
            type: "dingtalk-group-robot" as const,
            name: connector.name,
            enabled: connector.enabled,
            lastEventAt: connector.last_synced_at,
            createdAt: connector.next_sync_at,
          }]
        : []),
    yunxiaoConnectors: [],
  };
}

export async function invokeConnectorAdmin(body: Record<string, unknown>) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data, error } = await supabase.functions.invoke("connector-admin", { body });
  if (error) {
    throw new Error(await edgeFunctionErrorMessage(error, data, "连接器请求失败"));
  }
  return data;
}

export async function invokeConnectorSync(connectorId: string) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data, error } = await supabase.functions.invoke("connector-sync", {
    body: { connectorId },
  });
  if (error) {
    throw new Error(await edgeFunctionErrorMessage(error, data, "同步失败"));
  }
  return data;
}

export function manualSyncConnectors(connectors: Connector[]) {
  return connectors.filter((connector) => connector.type === "yunxiao");
}

export function connectorSyncSubtitle(connector: Connector, options?: {
  syncing?: boolean;
}) {
  if (options?.syncing) return "同步中…";
  if (!connector.enabled) return "已停用";
  if (!connector.last_synced_at) return "尚未同步";
  return formatLastSyncedAt(connector.last_synced_at);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatLastEvent(value: string | null) {
  if (!value) return "尚未收到群消息";
  return formatDateTime(value);
}

export function formatLastSyncedAt(value: string | null) {
  if (!value) return "尚未同步";
  return formatDateTime(value);
}

export function useConnectorSettings(workspace: Workspace, bundleConnectors: Connector[]) {
  const demo = isDemoWorkspace(workspace.id);
  const queryClient = useQueryClient();
  const connectorQuery = useQuery({
    queryKey: connectorSettingsQueryKey(workspace.id),
    enabled: !demo && Boolean(supabase),
    queryFn: async () => await invokeConnectorAdmin({
      action: "list",
      workspaceId: workspace.id,
    }) as ConnectorListResponse,
  });
  const data = useMemo(
    () => demo
      ? demoConnectorListResponse(workspace, bundleConnectors)
      : connectorQuery.data ?? emptyConnectorListResponse(workspace),
    [bundleConnectors, connectorQuery.data, demo, workspace],
  );

  async function refresh() {
    await Promise.all([
      connectorQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ["workspace-bundle", workspace.id] }),
    ]);
  }

  return { demo, connectorQuery, data, refresh };
}
