import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserGroup, WorkspaceBundle } from "../types";

export type UserGroupSnapshot = { name: string; memberIds: string[] };
export type SavedUserGroup = {
  group: UserGroup;
  members: WorkspaceBundle["userGroupMembers"];
  name_changed: boolean;
  members_changed: boolean;
};

export async function saveUserGroup(client: SupabaseClient, workspaceId: string, input: {
  id: string; name: string; memberIds: string[]; expected?: UserGroupSnapshot;
}): Promise<SavedUserGroup> {
  const { data, error } = await client.rpc("save_user_group", {
    p_workspace_id: workspaceId,
    p_id: input.id,
    p_name: input.name.trim(),
    p_member_ids: [...new Set(input.memberIds)].sort(),
    p_expected_name: input.expected?.name ?? null,
    p_expected_member_ids: input.expected ? [...new Set(input.expected.memberIds)].sort() : null,
  });
  if (error) {
    if ((error.code === "PT409" || error.code === "40001")) throw new Error("用户组已被其他人修改，请重新打开后编辑。");
    if (error.code === "23505") throw new Error("此团队空间中已存在同名用户组。");
    if (!error.code || error.code === "PGRST000" || error.code.startsWith("08")) {
      throw new Error("暂时无法确认保存结果，请重新加载用户组核对后再操作。");
    }
    throw new Error(error.message);
  }
  if (!data?.group || !Array.isArray(data.members)) {
    throw new Error("暂时无法确认保存结果，请重新加载用户组核对后再操作。");
  }
  return data as SavedUserGroup;
}

export function applySavedUserGroup(bundle: WorkspaceBundle, saved: SavedUserGroup): WorkspaceBundle {
  return {
    ...bundle,
    userGroups: bundle.userGroups.some((group) => group.id === saved.group.id)
      ? bundle.userGroups.map((group) => group.id === saved.group.id ? saved.group : group)
      : [...bundle.userGroups, saved.group],
    userGroupMembers: [
      ...bundle.userGroupMembers.filter((member) => member.group_id !== saved.group.id),
      ...saved.members,
    ],
  };
}
