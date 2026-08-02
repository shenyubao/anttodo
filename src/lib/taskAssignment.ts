import type {
  Label,
  Member,
  Task,
  WorkspaceBundle,
} from "../types";
import type { PermissionLevel } from "./permissions";

function labelPermissionForMember(
  label: Label,
  member: Member,
  bundle: WorkspaceBundle,
): PermissionLevel {
  let current: Label | undefined = label;
  let effectiveCanView = true;
  let effectiveCanManage = true;
  const isWorkspaceAdmin = member.role === "owner" || member.role === "admin";

  while (current) {
    const userAcl = bundle.labelUserAcls.find(
      (item) =>
        item.label_id === current!.id && item.user_id === member.user_id,
    );
    const memberGroupIds = new Set(
      bundle.userGroupMembers
        .filter((membership) => membership.user_id === member.user_id)
        .map((membership) => membership.group_id),
    );
    const groupAcls = bundle.labelGroupAcls.filter(
      (item) => item.label_id === current!.id && memberGroupIds.has(item.group_id),
    );
    const hasUserEdit = userAcl?.permission === "edit";
    const hasUserView = hasUserEdit || userAcl?.permission === "view";
    const hasGroupEdit = groupAcls.some((acl) => acl.permission === "edit");
    const hasGroupView = hasGroupEdit || groupAcls.some((acl) => acl.permission === "view");
    let localCanView: boolean;
    let localCanManage: boolean;

    if (current.kind === "private") {
      localCanView = current.created_by === member.user_id;
      localCanManage = localCanView;
    } else if (isWorkspaceAdmin || current.created_by === member.user_id) {
      localCanView = true;
      localCanManage = true;
    } else {
      localCanManage = current.manage_scope === "inherit"
        || current.manage_scope === "all"
        || (current.manage_scope === "users" && hasUserEdit)
        || (current.manage_scope === "groups" && hasGroupEdit);
      localCanView = localCanManage
        || current.view_scope === "inherit"
        || current.view_scope === "all"
        || (current.view_scope === "users" && hasUserView)
        || (current.view_scope === "groups" && hasGroupView);
    }

    effectiveCanView = effectiveCanView && localCanView;
    effectiveCanManage = effectiveCanManage && localCanManage;
    if (
      !effectiveCanView
      || !current.inherit_permissions
      || !current.parent_id
    ) {
      break;
    }
    current = bundle.labels.find((item) => item.id === current!.parent_id);
  }

  return effectiveCanManage ? 2 : effectiveCanView ? 1 : 0;
}

export function canMemberViewTask(
  member: Member,
  task: Task,
  bundle: WorkspaceBundle,
) {
  if (member.workspace_id !== task.workspace_id) return false;
  return task.label_ids.every((labelId) => {
    const label = bundle.labels.find((item) => item.id === labelId);
    return Boolean(label && labelPermissionForMember(label, member, bundle) >= 1);
  });
}

export function getAssignableMembers(
  bundle: WorkspaceBundle,
  task: Task,
  currentUserId: string,
  allowedUserIds?: Iterable<string>,
) {
  const allowed = allowedUserIds ? new Set(allowedUserIds) : null;
  return bundle.members
    .filter(
      (member) =>
        (!allowed || allowed.has(member.user_id))
        && canMemberViewTask(member, task, bundle),
    )
    .sort((left, right) => {
      if (left.user_id === currentUserId) return -1;
      if (right.user_id === currentUserId) return 1;
      return (left.profile?.display_name ?? "").localeCompare(
        right.profile?.display_name ?? "",
        "zh-CN",
      );
    });
}
