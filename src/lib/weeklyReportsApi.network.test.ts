import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { saveWeeklyReport } from "./weeklyReportsApi";

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

    expect(rpc).toHaveBeenCalledWith("save_weekly_report", expect.objectContaining({
      p_notification_group_ids: ["group-1", "group-2"],
    }));
    expect(result.notification_group_ids).toEqual(["group-1", "group-2"]);
    expect(result.notification_summary).toBeNull();
  });
});
