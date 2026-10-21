import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  createWeeklyReport,
  listTasks,
  listWeeklyReports,
  saveWeeklyReport,
  updateWeeklyReport,
} from "./api.js";
import { CliError } from "./errors.js";
import { weeklyReportWeekStart } from "./validation.js";

describe("task list query", () => {
  it("selects dependencies through the owning task foreign key", async () => {
    let taskSelect = "";
    const query = {
      select(columns: string) {
        taskSelect = columns;
        return this;
      },
      eq() {
        return this;
      },
      order() {
        return this;
      },
      range() {
        return this;
      },
      is() {
        return this;
      },
      then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
        return Promise.resolve({ data: [], error: null }).then(resolve);
      },
    };
    const client = {
      from: () => query,
    } as unknown as SupabaseClient;

    await listTasks(client, "workspace-1", "todo", { limit: 100, offset: 0 });

    expect(taskSelect).toContain(
      "task_dependencies:task_dependencies!task_dependencies_task_id_fkey(*)",
    );
  });
});

function createQuery(result: unknown) {
  const query: Record<string, unknown> = {};
  const chain = () => query;
  query.select = chain;
  query.eq = chain;
  query.in = chain;
  query.order = chain;
  query.range = chain;
  query.maybeSingle = () => Promise.resolve({
    data: Array.isArray(result) ? result[0] ?? null : result,
    error: null,
  });
  query.then = (
    resolve: (value: { data: unknown; error: null }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve({ data: result, error: null }).then(resolve, reject);
  return query;
}

const weeklyReportRow = {
  id: "report-1",
  workspace_id: "workspace-1",
  author_id: "user-1",
  week_start: "2026-08-31",
  okr_progress_text: "",
  completed_text: "完成",
  next_plan_text: "计划",
  reflection_text: "总结",
  status: "published",
  visibility: "workspace",
  notification_revision: 1,
  published_at: "2026-09-04T00:00:00Z",
  created_at: "2026-09-04T00:00:00Z",
  updated_at: "2026-09-04T00:00:00Z",
};

describe("weekly reports API", () => {
  it("saves selected notification groups through the weekly report RPC", async () => {
    const rpcCalls: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const client = {
      rpc(name: string, payload: Record<string, unknown>) {
        rpcCalls.push({ name, payload });
        return Promise.resolve({ data: weeklyReportRow, error: null });
      },
    } as unknown as SupabaseClient;

    const result = await saveWeeklyReport(client, {
      workspaceId: "workspace-1",
      weekStart: "2026-08-31",
      completedText: "完成",
      nextPlanText: "计划",
      reflectionText: "总结",
      visibility: "workspace",
      userIds: [],
      groupIds: [],
      notificationGroupIds: ["group-1", "group-2"],
      publish: true,
    });

    expect(rpcCalls).toEqual([{
      name: "save_weekly_report",
      payload: {
        p_workspace_id: "workspace-1",
        p_week_start: "2026-08-31",
        p_completed_text: "完成",
        p_next_plan_text: "计划",
        p_reflection_text: "总结",
        p_visibility: "workspace",
        p_user_ids: [],
        p_group_ids: [],
        p_report_id: null,
        p_publish: true,
        p_notification_group_ids: ["group-1", "group-2"],
      },
    }]);
    expect(result.notification_group_ids).toEqual(["group-1", "group-2"]);
    expect(result.notification_summary).toBeNull();
  });

  it("lists weekly reports for a week and attaches ACL ids", async () => {
    const tables: string[] = [];
    const client = {
      from(table: string) {
        tables.push(table);
        if (table === "weekly_reports") return createQuery([weeklyReportRow]);
        if (table === "weekly_report_user_acl") {
          return createQuery([{ report_id: "report-1", user_id: "user-2" }]);
        }
        if (table === "weekly_report_group_acl") return createQuery([]);
        if (table === "weekly_report_notification_targets") {
          return createQuery([{ report_id: "report-1", notification_group_id: "notify-1" }]);
        }
        if (table === "weekly_report_notification_deliveries") return createQuery([]);
        return createQuery([]);
      },
    } as unknown as SupabaseClient;

    const reports = await listWeeklyReports(client, "workspace-1", {
      weekStart: "2026-08-31",
      limit: 100,
      offset: 0,
    });

    expect(tables[0]).toBe("weekly_reports");
    expect(reports).toEqual([{
      ...weeklyReportRow,
      user_acl_ids: ["user-2"],
      group_acl_ids: [],
      notification_group_ids: ["notify-1"],
      notification_summary: null,
    }]);
  });

  it("rejects creating a second weekly report for the same week", async () => {
    const client = {
      from() {
        return createQuery([{ id: "report-1" }]);
      },
      rpc() {
        throw new Error("RPC should not run when a report already exists");
      },
    } as unknown as SupabaseClient;

    await expect(createWeeklyReport(client, "user-1", {
      workspaceId: "workspace-1",
      weekStart: weeklyReportWeekStart(),
      completedText: "完成",
      nextPlanText: "",
      reflectionText: "",
      visibility: "workspace",
      userIds: [],
      groupIds: [],
      notificationGroupIds: [],
      publish: false,
    })).rejects.toMatchObject({
      code: "already_exists",
      details: { id: "report-1" },
    } satisfies Partial<CliError>);
  });

  it("rejects creating a weekly report outside this or last week", async () => {
    const client = {
      from() {
        throw new Error("existing-report lookup should not run for an invalid week");
      },
      rpc() {
        throw new Error("RPC should not run for an invalid week");
      },
    } as unknown as SupabaseClient;

    await expect(createWeeklyReport(client, "user-1", {
      workspaceId: "workspace-1",
      weekStart: "2020-01-06",
      completedText: "完成",
      nextPlanText: "",
      reflectionText: "",
      visibility: "workspace",
      userIds: [],
      groupIds: [],
      notificationGroupIds: [],
      publish: false,
    })).rejects.toMatchObject({ code: "invalid_weekly_report_week" });
  });
});


describe("OKR report CLI compatibility", () => {
  it("preserves OKR-only content when publishing or updating existing reports", async () => {
    let payload: Record<string, unknown> = {};
    const row = { ...weeklyReportRow, okr_progress_text: "- Saved OKR", completed_text: "", next_plan_text: "", reflection_text: "" };
    const client = {
      from: (table: string) => createQuery(table === "weekly_reports" ? [row] : []),
      rpc: (_name: string, input: Record<string, unknown>) => {
        payload = input; return Promise.resolve({ data: row, error: null });
      },
    } as unknown as SupabaseClient;
    const result = await updateWeeklyReport(client, "workspace-1", "report-1", { publish: true });
    expect(payload.p_okr_progress_text).toBe("- Saved OKR");
    expect(result.okr_progress_text).toBe("- Saved OKR");
  });
});
