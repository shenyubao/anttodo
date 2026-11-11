import type { SupabaseClient } from "@supabase/supabase-js";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoBundle } from "./demo";
import { createSupabaseUserGroupAdapter, mergeUserGroupSnapshot, userGroupPermissionsKey, UserGroupSubmissionError, writeUserGroup, writeAtomicUserGroup,
  type UserGroupSubmission } from "./userGroupMutations";
import type { UserGroup, UserGroupMember, WorkspaceBundle } from "../types";

const input: UserGroupSubmission = { operationId: "op", userId: "owner", workspaceId: "workspace-team", entityId: "group",
  kind: "create", name: "产品组", memberIds: ["member"] };

beforeEach(() => vi.stubGlobal("navigator", { onLine: true }));
afterEach(() => vi.unstubAllGlobals());

function backend() {
  const tables: Record<string, Record<string, unknown>[]> = { user_groups: [], user_group_members: [] };
  const calls: string[] = [];
  let fail: { request: string; after?: boolean } | undefined;
  const from = (table: string) => {
    let action = "select";
    let values: Record<string, unknown>[] = [];
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    const run = async (single = false) => {
      const request = `${table}:${action}`;
      calls.push(request);
      const failure = fail?.request === request ? fail : undefined;
      if (failure) fail = undefined;
      if (failure && !failure.after) return { data: null, error: { message: "Permission denied" } };
      const selected = tables[table].filter((row) => filters.every((filter) => filter(row)));
      if (action === "insert") {
        if (table === "user_groups" && values.some((row) => tables[table].some((other) => other.id === row.id))) return { data: null, error: { message: "Duplicate id" } };
        tables[table].push(...values.map((row) => ({ created_at: "now", updated_at: "now", added_at: "now", ...row })));
      }
      if (action === "update") selected.forEach((row) => Object.assign(row, values[0]));
      if (action === "delete") {
        tables[table] = tables[table].filter((row) => !selected.includes(row));
        if (table === "user_groups") tables.user_group_members = tables.user_group_members.filter((row) => !selected.some((group) => group.id === row.group_id));
      }
      if (failure?.after) throw new Error("Response lost");
      return { data: structuredClone(single ? selected[0] ?? null : selected), error: null };
    };
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
      in: (key: string, value: unknown[]) => { filters.push((row) => value.includes(row[key])); return query; },
      insert: (value: Record<string, unknown> | Record<string, unknown>[]) => { action = "insert"; values = Array.isArray(value) ? value : [value]; return query; },
      update: (value: Record<string, unknown>) => { action = "update"; values = [value]; return query; },
      delete: () => { action = "delete"; return query; },
      maybeSingle: () => run(true),
      then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => run().then(resolve, reject),
    };
    return query;
  };
  return { client: { from } as unknown as SupabaseClient, tables, calls,
    failNext: (request: string, after = false) => { fail = { request, after }; } };
}

