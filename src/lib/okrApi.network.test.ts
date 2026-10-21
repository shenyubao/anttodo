import { createDemoOkrData } from "./demoOkr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  buildOkrChanges,
  saveOkrChanges,
  updateOkrObjective,
  createOkrKeyResultWithBalancedWeights,
  loadOkrSet,
  loadOkrLinkedTaskCounts,
  okrLinkedTaskCountsKey,
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

describe("batched OKR saves", () => {
  function fixture() {
    return createDemoOkrData().sets.find((set) => set.owner_id === "demo-user" && set.objectives.length === 2)!;
  }

  it("ignores server metadata and unchanged relationship arrays", () => {
    const before = fixture();
    const next = structuredClone(before.objectives);
    next[0].updated_at = "later";
    next[0].key_results[0].updated_at = "later";
    expect(buildOkrChanges(next, before.objectives)).toEqual({ objectives: [] });
    next[0].title = "  New title  ";
    expect(buildOkrChanges(next, before.objectives)).toEqual({
      objectives: [{ id: next[0].id, fields: { title: "New title" } }],
    });
    expect(buildOkrChanges(next, structuredClone(next))).toEqual({ objectives: [] });
  });

  it("saves KR Markdown and mention identities together without unrelated fields", () => {
    const before = fixture();
    const next = structuredClone(before.objectives);
    next[0].key_results[0].note = "**Follow up** @Viewer";
    next[0].key_results[0].note_mentions = [{ user_id: "viewer", display_name_snapshot: "Viewer" }];
    expect(buildOkrChanges(next, before.objectives)).toEqual({ objectives: [{ id: next[0].id,
      key_results: [{ id: next[0].key_results[0].id, fields: { note: "**Follow up** @Viewer" }, mentioned_user_ids: ["viewer"] }] }] });
  });

  it("sends all changed Objectives, KRs and relationships in one RPC", async () => {
    const before = fixture();
    const next = structuredClone(before);
    next.objectives[0].title = "Updated";
    next.objectives[0].responsible_ids = ["demo-member"];
    next.objectives[0].alignment_target_id = next.objectives[1].id;
    next.objectives[0].key_results[0].title = "KR changed";
    next.objectives[0].key_results[1].user_acl_ids = ["demo-member"];
    next.objectives[1].key_results[0].weight = 40;
    next.objectives[1].key_results[1].weight = 60;
    const changes = buildOkrChanges(next.objectives, before.objectives);
    const rpc = vi.fn().mockResolvedValue({ data: next, error: null });
    const from = vi.fn();
    const client = { rpc, from } as unknown as SupabaseClient;
    const saved = await saveOkrChanges(client, before.id, changes);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_okr_changes", {
      p_set_id: before.id, p_changes: changes, p_publish: false,
    });
    expect(from).not.toHaveBeenCalled();
    expect(saved?.objectives[0].title).toBe("Updated");
    expect(changes.objectives[0].key_results?.[0]).toEqual({
      id: next.objectives[0].key_results[0].id, fields: { title: "KR changed" },
    });
  });

  it("uses the same atomic RPC for standalone Objective edits without rewriting KRs", async () => {
    const set = fixture();
    const rpc = vi.fn().mockResolvedValue({ data: set, error: null });
    const from = vi.fn();
    const client = { rpc, from } as unknown as SupabaseClient;
    const result = await updateOkrObjective(client, set.objectives[0]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("save_okr_changes");
    expect(rpc.mock.calls[0][1].p_changes.objectives[0].key_results).toBeUndefined();
    expect(from).not.toHaveBeenCalled();
    expect(result.id).toBe(set.objectives[0].id);
  });

  it("skips unchanged saves and still publishes an unchanged set with one RPC", async () => {
    const set = fixture();
    const rpc = vi.fn().mockResolvedValue({ data: set, error: null });
    const client = { rpc } as unknown as SupabaseClient;
    expect(await saveOkrChanges(client, set.id, { objectives: [] })).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    await saveOkrChanges(client, set.id, { objectives: [] }, true);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_okr_changes", {
      p_set_id: set.id, p_changes: { objectives: [] }, p_publish: true,
    });
  });

  it("explicitly sends cleared relations without including generated breakdown metadata", () => {
    const set = fixture();
    const before = set.objectives[0];
    before.responsible_ids = ["demo-user"];
    const next = structuredClone(before);
    next.responsible_ids = [];
    next.key_results[0].breakdowns = [{ id: "generated", key_result_id: "kr", workspace_id: "workspace", user_id: "demo-user", allocated_value: 100, position: 0 }];
    const changes = buildOkrChanges([next], [before]);
    expect(changes.objectives[0].responsible_ids).toEqual([]);
    expect(changes.objectives[0].key_results?.[0].breakdowns).toEqual([{ user_id: "demo-user", allocated_value: 100 }]);
  });

  it("propagates save failures and preserves publish validation messages", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "Save failed" } });
    const client = { rpc } as unknown as SupabaseClient;
    await expect(saveOkrChanges(client, "set", { objectives: [{ id: "o", fields: { title: "New" } }] })).rejects.toThrow("Save failed");
    rpc.mockResolvedValue({ data: null, error: { message: 'Key Result weights must add up to 100 for objective "增长"' } });
    await expect(saveOkrChanges(client, "set", { objectives: [] }, true)).rejects.toThrow("无法发布：「增长」的 Key Result 权重之和必须等于 100%");
  });
});

