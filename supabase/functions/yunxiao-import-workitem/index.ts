import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { resolveUser } from "../_shared/resolveUser.ts";
import {
  formatYunxiaoSyncedAt,
  formatYunxiaoTaskDescription,
  isYunxiaoQuickCreateConfig,
  isYunxiaoWorkitemCompleted,
  mapYunxiaoPlanToDue,
  normalizeDescription,
  normalizeYunxiaoTimestamp,
  parseYunxiaoWorkitemRef,
  resolveYunxiaoWorkitem,
  validateYunxiaoPublicConfig,
  validateYunxiaoQuickCreateConfig,
  yunxiaoAssigneeName,
  yunxiaoSourceUrl,
  yunxiaoStatusName,
  yunxiaoWorkitemCategoryId,
  yunxiaoWorkitemSpaceId,
  type YunxiaoWorkitem,
} from "../_shared/yunxiao.ts";
import { mirrorYunxiaoDescriptionImages } from "../_shared/yunxiao-task-mirror.ts";

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label}无效`);
  }
  return value.trim();
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return jsonError("Method not allowed", 405);
    const user = await resolveUser(req, ctx.supabaseAdmin);
    if (!user) return jsonError("请先登录后再继续", 401);

    const body = await req.json().catch(() => ({})) as {
      workspaceId?: unknown;
      url?: unknown;
    };
    let workspaceId: string;
    let url: string;
    try {
      workspaceId = requiredText(body.workspaceId, "团队空间 ID");
      url = requiredText(body.url, "云效链接");
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "请求无效", 400);
    }
    const ref = parseYunxiaoWorkitemRef(url);
    if (!ref) return jsonError("请粘贴有效的云效工作项链接", 422);

    const { data: membership, error: membershipError } = await ctx.supabaseAdmin
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (membershipError || !membership) {
      return jsonError("Workspace membership required", 403);
    }

    const { data: quickCreateRows, error: connectorError } = await ctx.supabaseAdmin
      .from("connector_instances")
      .select("id,workspace_id,type,enabled,created_by,target_label_id,public_config")
      .eq("workspace_id", workspaceId)
      .eq("type", "yunxiao");
    if (connectorError) return jsonError(connectorError.message, 400);
    const yunxiaoConnectors = quickCreateRows ?? [];
    const quickCreate = yunxiaoConnectors.find((item) =>
      isYunxiaoQuickCreateConfig(item.public_config)
    );
    if (!quickCreate) {
      return jsonError("请在设置 → 快速创建中接入输入框拓展-云效工单", 422);
    }
    if (!quickCreate.enabled) {
      return jsonError("输入框拓展-云效工单已停用，请在设置 → 快速创建中启用", 409);
    }
    const config = validateYunxiaoQuickCreateConfig(quickCreate.public_config);
    const { data: token, error: tokenError } = await ctx.supabaseAdmin.rpc(
      "get_connector_secret",
      { p_connector_id: quickCreate.id },
    );
    if (tokenError || typeof token !== "string" || !token) {
      return jsonError("云效个人令牌未配置", 422);
    }

    let source: YunxiaoWorkitem;
    try {
      source = await resolveYunxiaoWorkitem(config.organizationId, token, ref);
    } catch (error) {
      return jsonError(
        error instanceof Error ? error.message : "云效工作项查询失败",
        502,
      );
    }
    const externalId = String(source.id ?? "").trim();
    if (!externalId) return jsonError("云效工作项缺少 ID", 502);

    const { data: existingRows, error: existingError } = await ctx.supabaseAdmin
      .from("tasks")
      .select("id,title,connector_id,deleted_at")
      .eq("workspace_id", workspaceId)
      .eq("connector_platform", "yunxiao")
      .eq("external_id", externalId);
    if (existingError) return jsonError(existingError.message, 400);
    const existing = (existingRows ?? [])
      .slice()
      .sort((left, right) => Number(Boolean(left.deleted_at)) - Number(Boolean(right.deleted_at)))[0];

    if (existing && !existing.deleted_at) {
      const existingConnectorEnabled = yunxiaoConnectors.some((item) =>
        item.id === existing.connector_id && item.enabled
      );
      if (!existingConnectorEnabled) {
        return Response.json({
          taskId: existing.id,
          created: false,
          title: existing.title ?? String(source.subject ?? ""),
        });
      }
    }

    const targetConnectorId = existing?.connector_id
      && yunxiaoConnectors.some((item) => item.id === existing.connector_id && item.enabled)
      ? existing.connector_id
      : quickCreate.id;
    const targetConnector = yunxiaoConnectors.find((item) => item.id === targetConnectorId)
      ?? quickCreate;
    if (!targetConnector.enabled) {
      return jsonError("输入框拓展-云效工单已停用，请在设置 → 快速创建中启用", 409);
    }

    let completedStatusId: string | undefined;
    try {
      const scheduledConfig = validateYunxiaoPublicConfig(targetConnector.public_config);
      completedStatusId = scheduledConfig.completedStatusId;
    } catch {
      const projectId = yunxiaoWorkitemSpaceId(source);
      const workitemTypeId = String(source.workitemType?.id ?? "").trim();
      const match = yunxiaoConnectors.find((item) => {
        if (isYunxiaoQuickCreateConfig(item.public_config) || !item.enabled) return false;
        try {
          const scheduled = validateYunxiaoPublicConfig(item.public_config);
          return scheduled.projectId === projectId
            && scheduled.workitemTypeId === workitemTypeId;
        } catch {
          return false;
        }
      });
      if (match) {
        completedStatusId = validateYunxiaoPublicConfig(match.public_config).completedStatusId;
      }
    }

    const due = mapYunxiaoPlanToDue(source);
    const categoryId = yunxiaoWorkitemCategoryId(
      source,
      ref.kind === "serial" ? ref.categoryId : ref.categoryId,
    );
    const sourceUrl = yunxiaoSourceUrl(source, {
      projectId: ref.kind === "id" ? ref.projectId : yunxiaoWorkitemSpaceId(source),
      categoryId,
      workitemId: externalId,
    });
    const descriptionMeta = {
      assigneeName: yunxiaoAssigneeName(source),
      statusName: yunxiaoStatusName(source),
      sourceUrl,
      syncedAt: formatYunxiaoSyncedAt(),
    };
    const normalizedBody = normalizeDescription(source.description, source.formatType);
    const remoteUpdatedAt = normalizeYunxiaoTimestamp(
      source.gmtModified,
      new Date().toISOString(),
    );
    const taskId = existing?.id ?? crypto.randomUUID();
    const { data: upserted, error: upsertError } = await ctx.supabaseAdmin.rpc(
      "upsert_yunxiao_external_task",
      {
        p_connector_id: targetConnectorId,
        p_task_id: taskId,
        p_external_id: externalId,
        p_title: String(source.subject ?? ""),
        p_description: formatYunxiaoTaskDescription({
          ...descriptionMeta,
          body: normalizedBody,
        }),
        p_status: isYunxiaoWorkitemCompleted(source, completedStatusId) ? "completed" : "open",
        p_remote_updated_at: remoteUpdatedAt,
        p_external_version: remoteUpdatedAt,
        p_due_at: due.due_at,
        p_due_start_at: due.due_start_at,
        p_due_is_all_day: due.due_is_all_day,
        p_due_timezone: due.due_timezone,
        p_created_by: user.id,
      },
    );
    if (upsertError) return jsonError(upsertError.message, 500);
    const row = Array.isArray(upserted) ? upserted[0] : upserted;
    const savedTaskId = typeof row?.task_id === "string" && row.task_id
      ? row.task_id
      : taskId;
    const created = Boolean(row?.created);
    const mirroredBody = await mirrorYunxiaoDescriptionImages(
      ctx.supabaseAdmin,
      normalizedBody,
      workspaceId,
      savedTaskId,
      config.organizationId,
      externalId,
      token,
    );
    if (mirroredBody !== normalizedBody) {
      const { error: descriptionError } = await ctx.supabaseAdmin.from("tasks").update({
        description: formatYunxiaoTaskDescription({
          ...descriptionMeta,
          body: mirroredBody,
        }),
      }).eq("id", savedTaskId);
      if (descriptionError) return jsonError(descriptionError.message, 500);
    }

    await ctx.supabaseAdmin.from("connector_instances").update({
      last_synced_at: new Date().toISOString(),
    }).eq("id", quickCreate.id);

    return Response.json({
      taskId: savedTaskId,
      created,
      title: String(source.subject ?? ""),
    });
  }),
};