describe("user group writes", () => {
  it("keeps a partially created group and resumes members with the same id", async () => {
    const db = backend();
    db.failNext("user_group_members:insert");
    const error = await writeUserGroup(db.client, input).catch((cause) => cause) as UserGroupSubmissionError;
    expect(error.outcome).toBe("partial");
    expect(error.snapshot?.group?.id).toBe(input.entityId);
    expect(db.tables.user_groups).toHaveLength(1);
    expect(db.calls).not.toContain("user_groups:delete");
    expect((await writeUserGroup(db.client, input)).members.map((member) => member.user_id)).toEqual(["member"]);
    expect(db.calls.filter((call) => call === "user_groups:insert")).toHaveLength(1);
  });

  it("recognizes a committed member write after its response is lost", async () => {
    const db = backend();
    db.failNext("user_group_members:insert", true);
    expect((await writeUserGroup(db.client, input)).members).toHaveLength(1);
    await writeUserGroup(db.client, input);
    expect(db.calls.filter((call) => call === "user_group_members:insert")).toHaveLength(1);
  });

  it("reconciles a lost create response before resuming the same group", async () => {
    const db = backend();
    db.failNext("user_groups:insert", true);
    await expect(writeUserGroup(db.client, input)).rejects.toMatchObject({ outcome: "partial" });
    await writeUserGroup(db.client, input);
    expect(db.tables.user_groups).toHaveLength(1);
    expect(db.tables.user_group_members).toHaveLength(1);
  });

  it("computes an edit against current remote membership and reports partial changes", async () => {
    const db = backend();
    await writeUserGroup(db.client, input);
    db.tables.user_group_members.push({ workspace_id: input.workspaceId, group_id: input.entityId, user_id: "remote-member", added_at: "now" });
    db.failNext("user_group_members:insert");
    await expect(writeUserGroup(db.client, { ...input, kind: "update", name: "研发组", memberIds: ["new-member"] }))
      .rejects.toMatchObject({ outcome: "partial", snapshot: { group: { name: "研发组" }, members: [] } });
    const result = await writeUserGroup(db.client, { ...input, kind: "update", name: "研发组", memberIds: ["new-member"] });
    expect(result.members.map((member) => member.user_id)).toEqual(["new-member"]);
  });

  it("distinguishes rejection from unknown results and never queues offline writes", async () => {
    const db = backend();
    db.failNext("user_groups:insert");
    await expect(writeUserGroup(db.client, input)).rejects.toMatchObject({ outcome: "failed", snapshot: { group: null } });
    vi.stubGlobal("navigator", { onLine: false });
    const count = db.calls.length;
    try { await expect(writeUserGroup(db.client, input)).rejects.toMatchObject({ outcome: "unknown" }); }
    finally { vi.unstubAllGlobals(); }
    expect(db.calls).toHaveLength(count);
  });

  it("treats a lost delete response and a repeated deletion as success", async () => {
    const db = backend();
    await writeUserGroup(db.client, input);
    db.failNext("user_groups:delete", true);
    const deletion = { ...input, kind: "delete" as const };
    expect(await writeUserGroup(db.client, deletion)).toEqual({ group: null, members: [] });
    await writeUserGroup(db.client, deletion);
    expect(db.calls.filter((call) => call === "user_groups:delete")).toHaveLength(1);
  });
});

describe("user group cache reconciliation", () => {
  it("keeps permissions locked until all concurrent writes settle", async () => {
    const db = backend();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const key = ["workspace-bundle", input.workspaceId];
    client.setQueryData(key, createDemoBundle());
    const refresh = vi.fn(async () => client.getQueryData<WorkspaceBundle>(key)!);
    const observer = new QueryObserver(client, { queryKey: key, queryFn: refresh });
    const stop = observer.subscribe(() => {});
    const adapter = createSupabaseUserGroupAdapter({ client: db.client, write: writeUserGroup, queryClient: client, userId: input.userId, active: () => true, onNotice: vi.fn() });
    try {
      const second = { ...input, operationId: "second-op", entityId: "second-group", name: "第二组" };
      const results = await Promise.all([adapter.submit(input), adapter.submit(second)]);
      await adapter.settle(input, results[0]);
      // A failed preflight never started a write and must not release another operation's lock.
      await adapter.settle({ ...input, operationId: "not-started" });
      expect(refresh).not.toHaveBeenCalled();
      expect(client.getQueryData(userGroupPermissionsKey(input.userId, input.workspaceId))).toEqual({ verified: false });
      await adapter.settle(second, results[1]);
      await vi.waitFor(() => expect(client.getQueryData(userGroupPermissionsKey(input.userId, input.workspaceId))).toEqual({ verified: true }));
      expect(client.getQueryData<WorkspaceBundle>(key)!.userGroups.filter((group) => [input.entityId, second.entityId].includes(group.id))).toHaveLength(2);
    } finally { stop(); client.clear(); }
  });

  it("merges one group without losing concurrent tasks or other groups", () => {
    const bundle = createDemoBundle();
    const snapshot = { group: { id: input.entityId, workspace_id: input.workspaceId, name: input.name } as UserGroup,
      members: [{ group_id: input.entityId, user_id: "member" } as UserGroupMember] };
    const merged = mergeUserGroupSnapshot(bundle, input.entityId, snapshot);
    expect(merged.tasks).toBe(bundle.tasks);
    expect(merged.userGroups).toHaveLength(bundle.userGroups.length + 1);
    expect(mergeUserGroupSnapshot(merged, input.entityId, snapshot).userGroups).toHaveLength(merged.userGroups.length);
  });

  it("finishes the write while permission refresh is pending, and preserves success if refresh fails", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const db = backend();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const key = ["workspace-bundle", input.workspaceId];
    const bundle = createDemoBundle();
    client.setQueryData(key, bundle);
    let rejectRefresh!: (cause: Error) => void;
    const observer = new QueryObserver(client, { queryKey: key, queryFn: () => new Promise<WorkspaceBundle>((_resolve, reject) => { rejectRefresh = reject; }) });
    const stop = observer.subscribe(() => {});
    const onNotice = vi.fn();
    const adapter = createSupabaseUserGroupAdapter({ client: db.client, write: writeUserGroup, queryClient: client, userId: input.userId, active: () => true, onNotice });
    try {
      const saved = await adapter.submit(input);
      await adapter.settle(input, saved);
      expect(client.getQueryData<WorkspaceBundle>(key)?.userGroups.some((group) => group.id === input.entityId)).toBe(true);
      await vi.waitFor(() => expect(client.getQueryState(key)?.fetchStatus).toBe("fetching"));
      expect(client.getQueryData(userGroupPermissionsKey(input.userId, input.workspaceId))).toEqual({ verified: false });
      rejectRefresh(new Error("refresh unavailable"));
      await vi.waitFor(() => expect(onNotice).toHaveBeenCalledOnce());
      expect(client.getQueryData<WorkspaceBundle>(key)?.userGroups.some((group) => group.id === input.entityId)).toBe(true);
    } finally { stop(); client.clear(); vi.unstubAllGlobals(); }
  });

  it("does not update caches or issue follow-up writes after sign out", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const db = backend();
    const client = new QueryClient();
    let active = true;
    const adapter = createSupabaseUserGroupAdapter({ client: db.client, write: writeUserGroup, queryClient: client, userId: input.userId, active: () => active, onNotice: vi.fn() });
    const saved = await adapter.submit(input);
    active = false;
    await adapter.settle(input, saved);
    expect(client.getQueryData(["workspace-bundle", input.workspaceId])).toBeUndefined();
    await expect(adapter.submit({ ...input, entityId: "second" })).rejects.toThrow("登录状态已变更");
    client.clear(); vi.unstubAllGlobals();
  });
});


