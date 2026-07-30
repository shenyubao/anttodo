import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  connectorCapabilities,
  validateConnectorConfig,
  type ConnectorType,
} from "../_shared/connectors.ts";

export default {
  fetch: withSupabase({ auth: ["user", "secret"] }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }
    const { connectorId, simulateConflict = false } = await req.json();
    if (typeof connectorId !== "string") {
      return Response.json({ error: "connectorId is required" }, { status: 400 });
    }

    const connectorQuery = (ctx.authMode === "secret"
      ? ctx.supabaseAdmin
      : ctx.supabase
    )
      .from("connector_instances")
      .select("*")
      .eq("id", connectorId)
      .single();
    const { data: connector, error: connectorError } = await connectorQuery;
    if (connectorError || !connector) {
      return Response.json({ error: "Connector not found" }, { status: 404 });
    }

    const type = connector.type as ConnectorType;
    const missingConfig = validateConnectorConfig(
      type,
      connector.public_config as Record<string, unknown>,
    );
    if (missingConfig.length > 0) {
      return Response.json(
        { error: `Missing configuration: ${missingConfig.join(", ")}` },
        { status: 422 },
      );
    }

    const { data: run, error: runError } = await ctx.supabaseAdmin
      .from("sync_runs")
      .insert({
        connector_id: connectorId,
        status: "running",
        trigger: ctx.authMode === "secret" ? "cron" : "manual",
        started_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (runError || !run) {
      return Response.json({ error: runError?.message }, { status: 500 });
    }

    try {
      if (type !== "mock") {
        throw new Error(`${type} adapter is scaffolded but not configured in v1`);
      }

      const { data: pending = [] } = await ctx.supabaseAdmin
        .from("sync_outbox")
        .select("id, task_id")
        .eq("connector_id", connectorId)
        .is("processed_at", null)
        .lte("available_at", new Date().toISOString())
        .limit(100);

      let conflictCount = 0;
      if (simulateConflict) {
        const { data: task } = await ctx.supabaseAdmin
          .from("tasks")
          .select("*")
          .eq("workspace_id", connector.workspace_id)
          .is("deleted_at", null)
          .limit(1)
          .maybeSingle();
        if (task) {
          await ctx.supabaseAdmin.from("sync_conflicts").insert({
            connector_id: connectorId,
            task_id: task.id,
            local_snapshot: task,
            remote_snapshot: {
              ...task,
              title: `[远端版本] ${task.title}`,
              updated_at: new Date().toISOString(),
            },
          });
          conflictCount = 1;
        }
      }

      if (pending.length > 0) {
        await ctx.supabaseAdmin
          .from("sync_outbox")
          .update({ processed_at: new Date().toISOString() })
          .in(
            "id",
            pending.map((item) => item.id),
          );
      }

      const completedAt = new Date().toISOString();
      await ctx.supabaseAdmin
        .from("connector_instances")
        .update({
          last_synced_at: completedAt,
          next_sync_at: new Date(
            Date.now() + connector.schedule_minutes * 60_000,
          ).toISOString(),
        })
        .eq("id", connectorId);
      await ctx.supabaseAdmin
        .from("sync_runs")
        .update({
          status: conflictCount ? "conflict" : "succeeded",
          pushed_count: pending.length,
          conflict_count: conflictCount,
          finished_at: completedAt,
        })
        .eq("id", run.id);

      return Response.json({
        runId: run.id,
        status: conflictCount ? "conflict" : "succeeded",
        pushed: pending.length,
        conflicts: conflictCount,
        capabilities: connectorCapabilities[type],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed";
      await ctx.supabaseAdmin
        .from("sync_runs")
        .update({
          status: "failed",
          error_message: message,
          finished_at: new Date().toISOString(),
        })
        .eq("id", run.id);
      return Response.json({ error: message, runId: run.id }, { status: 500 });
    }
  }),
};
