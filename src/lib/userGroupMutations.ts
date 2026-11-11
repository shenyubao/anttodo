import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";
import { saveUserGroup, type UserGroupSnapshot as ExpectedUserGroup } from "./userGroupsApi";
import { beginUserGroupSave, requestPermissionRefresh } from "./permissionRefresh";
import type { UserGroup, UserGroupMember, WorkspaceBundle } from "../types";
import { assertSubmissionOnline, type Submission } from "./useAsyncSubmission";

export type UserGroupSubmission = Submission & {
  kind: "create" | "update" | "delete";
  name: string;
  memberIds: string[];
  expected?: ExpectedUserGroup;
};
export type UserGroupSnapshot = { group: UserGroup | null; members: UserGroupMember[]; membersChanged?: boolean };
export type UserGroupAdapter = {
  submit: (input: UserGroupSubmission) => Promise<UserGroupSnapshot>;
  settle: (input: UserGroupSubmission, snapshot?: UserGroupSnapshot) => Promise<void>;
  verify: (workspaceId: string) => void;
};
export const userGroupSubmissionKey = (userId: string, workspaceId: string) =>
  ["async-submission", userId, workspaceId, "user-groups"] as const;
export const userGroupPermissionsKey = (userId: string, workspaceId: string) =>
  ["user-group-permission-check", userId, workspaceId] as const;
export type UserGroupPermissionCheck = { verified: boolean; error?: string };

export class UserGroupSubmissionError extends Error {
  constructor(message: string, public readonly outcome: "failed" | "partial" | "unknown", public readonly snapshot?: UserGroupSnapshot) {
    super(message);
  }
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message
    : cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "提交失败，请重试";
}
function sameMembers(left: UserGroupMember[], right: string[]) {
  const ids = new Set(right);
  return left.length === ids.size && left.every((member) => ids.has(member.user_id));
}
function matches(input: UserGroupSubmission, snapshot: UserGroupSnapshot) {
  return input.kind === "delete" ? !snapshot.group
    : snapshot.group?.name === input.name && sameMembers(snapshot.members, input.memberIds);
}

export function mergeUserGroupSnapshot(bundle: WorkspaceBundle, groupId: string, snapshot: UserGroupSnapshot): WorkspaceBundle {
  const exists = bundle.userGroups.some((group) => group.id === groupId);
  return {
    ...bundle,
    userGroups: snapshot.group
      ? exists ? bundle.userGroups.map((group) => group.id === groupId ? snapshot.group! : group)
        : [...bundle.userGroups, snapshot.group]
      : bundle.userGroups.filter((group) => group.id !== groupId),
    userGroupMembers: [...bundle.userGroupMembers.filter((member) => member.group_id !== groupId), ...snapshot.members],
  };
}