describe("atomic user group saves", () => {
  it("submits the captured edit snapshot in one atomic RPC", async () => {
    const db = backend();
    const group = { id: input.entityId, workspace_id: input.workspaceId, name: "研发组" };
    const members = [{ group_id: input.entityId, workspace_id: input.workspaceId, user_id: "member" }];
    const rpc = vi.fn().mockResolvedValue({ data: { group, members, members_changed: false }, error: null });
    Object.assign(db.client, { rpc });
    const result = await writeAtomicUserGroup(db.client, { ...input, kind: "update", name: "研发组",
      expected: { name: "产品组", memberIds: ["member"] } });
    expect(rpc).toHaveBeenCalledWith("save_user_group", {
      p_workspace_id: input.workspaceId, p_id: input.entityId, p_name: "研发组", p_member_ids: ["member"],
      p_expected_name: "产品组", p_expected_member_ids: ["member"],
    });
    expect(result.membersChanged).toBe(false);
    expect(db.calls).toEqual([]);
  });

  it("preserves a concurrent server edit when the atomic RPC rejects the snapshot", async () => {
    const db = backend();
    db.tables.user_groups.push({ id: input.entityId, workspace_id: input.workspaceId, name: "其他人的修改" });
    Object.assign(db.client, { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "PT409" } }) });
    await expect(writeAtomicUserGroup(db.client, { ...input, kind: "update", expected: { name: "旧名称", memberIds: [] } }))
      .rejects.toMatchObject({ outcome: "failed", snapshot: { group: { name: "其他人的修改" } } });
    expect(db.calls.every((call) => call.endsWith(":select"))).toBe(true);
  });

  it("recognizes an atomic commit after losing its response without another write", async () => {
    const db = backend();
    await writeUserGroup(db.client, input);
    const rpc = vi.fn().mockRejectedValue(new Error("Response lost"));
    Object.assign(db.client, { rpc });
    const result = await writeAtomicUserGroup(db.client, input);
    expect(result.group?.id).toBe(input.entityId);
    expect(result.members).toHaveLength(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(db.tables.user_groups).toHaveLength(1);
  });
});
