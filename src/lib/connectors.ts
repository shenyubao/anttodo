import type { ConnectorType, Task } from "../types";

export type ConnectorCapabilities = {
  create: boolean;
  update: boolean;
  complete: boolean;
  remove: boolean;
  incrementalCursor: boolean;
};

export type NormalizedRemoteTask = {
  externalId: string;
  title: string;
  description: string;
  status: Task["status"];
  dueAt: string | null;
  assigneeRef: string | null;
  updatedAt: string;
  version: string;
};

export interface ConnectorAdapter {
  readonly type: ConnectorType;
  readonly capabilities: ConnectorCapabilities;
  validateConfig(config: Record<string, unknown>): string[];
  healthCheck(): Promise<{ ok: boolean; message: string }>;
  pull(cursor: string | null): Promise<{
    tasks: NormalizedRemoteTask[];
    nextCursor: string | null;
  }>;
  push(tasks: NormalizedRemoteTask[]): Promise<{
    accepted: string[];
    rejected: Array<{ externalId: string; reason: string }>;
  }>;
}

export const connectorMetadata: Record<
  ConnectorType,
  { title: string; description: string; color: string }
> = {
  mock: {
    title: "Mock Connector",
    description: "验证增量拉取、回写、重试和冲突处理",
    color: "#5b7cfa",
  },
  yunxiao: {
    title: "云效工作项",
    description: "已预留工作项、状态与成员字段映射",
    color: "#ff6a00",
  },
  dingtalk: {
    title: "钉钉群机器人",
    description: "在钉钉群内 @机器人快速创建团队任务",
    color: "#1677ff",
  },
};

export function hasBidirectionalConflict(
  lastSyncedAt: string,
  localUpdatedAt: string,
  remoteUpdatedAt: string,
) {
  const sync = new Date(lastSyncedAt).getTime();
  return (
    new Date(localUpdatedAt).getTime() > sync &&
    new Date(remoteUpdatedAt).getTime() > sync
  );
}
