import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { resolveUser } from "../_shared/resolveUser.ts";
import {
  getWorkitem,
  getWorkitemWorkflow,
  isYunxiaoQuickCreateConfig,
  pickYunxiaoCompletedStatus,
  updateWorkitemStatus,
  validateYunxiaoPublicConfig,
  validateYunxiaoQuickCreateConfig,
  yunxiaoWorkitemSpaceId,
} from "../_shared/yunxiao.ts";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return jsonError("Method not allowed", 405);
    const user = await resolveUser(req, ctx.supabaseAdmin);
    if (!user) return jsonError("Authentication required", 401);
    const body = await req.json().catch(() => ({})) as { taskId?: unknown };
    if (typeof body.taskId !== "string") return jsonError("taskId is required", 400);

    const { data: task, error: taskError } = await ctx.supabaseAdmin
      .from("tasks")
      .select("id,status,created_by,external_id,connector_id,connector_platform")
      .eq("id", body.taskId)
      .maybeSingle();
    if (taskError || !task || task.connector_platform !== "yunxiao") {
      return jsonError("External task not found", 404);
    }
    const { data: connector, error: connectorError } = await ctx.supabaseAdmin
      .from("connector_instances")
      .select("id,created_by,enabled,type,public_config")
      .eq("id", task.connector_id)
      .maybeSingle();
    if (connectorError || !connector || connector.type !== "yunxiao") {
      return jsonError("External task not found", 404);
    }
    const isQuickCreate = isYunxiaoQuickCreateConfig(connector.public_config);
    const canComplete = isQuickCreate
      ? task.created_by === user.id || connector.created_by === user.id
      : task.created_by === user.id && connector.created_by === user.id;
    if (!canComplete) {
      return jsonError("Only the connector owner may complete this task", 403);
    }
    if (!connector.enabled) return jsonError("Connector is disabled", 409);
    if (task.status === "completed") return Response.json({ task, completed: true });

    const { data: token, error: tokenError } = await ctx.supabaseAdmin.rpc(
      "get_connector_secret",
      { p_connector_id: connector.id },
    );
    if (tokenError || typeof token !== "string" || !token) {
      return jsonError("Yunxiao token is not configured", 422);
    }

    let organizationId: string;
    let completedStatusId: string;
    try {
      if (isQuickCreate) {
        const config = validateYunxiaoQuickCreateConfig(connector.public_config);
        organizationId = config.organizationId;
        const workitem = await getWorkitem(organizationId, task.external_id, token);
        if (!workitem) throw new Error("未找到对应的云效工作项");
        const projectId = yunxiaoWorkitemSpaceId(workitem);
        const workitemTypeId = String(workitem.workitemType?.id ?? "").trim();
        if (!projectId || !workitemTypeId) {
          throw new Error("云效工作项缺少项目或类型，无法回写完成状态");
        }
        const statuses = await getWorkitemWorkflow(
          organizationId,
          projectId,
          workitemTypeId,
          token,
        );
        const completedStatus = pickYunxiaoCompletedStatus(statuses);
        if (!completedStatus) {
          throw new Error("未找到可用于完成的云效状态");
        }
        completedStatusId = completedStatus.id;
      } else {
        const config = validateYunxiaoPublicConfig(connector.public_config);
        organizationId = config.organizationId;
        completedStatusId = config.completedStatusId;
      }
      await updateWorkitemStatus(
        organizationId,
        task.external_id,
        completedStatusId,
        token,
      );
    } catch (error) {
      return jsonError(
        error instanceof Error ? error.message : "Yunxiao update failed",
        502,
      );
    }
    const { data: completed, error: completeError } = await ctx.supabaseAdmin.rpc(
      "complete_yunxiao_external_task_local",
      { p_task_id: task.id, p_actor_id: user.id },
    );
    if (completeError || !completed) {
      return jsonError(completeError?.message ?? "Local update failed", 500);
    }
    return Response.json({ task: completed, completed: true });
  }),
};