/** Reads and every write use the captured workspace, never the currently selected one. */
export async function writeUserGroup(client: SupabaseClient, input: UserGroupSubmission, active: () => boolean = () => true): Promise<UserGroupSnapshot> {
  const check = () => {
    assertSubmissionOnline();
    if (!active()) throw new Error("登录状态已变更，请重新登录后重试");
  };
  const read = async (): Promise<UserGroupSnapshot> => {
    check();
    const { data: group, error } = await client.from("user_groups").select("*")
      .eq("workspace_id", input.workspaceId).eq("id", input.entityId).maybeSingle();
    if (error) throw error;
    if (!group) return { group: null, members: [] };
    const { data: members, error: membersError } = await client.from("user_group_members")
      .select("group_id, workspace_id, user_id, added_at")
      .eq("workspace_id", input.workspaceId).eq("group_id", input.entityId);
    if (membersError) throw membersError;
    return { group: group as UserGroup, members: (members ?? []) as UserGroupMember[] };
  };
  let before: UserGroupSnapshot | undefined;
  try {
    before = await read();
    if (matches(input, before)) return before;
    check();
    if (input.kind === "delete") {
      const { error } = await client.from("user_groups").delete().eq("workspace_id", input.workspaceId).eq("id", input.entityId);
      if (error) throw error;
    } else {
      if (!before.group) {
        if (input.kind !== "create") throw new Error("用户组已不存在，请放弃草稿后重新创建");
        const { error } = await client.from("user_groups").insert({ id: input.entityId, workspace_id: input.workspaceId,
          name: input.name, created_by: input.userId });
        if (error) throw error;
      } else if (before.group.name !== input.name) {
        const { error } = await client.from("user_groups").update({ name: input.name })
          .eq("workspace_id", input.workspaceId).eq("id", input.entityId);
        if (error) throw error;
      }
      const wanted = new Set(input.memberIds);
      const current = new Set(before.members.map((member) => member.user_id));
      const removed = [...current].filter((id) => !wanted.has(id));
      const added = [...wanted].filter((id) => !current.has(id));
      if (removed.length) {
        check();
        const { error } = await client.from("user_group_members").delete()
          .eq("workspace_id", input.workspaceId).eq("group_id", input.entityId).in("user_id", removed);
        if (error) throw error;
      }
      if (added.length) {
        check();
        const { error } = await client.from("user_group_members").insert(added.map((user_id) => ({
          workspace_id: input.workspaceId, group_id: input.entityId, user_id,
        })));
        if (error) throw error;
      }
    }
    const confirmed = await read();
    if (!matches(input, confirmed)) throw new Error("服务端结果与提交内容不一致，请核对后重试");
    return confirmed;
  } catch (cause) {
    // A lost response can hide a committed write. Verify before offering another attempt.
    let snapshot: UserGroupSnapshot;
    try { snapshot = await read(); }
    catch { throw new UserGroupSubmissionError(message(cause), "unknown"); }
    if (matches(input, snapshot)) return snapshot;
    const changed = before && (before.group?.name !== snapshot.group?.name
      || !sameMembers(before.members, snapshot.members.map((member) => member.user_id)));
    throw new UserGroupSubmissionError(message(cause), changed ? "partial" : "failed", snapshot);
  }
}

/** Current servers save the group and membership in one checked transaction. */
export async function writeAtomicUserGroup(client: SupabaseClient, input: UserGroupSubmission, active: () => boolean = () => true): Promise<UserGroupSnapshot> {
  assertSubmissionOnline();
  if (!active()) throw new Error("登录状态已变更，请重新登录后重试");
  if (input.kind === "delete") return writeUserGroup(client, input, active);
  try {
    const saved = await saveUserGroup(client, input.workspaceId, {
      id: input.entityId, name: input.name, memberIds: input.memberIds, expected: input.expected,
    });
    return { group: saved.group, members: saved.members, membersChanged: saved.members_changed };
  } catch (cause) {
    // A committed response may be lost. Read before retrying the stable entity ID.
    try {
      assertSubmissionOnline();
      if (!active()) throw new Error("登录状态已变更");
      const { data: group, error } = await client.from("user_groups").select("*")
        .eq("workspace_id", input.workspaceId).eq("id", input.entityId).maybeSingle();
      if (error) throw error;
      const { data: members, error: membersError } = await client.from("user_group_members")
        .select("group_id, workspace_id, user_id, added_at")
        .eq("workspace_id", input.workspaceId).eq("group_id", input.entityId);
      if (membersError) throw membersError;
      const snapshot = { group: group as UserGroup | null, members: (members ?? []) as UserGroupMember[] };
      if (matches(input, snapshot)) return { ...snapshot, membersChanged: true };
      throw new UserGroupSubmissionError(message(cause), "failed", snapshot);
    } catch (verification) {
      if (verification instanceof UserGroupSubmissionError) throw verification;
      throw new UserGroupSubmissionError(message(cause), "unknown");
    }
  }
}

