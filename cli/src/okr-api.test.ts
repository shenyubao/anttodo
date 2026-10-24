import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  createOkrKeyResult, createOkrObjective, deleteOkrEntity, getOkrCycle, getOkrTree,
  setOkrTaskLink, updateOkrEntity, updateOkrProgress, type OkrContext,
} from "./okr-api.js";

vi.mock("./cache.js", () => ({ invalidateTaskCachesForWorkspace: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./storage.js", () => ({ getActiveServiceKey: () => "test-service" }));

const cycle = { id: "cycle", workspace_id: "workspace", status: "active", starts_on: "2026-01-01", ends_on: "2026-12-31", position: 0 };
const kr = { id: "kr", workspace_id: "workspace", objective_id: "objective", title: "KR", note: "**keep**", start_value: 0, target_value: 100, current_value: 20, metric_unit: "percent", custom_unit: null, weight: 100, progress_status: "risk", position: 0 };
const objective = { id: "objective", workspace_id: "workspace", set_id: "set", title: "O", key_results: [kr] };
const set = { id: "set", workspace_id: "workspace", cycle_id: "cycle", owner_id: "owner", objectives: [objective] };

type Row = Record<string, unknown>;
function fixture(options: { ownerId?: string; status?: string; rpcError?: { code: string; message: string }; deleteError?: boolean; deleteNoRows?: boolean; noSet?: boolean } = {}) {
  const tree = structuredClone(set);
  tree.owner_id = options.ownerId ?? "owner";
  const tables: Record<string, Row[]> = {
    okr_cycles: [{ ...cycle, status: options.status ?? "active" }],
    okr_sets: [tree], okr_objectives: [tree.objectives[0]], okr_key_results: [tree.objectives[0].key_results[0]],
    tasks: [{ id: "task", workspace_id: "workspace", kind: "todo", deleted_at: null }],
  };
  const queries: Array<{ table: string; filters: Array<[string, unknown]>; action: string }> = [];
  const rpc = vi.fn(async (name: string, payload: Record<string, unknown>) => {
    if (name === "load_okr_set") return { data: options.noSet ? null : tree, error: null };
    if (options.rpcError) return { data: null, error: options.rpcError };
    if (name === "save_okr_changes") return { data: tree, error: null };
    if (name === "set_task_okr_link") return { data: payload.p_key_result_id ? { task_id: "task", key_result_id: "kr" } : null, error: null };
    return { data: kr, error: null };
  });
  const from = vi.fn((table: string) => {
    const call = { table, filters: [] as Array<[string, unknown]>, action: "select" };
    queries.push(call);
    let inserted: Row | undefined;
    const result = () => {
      const rows = (tables[table] ?? []).filter((row) => call.filters.every(([key, value]) => row[key] === value));
      if (call.action === "delete") {
        if (options.deleteError) return { data: null, error: { code: "42501", message: "denied" } };
        if (options.deleteNoRows) return { data: [], error: null };
        if (table === "okr_key_results") tree.objectives[0].key_results = tree.objectives[0].key_results.filter((row) => !rows.includes(row));
      }
      return { data: inserted ? [{ id: "created", ...inserted }] : rows, error: null };
    };
    const query = {
      select: () => query, order: () => query, range: () => query,
      eq: (key: string, value: unknown) => { call.filters.push([key, value]); return query; },
      insert: (row: Row) => { inserted = row; call.action = "insert"; return query; },
      delete: () => { call.action = "delete"; return query; },
      maybeSingle: async () => { const r = result(); return { ...r, data: r.data?.[0] ?? null }; },
      single: async () => { const r = result(); return { ...r, data: r.data?.[0] ?? null }; },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
    };
    return query;
  });
  const context: OkrContext = { client: { from, rpc } as unknown as SupabaseClient, user: { id: "owner" }, workspace: { id: "workspace" } };
  return { context, rpc, from, tree, tables, queries };
}

describe("OKR data access", () => {
  it("scopes cycles and default trees to the selected workspace and user", async () => {
    const { context, rpc, queries } = fixture();
    const result = await getOkrTree(context);
    expect(result.set?.objectives[0].progress_percent).toBe(20);
    expect(rpc).toHaveBeenCalledWith("load_okr_set", { p_workspace_id: "workspace", p_cycle_id: "cycle", p_owner_id: "owner" });
    expect(queries[0].filters).toContainEqual(["workspace_id", "workspace"]);
  });
  it("does not fall back to a different cycle when none is active", async () => {
    const { context } = fixture({ status: "closed" });
    await expect(getOkrTree(context)).rejects.toMatchObject({ code: "no_active_okr_cycle" });
    await expect(getOkrCycle(context, "cycle")).resolves.toMatchObject({ status: "closed" });
  });
  it("blocks cross-workspace IDs and returns no false success", async () => {
    const { context, rpc } = fixture();
    context.workspace.id = "other";
    await expect(updateOkrEntity(context, "key_result", "kr", { title: "changed" })).rejects.toMatchObject({ type: "not_found" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{ ownerId: "someone-else" }, { status: "draft" }, { status: "closed" }])("blocks writes to unavailable ownership/cycles: %j", async (options) => {
    const { context, rpc } = fixture(options);
    await expect(updateOkrEntity(context, "objective", "objective", { title: "changed" })).rejects.toMatchObject({ code: "okr_not_writable" });
    expect(rpc).not.toHaveBeenCalledWith("save_okr_changes", expect.anything());
  });
  it("sends only the requested KR Markdown field and preserves relations and mentions", async () => {
    const { context, rpc } = fixture();
    await updateOkrEntity(context, "key_result", "kr", { note: "# Markdown\n\n@Existing" });
    expect(rpc).toHaveBeenLastCalledWith("save_okr_changes", {
      p_set_id: "set", p_publish: false,
      p_changes: { objectives: [{ id: "objective", key_results: [{ id: "kr", fields: { note: "# Markdown\n\n@Existing" } }] }] },
    });
  });
  it("requires a label for custom units", async () => {
    const { context } = fixture();
    await expect(updateOkrEntity(context, "key_result", "kr", { metric_unit: "custom" })).rejects.toMatchObject({ type: "validation" });
  });
  it("records progress through the history RPC and preserves omitted values", async () => {
    const { context, rpc } = fixture();
    await updateOkrProgress(context, "kr", { detail: "progress detail" });
    expect(rpc).toHaveBeenLastCalledWith("update_okr_key_result_progress", {
      p_key_result_id: "kr", p_current_value: 20, p_status: "risk", p_detail: "progress detail",
    });
    await updateOkrProgress(context, "kr", { value: null, status: "none" });
    expect(rpc).toHaveBeenLastCalledWith("update_okr_key_result_progress", expect.objectContaining({ p_current_value: null, p_status: "none" }));
  });
  it("equally balances existing and new KRs in the creation transaction", async () => {
    const { context, rpc } = fixture();
    await createOkrKeyResult(context, "objective", "new");
    expect(rpc).toHaveBeenLastCalledWith("create_okr_key_result_with_balanced_weights", {
      p_objective_id: "objective", p_workspace_id: "workspace", p_title: "new", p_position: 1,
      p_existing_ids: ["kr"], p_existing_weights: [50], p_new_weight: 50,
    });
  });
  it("creates a missing set and forces KR-based objective progress", async () => {
    const { context, queries } = fixture({ noSet: true });
    await expect(createOkrObjective(context, "new", "cycle")).resolves.toMatchObject({ title: "new", progress_mode: "key_results" });
    expect(queries.filter((call) => call.action === "insert").map((call) => call.table)).toEqual(["okr_sets", "okr_objectives"]);
  });
  it("reports a deletion permission failure without trying to rebalance", async () => {
    const { context, rpc } = fixture({ deleteError: true });
    await expect(deleteOkrEntity(context, "key_result", "kr")).rejects.toMatchObject({ type: "authorization", code: "42501" });
    expect(rpc).not.toHaveBeenCalledWith("save_okr_changes", expect.anything());
  });
  it("reports partial completion when rebalancing fails after a successful delete", async () => {
    const { context, tree } = fixture({ rpcError: { code: "500", message: "network unavailable" } });
    tree.objectives[0].key_results.push({ ...kr, id: "kr2", position: 1 });
    await expect(deleteOkrEntity(context, "key_result", "kr")).rejects.toMatchObject({
      code: "okr_partial_failure", details: { completed: { deleted_key_result_id: "kr", objective_id: "objective" } },
    });
  });
  it("does not report success or rebalance when deletion silently affects no rows", async () => {
    const { context, rpc } = fixture({ deleteNoRows: true });
    await expect(deleteOkrEntity(context, "key_result", "kr")).rejects.toMatchObject({ type: "not_found" });
    expect(rpc).not.toHaveBeenCalledWith("save_okr_changes", expect.anything());
  });
  it("rebalances the remaining KR weights after deletion in one save RPC", async () => {
    const { context, rpc, tree } = fixture();
    tree.objectives[0].key_results.push({ ...kr, id: "kr2", position: 1 });
    await expect(deleteOkrEntity(context, "key_result", "kr")).resolves.toEqual({ id: "kr", deleted: true });
    expect(rpc).toHaveBeenLastCalledWith("save_okr_changes", {
      p_set_id: "set", p_publish: false,
      p_changes: { objectives: [{ id: "objective", key_results: [{ id: "kr2", fields: { weight: 100 } }] }] },
    });
  });
  it("allows unlink without looking up the old KR, even in a closed cycle", async () => {
    const { context, rpc, from } = fixture({ status: "closed" });
    await expect(setOkrTaskLink(context, "task", null)).resolves.toEqual({ task_id: "task", key_result_id: null });
    expect(from).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("set_task_okr_link", { p_task_id: "task", p_key_result_id: null });
  });
  it("surfaces network errors and never queues a write", async () => {
    const { context, rpc } = fixture();
    rpc.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(getOkrTree(context)).rejects.toThrow("fetch failed");
  });
});
