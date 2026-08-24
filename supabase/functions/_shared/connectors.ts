export type ConnectorType = "mock" | "yunxiao" | "dingtalk";

export type NormalizedRemoteTask = {
  externalId: string;
  title: string;
  description: string;
  status: "open" | "completed" | "cancelled";
  dueAt: string | null;
  assigneeRef: string | null;
  updatedAt: string;
  version: string;
};

export type ConnectorCapabilities = {
  create: boolean;
  update: boolean;
  complete: boolean;
  remove: boolean;
  incrementalCursor: boolean;
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

export const connectorCapabilities: Record<ConnectorType, ConnectorCapabilities> = {
  mock: {
    create: true,
    update: true,
    complete: true,
    remove: true,
    incrementalCursor: true,
  },
  yunxiao: {
    create: true,
    update: true,
    complete: true,
    remove: false,
    incrementalCursor: true,
  },
  dingtalk: {
    create: true,
    update: true,
    complete: true,
    remove: true,
    incrementalCursor: true,
  },
};

export function validateConnectorConfig(
  type: ConnectorType,
  config: Record<string, unknown>,
): string[] {
  if (type === "mock") return [];
  if (type === "yunxiao") {
    return [
      "organizationId",
      "projectId",
      "workitemTypeId",
      "categoryId",
      "completedStatusId",
    ].filter(
      (key) => typeof config[key] !== "string" || String(config[key]).length === 0,
    );
  }
  return ["corpId"].filter(
    (key) => typeof config[key] !== "string" || String(config[key]).length === 0,
  );
}