/** Cache reconciliation survives panel unmount; background refresh never delays completion. */
export function createSupabaseUserGroupAdapter(options: {
  client: SupabaseClient;
  queryClient: QueryClient;
  userId: string;
  active: () => boolean;
  onNotice: (notice: string) => void;
  write?: typeof writeUserGroup;
}): UserGroupAdapter {
  const { client, queryClient, userId, active, onNotice } = options;
  const finishes = new Map<string, () => void>();
  const workspaces = new Map<string, { writes: Set<string>; revision: number }>();
  const state = (id: string) => {
    if (!workspaces.has(id)) workspaces.set(id, { writes: new Set(), revision: 0 });
    return workspaces.get(id)!;
  };
  const setCheck = (id: string, value: UserGroupPermissionCheck) => {
    if (active()) queryClient.setQueryData(userGroupPermissionsKey(userId, id), value);
  };
  const verify = (workspaceId: string) => {
    if (!active()) return;
    const current = state(workspaceId);
    if (current.writes.size > 0) return;
    const revision = ++current.revision;
    setCheck(workspaceId, { verified: false });
    void (async () => {
      try {
        assertSubmissionOnline();
        const queryKey = ["workspace-bundle", workspaceId];
        await queryClient.cancelQueries({ queryKey });
        await queryClient.invalidateQueries({ queryKey, refetchType: "all" }, { throwOnError: true });
        if (current.revision === revision) setCheck(workspaceId, { verified: true });
      } catch (cause) {
        if (current.revision !== revision || !active()) return;
        setCheck(workspaceId, { verified: false, error: message(cause) });
        onNotice(`用户组权限刷新失败，请重新核对：${message(cause)}`);
      }
    })();
  };
  return {
    submit: async (input) => {
      const current = state(input.workspaceId);
      current.writes.add(input.operationId);
      current.revision += 1;
      setCheck(input.workspaceId, { verified: false });
      finishes.set(input.operationId, beginUserGroupSave(queryClient, input.workspaceId));
      return (options.write ?? writeAtomicUserGroup)(client, input, active);
    },
    settle: async (input, snapshot) => {
      const current = state(input.workspaceId);
      if (!current.writes.delete(input.operationId)) return;
      const finish = finishes.get(input.operationId);
      finishes.delete(input.operationId);
      if (!active()) { finish?.(); return; }
      if (snapshot) {
        const queryKey = ["workspace-bundle", input.workspaceId];
        await queryClient.cancelQueries({ queryKey });
        if (!active()) { finish?.(); return; }
        queryClient.setQueryData<WorkspaceBundle>(queryKey, (bundle) => bundle
          ? mergeUserGroupSnapshot(bundle, input.entityId, snapshot) : bundle);
      }
      finish?.();
      if (snapshot?.membersChanged !== false) {
        requestPermissionRefresh(queryClient, input.workspaceId);
        verify(input.workspaceId);
      } else if (!current.writes.size) setCheck(input.workspaceId, { verified: true });
    },
    verify,
  };
}

export function createDemoUserGroupAdapter(read: () => WorkspaceBundle, commit: (update: (bundle: WorkspaceBundle) => WorkspaceBundle) => void): UserGroupAdapter {
  return {
    submit: async (input) => {
      assertSubmissionOnline();
      const now = new Date().toISOString();
      const existing = read().userGroups.find((group) => group.id === input.entityId);
      if (input.kind === "delete") return { group: null, members: [] };
      if (read().userGroups.some((group) => group.id !== input.entityId && group.name.trim().toLowerCase() === input.name.toLowerCase())) {
        throw new UserGroupSubmissionError("用户组名称已存在", "failed");
      }
      return {
        group: { id: input.entityId, workspace_id: input.workspaceId, created_by: input.userId, created_at: now,
          ...existing, name: input.name, updated_at: now },
        members: input.memberIds.map((user_id) => ({ group_id: input.entityId, workspace_id: input.workspaceId, user_id, added_at: now })),
      };
    },
    settle: async (input, snapshot) => { if (snapshot) commit((bundle) => mergeUserGroupSnapshot(bundle, input.entityId, snapshot)); },
    verify: () => {},
  };
}
