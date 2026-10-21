import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { loadWeeklyReports, saveWeeklyReport, weeklyReportsKey } from "./weeklyReportsApi";

describe("weekly reports API", () => {
  it("saves selected notification groups through the weekly report RPC", async () => {
    const row = {
      id: "report-1",
      workspace_id: "workspace-1",
      author_id: "user-1",
      week_start: "2026-08-31",
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
    const rpc = vi.fn().mockResolvedValue({ data: row, error: null });
    const result = await saveWeeklyReport({ rpc } as unknown as SupabaseClient, {
      workspaceId: "workspace-1",
      weeklyReportGroupId: "report-group-1",
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

    expect(rpc).toHaveBeenCalledWith("save_group_weekly_report", expect.objectContaining({
      p_weekly_report_group_id: "report-group-1",
      p_notification_group_ids: ["group-1", "group-2"],
    }));
    expect(result.notification_group_ids).toEqual(["group-1", "group-2"]);
    expect(result.notification_summary).toBeNull();
  });
});

describe("OKR report persistence", () => {
  it.each([undefined, "", "- OKR"])("sends optional OKR text without clearing on omission (%s)", async (okrProgressText) => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: "report", okr_progress_text: "saved" }, error: null });
    const report = await saveWeeklyReport({ rpc } as unknown as SupabaseClient, {
      workspaceId: "workspace", weeklyReportGroupId: "report-group-1", weekStart: "2026-10-12", completedText: "", nextPlanText: "", reflectionText: "",
      visibility: "workspace", userIds: [], groupIds: [], notificationGroupIds: [], publish: false, okrProgressText,
    });
    const input = rpc.mock.calls[0][1];
    if (okrProgressText === undefined) expect(input).not.toHaveProperty("p_okr_progress_text");
    else expect(input).toHaveProperty("p_okr_progress_text", okrProgressText);
    expect(report.okr_progress_text).toBe("saved");
  });
});


it("filters reports on the server by group and uses separate cache keys", async () => {
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn().mockResolvedValue({ data: [], error: null }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  await loadWeeklyReports({ from: () => query } as unknown as SupabaseClient, "workspace", "2026-10-12", "group-a");
  expect(query.eq).toHaveBeenCalledWith("weekly_report_group_id", "group-a");
  expect(weeklyReportsKey("workspace", "2026-10-12", "group-a")).not.toEqual(weeklyReportsKey("workspace", "2026-10-12", "group-b"));
});
