import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applySavedUserGroup, saveUserGroup } from "./userGroupsApi";
import { createDemoBundle } from "./demo";

describe("transactional user group saves", () => {
  it("sends one RPC with the editor snapshot and canonical member IDs", async () => {
    const bundle = createDemoBundle();
    const saved = { group: bundle.userGroups[0], members: [], name_changed: true, members_changed: true };
    const rpc = vi.fn().mockResolvedValue({ data: saved, error: null });
    await expect(saveUserGroup({ rpc } as unknown as SupabaseClient, "team", {
      id: "group", name: "  Design  ", memberIds: ["b", "a", "b"], expected: { name: "Old", memberIds: ["b", "a"] },
    })).resolves.toEqual(saved);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_user_group", {
      p_workspace_id: "team", p_id: "group", p_name: "Design", p_member_ids: ["a", "b"],
      p_expected_name: "Old", p_expected_member_ids: ["a", "b"],
    });
    const next = applySavedUserGroup(bundle, saved);
    expect(next.tasks).toBe(bundle.tasks);
    expect(next.userGroups.filter((group) => group.id === saved.group.id)).toHaveLength(1);
    expect(next.userGroupMembers.some((member) => member.group_id === saved.group.id)).toBe(false);
  });
  it("reports a conflict without retrying or treating uncertain writes as failures to resubmit", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: "PT409", message: "conflict" } });
    const client = { rpc } as unknown as SupabaseClient;
    await expect(saveUserGroup(client, "team", { id: "id", name: "Name", memberIds: [] })).rejects.toThrow("重新打开");
    expect(rpc).toHaveBeenCalledOnce();
    rpc.mockResolvedValue({ error: { code: "", message: "Failed to fetch" } });
    await expect(saveUserGroup(client, "team", { id: "id", name: "Name", memberIds: [] })).rejects.toThrow("核对");
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
