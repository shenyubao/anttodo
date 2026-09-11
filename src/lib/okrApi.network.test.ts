import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  createOkrKeyResultWithBalancedWeights,
  loadOkrSet,
  publishOkrSet,
} from "./okrApi";

describe("OKR network round trips", () => {
  it("loads a complete OKR set with one RPC request and normalizes numeric values", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        id: "set-1",
        workspace_id: "workspace-1",
        cycle_id: "cycle-1",
        owner_id: "user-1",
        visibility: "workspace",
        published_version: 0,
        published_at: null,
        created_at: "2026-09-04T00:00:00Z",
        updated_at: "2026-09-04T00:00:00Z",
        user_acl_ids: [],
        group_acl_ids: [],
        objectives: [{
          id: "objective-1",
          set_id: "set-1",
          workspace_id: "workspace-1",
          title: "Ship",
          note: "",
          position: 0,
          visibility: "inherit",
          progress_mode: "manual",
          status_mode: "manual",
          progress_status: "none",
          start_value: "0",
          target_value: "100",
          current_value: "25",
          metric_unit: "percent",
          custom_unit: null,
          score: "0.5",
          published_at: null,
          created_at: "2026-09-04T00:00:00Z",
          updated_at: "2026-09-04T00:00:00Z",
          responsible_ids: [],
          user_acl_ids: [],
          group_acl_ids: [],
          alignment_target_id: null,
          key_results: [{
            id: "kr-1",
            objective_id: "objective-1",
            workspace_id: "workspace-1",
            title: "Reach 100",
            position: 0,
            visibility: "inherit",
            status_mode: "manual",
            progress_status: "normal",
            start_value: "0",
            target_value: "100",
            current_value: "25",
            metric_unit: "percent",
            custom_unit: null,
            weight: "100",
            score: null,
            published_at: null,
            created_at: "2026-09-04T00:00:00Z",
            updated_at: "2026-09-04T00:00:00Z",
            responsible_ids: [],
            user_acl_ids: [],
            group_acl_ids: [],
            breakdowns: [],
          }],
        }],
      },
      error: null,
    });
    const client = { rpc } as unknown as SupabaseClient;

    const result = await loadOkrSet(client, "workspace-1", "cycle-1", "user-1");

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("load_okr_set", {
      p_workspace_id: "workspace-1",
      p_cycle_id: "cycle-1",
      p_owner_id: "user-1",
    });
    expect(result?.objectives[0]?.current_value).toBe(25);
    expect(result?.objectives[0]?.key_results[0]?.weight).toBe(100);
  });

  it("creates a Key Result and rebalances all existing weights in one RPC request", async () => {
    const created = {
      id: "kr-3",
      objective_id: "objective-1",
      workspace_id: "workspace-1",
      title: "Third result",
      position: 2,
      weight: "33.34",
    };
    const rpc = vi.fn().mockResolvedValue({ data: created, error: null });
    const client = { rpc } as unknown as SupabaseClient;

    const result = await createOkrKeyResultWithBalancedWeights(client, {
      objective_id: "objective-1",
      workspace_id: "workspace-1",
      title: "Third result",
      position: 2,
      weight: 33.34,
    }, [
      { id: "kr-1", weight: 33.33 },
      { id: "kr-2", weight: 33.33 },
    ]);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("create_okr_key_result_with_balanced_weights", {
      p_objective_id: "objective-1",
      p_workspace_id: "workspace-1",
      p_title: "Third result",
      p_position: 2,
      p_existing_ids: ["kr-1", "kr-2"],
      p_existing_weights: [33.33, 33.33],
      p_new_weight: 33.34,
    });
    expect(result).toBe(created);
  });

  it("translates publish_okr_set validation errors", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Key Result weights must add up to 100 for objective "增长"' },
    });
    const client = { rpc } as unknown as SupabaseClient;

    await expect(publishOkrSet(client, "set-1")).rejects.toThrow(
      "无法发布：「增长」的 Key Result 权重之和必须等于 100%",
    );
    expect(rpc).toHaveBeenCalledWith("publish_okr_set", { p_set_id: "set-1" });
  });
});
