import { parseYunxiaoWorkitemRef } from "../../supabase/functions/_shared/yunxiao";
import { isDemoWorkspace } from "./connectorAdmin";
import { edgeFunctionErrorMessage } from "./sso";
import { supabase } from "./supabase";
import type { Connector, Task } from "../types";

export { parseYunxiaoWorkitemRef };

export function isYunxiaoQuickCreateInput(title: string) {
  return parseYunxiaoWorkitemRef(title) !== null;
}

export function isYunxiaoQuickCreateConnector(connector: {
  type?: string;
  public_config?: unknown;
}) {
  const config = connector.public_config;
  return connector.type === "yunxiao"
    && typeof config === "object"
    && config !== null
    && (config as { kind?: unknown }).kind === "quick_create";
}

export function canCompleteYunxiaoExternalTask(
  task: Pick<Task, "connector_platform" | "status" | "created_by" | "connector_id">,
  connectors: Array<Pick<Connector, "id" | "created_by" | "enabled" | "type" | "public_config">>,
  currentUserId: string,
) {
  if (task.connector_platform !== "yunxiao" || task.status === "completed") return false;
  const connector = connectors.find((item) => item.id === task.connector_id);
  if (!connector?.enabled) return false;
  if (isYunxiaoQuickCreateConnector(connector)) {
    return task.created_by === currentUserId || connector.created_by === currentUserId;
  }
  return task.created_by === currentUserId && connector.created_by === currentUserId;
}

export async function importYunxiaoWorkitem(workspaceId: string, url: string) {
  if (isDemoWorkspace(workspaceId)) {
    throw new Error("演示模式无法从云效链接创建待办");
  }
  if (!supabase) throw new Error("Supabase 未配置");
  const { data, error } = await supabase.functions.invoke("yunxiao-import-workitem", {
    body: { workspaceId, url },
  });
  if (error) {
    throw new Error(await edgeFunctionErrorMessage(error, data, "云效工作项导入失败"));
  }
  const taskId = data && typeof data === "object" && typeof (data as { taskId?: unknown }).taskId === "string"
    ? (data as { taskId: string }).taskId
    : "";
  if (!taskId) throw new Error("云效工作项导入未返回任务");
  return {
    taskId,
    created: Boolean((data as { created?: unknown }).created),
    title: typeof (data as { title?: unknown }).title === "string"
      ? (data as { title: string }).title
      : "",
  };
}

export async function importYunxiaoWorkitemFromText(workspaceId: string, text: string) {
  if (!isYunxiaoQuickCreateInput(text)) return null;
  return importYunxiaoWorkitem(workspaceId, text.trim());
}
