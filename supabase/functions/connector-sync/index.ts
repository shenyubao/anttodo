import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { resolveUser } from "../_shared/resolveUser.ts";
import {
  normalizeDescription,
  isWorkitemOfType,
  shouldStopYunxiaoFirstSync,
  startYunxiaoSyncCursor,
  searchWorkitems,
  getWorkitem,
  normalizeYunxiaoTimestamp,
  mapYunxiaoPlanToDue,
  formatYunxiaoTaskDescription,
  formatYunxiaoSyncedAt,
  yunxiaoAssigneeName,
  yunxiaoStatusName,
  validateYunxiaoPublicConfig,
  yunxiaoWorkitemUrl,
  isYunxiaoQuickCreateConfig,
  type YunxiaoWorkitem,
  type YunxiaoSyncCursor,
} from "../_shared/yunxiao.ts";
import { mirrorYunxiaoDescriptionImages } from "../_shared/yunxiao-task-mirror.ts";

const PAGE_SIZE = 200;
const MAX_PAGES_PER_RUN = 100;

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function statusId(item: YunxiaoWorkitem) {
  return typeof item.status === "string" ? item.status : item.status?.id ?? "";
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return jsonError("Method not allowed", 405);
    const dispatchSecret = Deno.env.get("REMINDER_DISPATCH_SECRET") ?? "";
    const scheduled = Boolean(dispatchSecret) &&
      req.headers.get("x-anttodo-dispatch-secret") === dispatchSecret;
    const user = scheduled ? null : await resolveUser(req, ctx.supabaseAdmin);
    if (!scheduled && !user) return jsonError("Authentication required", 401);

    const body = await req.json().catch(() => ({})) as { connectorId?: unknown };
    if (typeof body.connectorId !== "string") {
      return jsonError("connectorId is required");
    }
    const connectorId = body.connectorId;
    const { data: connector, error: connectorError } = await ctx.supabaseAdmin
      .from("connector_instances")
      .select("id,workspace_id,type,name,enabled,schedule_minutes,public_config,created_by,target_label_id")
      .eq("id", connectorId)
      .maybeSingle();
    if (connectorError || !connector || connector.type !== "yunxiao") {
      return jsonError("Yunxiao connector not found", 404);
    }
    if (isYunxiaoQuickCreateConfig(connector.public_config)) {
      return jsonError("输入框拓展-云效工单不支持定时同步", 400);
    }
    if (!scheduled && connector.created_by !== user?.id) {
      return jsonError("Connector owner access required", 403);
    }
    if (!connector.enabled) return jsonError("Connector is disabled", 409);

    const { data: token, error: tokenError } = await ctx.supabaseAdmin.rpc(
      "get_connector_secret",
      { p_connector_id: connectorId },
    );
    if (tokenError || typeof token !== "string" || !token) {
      return jsonError("Yunxiao token is not configured", 422);
    }

    const { data: run, error: runError } = await ctx.supabaseAdmin
      .from("sync_runs")
      .insert({
        connector_id: connectorId,
        status: "running",
        trigger: scheduled ? "cron" : "manual",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (runError || !run) return jsonError(runError?.message ?? "Sync run failed", 500);

    try {
      const config = validateYunxiaoPublicConfig(connector.public_config);
      const { data: state, error: stateError } = await ctx.supabaseAdmin
        .from("connector_sync_state")
        .select("cursor,remote_watermark")
        .eq("connector_id", connectorId)
        .maybeSingle();
      if (stateError) throw new Error(stateError.message);
      const started = startYunxiaoSyncCursor(
        state?.cursor ?? null,
        state?.remote_watermark ?? null,
      );
      let cursor: YunxiaoSyncCursor = started.cursor;
      const isFirstSync = started.isFirstSync;
      let createdCount = 0;
      let updatedCount = 0;
      let processedCount = 0;
      let pagesProcessed = 0;
      let partial = false;
      let completedWindow = false;

      outer: while (pagesProcessed < MAX_PAGES_PER_RUN) {
        const page = await searchWorkitems(
          config,
          token,
          { from: cursor.from, to: cursor.to },
          cursor.page,
          PAGE_SIZE,
        );
        pagesProcessed += 1;
        for (let index = cursor.offset; index < page.items.length; index += 1) {
          const item = page.items[index];
          cursor.offset = index;
          if (!isWorkitemOfType(item, config.workitemTypeId)) {
            cursor.offset = index + 1;
            continue;
          }
          const externalId = String(item.id ?? "").trim();
          if (!externalId) {
            cursor.offset = index + 1;
            continue;
          }
          if (shouldStopYunxiaoFirstSync(isFirstSync, processedCount)) {
            // Close the first window at `to` so later runs only pull items
            // updated since this snapshot, instead of paging further back.
            completedWindow = true;
            partial = true;
            break outer;
          }
          const { data: existing, error: existingError } = await ctx.supabaseAdmin
            .from("tasks")
            .select("id")
            .eq("connector_id", connectorId)
            .eq("external_id", externalId)
            .maybeSingle();
          if (existingError) throw new Error(existingError.message);
          const taskId = existing?.id ?? crypto.randomUUID();
          let source = item;
          let due = mapYunxiaoPlanToDue(source);
          if (!due.due_at) {
            const detail = await getWorkitem(
              config.organizationId,
              externalId,
              token,
            ).catch(() => null);
            if (detail) {
              source = { ...item, ...detail };
              due = mapYunxiaoPlanToDue(source);
            }
          }
          const sourceUrl = yunxiaoWorkitemUrl(
            config.projectId,
            config.categoryId,
            externalId,
          );
          const descriptionMeta = {
            assigneeName: yunxiaoAssigneeName(source),
            statusName: yunxiaoStatusName(source),
            sourceUrl,
            syncedAt: formatYunxiaoSyncedAt(),
          };
          const normalizedBody = normalizeDescription(source.description, source.formatType);
          const remoteUpdatedAt = normalizeYunxiaoTimestamp(source.gmtModified, cursor.to);
          const { data: upserted, error: upsertError } = await ctx.supabaseAdmin.rpc(
            "upsert_yunxiao_external_task",
            {
              p_connector_id: connectorId,
              p_task_id: taskId,
              p_external_id: externalId,
              p_title: String(source.subject ?? item.subject ?? ""),
              p_description: formatYunxiaoTaskDescription({
                ...descriptionMeta,
                body: normalizedBody,
              }),
              p_status: statusId(source) === config.completedStatusId ? "completed" : "open",
              p_remote_updated_at: remoteUpdatedAt,
              p_external_version: remoteUpdatedAt,
              p_due_at: due.due_at,
              p_due_start_at: due.due_start_at,
              p_due_is_all_day: due.due_is_all_day,
              p_due_timezone: due.due_timezone,
            },
          );
          if (upsertError) throw new Error(upsertError.message);
          const row = Array.isArray(upserted) ? upserted[0] : upserted;
          const savedTaskId = typeof row?.task_id === "string" && row.task_id
            ? row.task_id
            : taskId;
          const mirroredBody = await mirrorYunxiaoDescriptionImages(
            ctx.supabaseAdmin,
            normalizedBody,
            connector.workspace_id,
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
            if (descriptionError) throw new Error(descriptionError.message);
          }
          if (row?.created) createdCount += 1;
          else updatedCount += 1;
          processedCount += 1;
          cursor.offset = index + 1;
        }

        if (cursor.offset < page.items.length) {
          partial = true;
          break;
        }
        const noMore = page.items.length < PAGE_SIZE ||
          (page.total !== null && cursor.page * PAGE_SIZE >= page.total);
        if (noMore) {
          completedWindow = true;
          break;
        }
        cursor = { ...cursor, page: cursor.page + 1, offset: 0 };
      }
      if (!completedWindow && pagesProcessed >= MAX_PAGES_PER_RUN) partial = true;

      const completedAt = new Date().toISOString();
      const nextCursor = completedWindow ? null : JSON.stringify(cursor);
      const { error: saveStateError } = await ctx.supabaseAdmin
        .from("connector_sync_state")
        .upsert({
          connector_id: connectorId,
          cursor: nextCursor,
          remote_watermark: completedWindow ? cursor.to : state?.remote_watermark ?? null,
          updated_at: completedAt,
        });
      if (saveStateError) throw new Error(saveStateError.message);
      await ctx.supabaseAdmin.from("connector_instances").update({
        last_synced_at: completedAt,
        next_sync_at: new Date(Date.now() + connector.schedule_minutes * 60_000).toISOString(),
      }).eq("id", connectorId);
      await ctx.supabaseAdmin.from("sync_runs").update({
        status: "succeeded",
        pulled_count: processedCount,
        finished_at: completedAt,
      }).eq("id", run.id);
      return Response.json({
        runId: run.id,
        status: "succeeded",
        created: createdCount,
        updated: updatedCount,
        partial,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed";
      await ctx.supabaseAdmin.from("sync_runs").update({
        status: "failed",
        error_message: message.slice(0, 2000),
        finished_at: new Date().toISOString(),
      }).eq("id", run.id);
      await ctx.supabaseAdmin.from("connector_instances").update({
        next_sync_at: new Date(Date.now() + connector.schedule_minutes * 60_000).toISOString(),
      }).eq("id", connectorId);
      return jsonError(message, 500);
    }
  }),
};
