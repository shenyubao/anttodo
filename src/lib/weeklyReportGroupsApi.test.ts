import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createDemoWeeklyReportGroups, deleteWeeklyReportGroup, loadWeeklyReportGroups, saveWeeklyReportGroup } from "./weeklyReportGroupsApi";

const group = createDemoWeeklyReportGroups("team", ["user"])[0];
describe("weekly report group sources API", () => {
  it("normalizes old server snapshots without changing their effective roster", async () => {
    const legacy = { ...group };
    delete (legacy as Partial<typeof group>).created_by;
    delete (legacy as Partial<typeof group>).participant_mode;
    delete (legacy as Partial<typeof group>).participant_group_ids;
    const rpc = vi.fn().mockResolvedValue({ data: [legacy], error: null });
    expect(await loadWeeklyReportGroups({ rpc } as unknown as SupabaseClient, "team")).toEqual([group]);
  });
  it("submits group references without trusting the preview roster", async () => {
    const saved = { ...group, participant_mode: "groups" as const, participant_group_ids: ["g"], participant_ids: ["confirmed"] };
    const rpc = vi.fn().mockResolvedValue({ data: saved, error: null });
    expect(await saveWeeklyReportGroup({ rpc } as unknown as SupabaseClient, "team", { ...saved, participant_ids: ["preview"] })).toMatchObject(saved);
    expect(rpc).toHaveBeenCalledWith("save_weekly_report_group", expect.objectContaining({
      p_participant_mode: "groups", p_participant_group_ids: ["g"], p_participant_ids: [],
    }));
  });
  it("removes inactive group references in user mode", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: group, error: null });
    await saveWeeklyReportGroup({ rpc } as unknown as SupabaseClient, "team", { ...group, participant_group_ids: ["inactive"] });
    expect(rpc).toHaveBeenCalledWith("save_weekly_report_group", expect.objectContaining({
      p_participant_mode: "users", p_participant_group_ids: [], p_participant_ids: ["user"],
    }));
  });
});

it("deletes the requested group through the permission-checked RPC", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: "target", error: null });
  await deleteWeeklyReportGroup({ rpc } as unknown as SupabaseClient, "team", "target");
  expect(rpc).toHaveBeenCalledWith("delete_weekly_report_group", { p_workspace_id: "team", p_id: "target" });
});
it("rejects denied and unconfirmed deletion responses", async () => {
  const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { message: "无权删除" } }).mockResolvedValueOnce({ data: null, error: null });
  const client = { rpc } as unknown as SupabaseClient;
  await expect(deleteWeeklyReportGroup(client, "team", "target")).rejects.toThrow("无权删除");
  await expect(deleteWeeklyReportGroup(client, "team", "target")).rejects.toThrow("无法确认删除结果");
});

it("preserves server creator attribution without sending client ownership fields", async () => {
  const saved = { ...group, created_by: "server-user" };
  const rpc = vi.fn().mockResolvedValue({ data: saved, error: null });
  expect(await saveWeeklyReportGroup({ rpc } as unknown as SupabaseClient, "team", saved)).toMatchObject({ created_by: "server-user" });
  expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_created_by");
});