describe("OKR linked task counts", () => {
  function clientFor(rows: Array<{ task_id: string; key_result_id: string }>, error?: string) {
    let batch: string[] = [];
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      in: vi.fn((_: string, ids: string[]) => { batch = ids; return query; }),
      is: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      range: vi.fn(async (from: number, to: number) => ({
        data: rows.filter((row) => batch.includes(row.key_result_id)).slice(from, to + 1),
        error: error ? { message: error } : null,
      })),
    };
    const from = vi.fn(() => query);
    return { client: { from } as unknown as SupabaseClient, from, query };
  }

  it("counts all KRs in one request using the detail list's task visibility and deletion filter", async () => {
    const { client, from, query } = clientFor([
      { task_id: "a", key_result_id: "kr1" }, { task_id: "b", key_result_id: "kr1" },
      { task_id: "c", key_result_id: "kr2" },
    ]);
    expect(await loadOkrLinkedTaskCounts(client, "workspace", ["kr1", "kr2", "kr3"]))
      .toEqual({ kr1: 2, kr2: 1, kr3: 0 });
    expect(from).toHaveBeenCalledExactlyOnceWith("task_okr_links");
    expect(query.select).toHaveBeenCalledWith("task_id,key_result_id,tasks!inner(id)");
    expect(query.eq).toHaveBeenCalledWith("workspace_id", "workspace");
    expect(query.is).toHaveBeenCalledWith("tasks.deleted_at", null);
    expect(query.range).toHaveBeenCalledTimes(1);
  });

  it("does not query an empty set and uses a stable key across KR reorderings", async () => {
    const { client, from } = clientFor([]);
    expect(await loadOkrLinkedTaskCounts(client, "workspace", [])).toEqual({});
    expect(from).not.toHaveBeenCalled();
    expect(okrLinkedTaskCountsKey("workspace", "set", ["b", "a"]))
      .toEqual(okrLinkedTaskCountsKey("workspace", "set", ["a", "b"]));
  });

  it("paginates links and bounds ID batches instead of truncating counts", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({ task_id: String(index), key_result_id: "kr-000" }));
    rows.push({ task_id: "last", key_result_id: "kr-080" });
    const { client, query } = clientFor(rows);
    const ids = Array.from({ length: 81 }, (_, index) => `kr-${String(index).padStart(3, "0")}`);
    const counts = await loadOkrLinkedTaskCounts(client, "workspace", ids);
    expect(counts["kr-000"]).toBe(501);
    expect(counts["kr-080"]).toBe(1);
    expect(query.in.mock.calls.every((call) => call[1].length <= 80)).toBe(true);
    expect(query.range).toHaveBeenCalledTimes(3);
  });

  it("reports failed reads rather than caching a false zero", async () => {
    const { client } = clientFor([], "Permission changed");
    await expect(loadOkrLinkedTaskCounts(client, "workspace", ["kr1"])).rejects.toThrow("Permission changed");
  });
});
