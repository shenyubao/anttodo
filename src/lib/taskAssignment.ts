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
  if (label.is_system) {
    return member.workspace_id === label.workspace_id ? 1 : 0;
  }
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

/**
 * When a label keeps view open (all/inherit) but restricts manage to user
 * groups, assignee candidates should be the designated group — not every
 * workspace member who can merely see the task.
 */
function labelRestrictsAssigneesToManagers(
  label: Label,
  bundle: WorkspaceBundle,
) {
  let current: Label | undefined = label;
  while (current) {
    if (current.kind === "private") return false;
    const viewOpen =
      current.view_scope === "all" || current.view_scope === "inherit";
    if (current.manage_scope === "groups" && viewOpen) return true;
    if (
      current.view_scope === "users"
      || current.view_scope === "groups"
      || current.manage_scope === "all"
      || current.manage_scope === "users"
    ) {
      return false;
    }
    if (!current.inherit_permissions || !current.parent_id) break;
    current = bundle.labels.find((item) => item.id === current!.parent_id);
  }
  return false;
}

type TaskAssignmentScope = Pick<Task, "workspace_id" | "label_ids">;

export function canMemberViewTask(
  member: Member,
  task: TaskAssignmentScope,
  bundle: WorkspaceBundle,
) {
  if (member.workspace_id !== task.workspace_id) return false;
  return task.label_ids.every((labelId) => {
    const label = bundle.labels.find((item) => item.id === labelId);
    return Boolean(label && labelPermissionForMember(label, member, bundle) >= 1);
  });
}

export function canMemberBeAssignedToTask(
  member: Member,
  task: TaskAssignmentScope,
  bundle: WorkspaceBundle,
) {
  if (!canMemberViewTask(member, task, bundle)) return false;
  return task.label_ids.every((labelId) => {
    const label = bundle.labels.find((item) => item.id === labelId);
    if (!label || !labelRestrictsAssigneesToManagers(label, bundle)) return true;
    return labelPermissionForMember(label, member, bundle) >= 2;
  });
}

export function getAssignableMembers(
  bundle: WorkspaceBundle,
  task: TaskAssignmentScope,
  currentUserId: string,
  allowedUserIds?: Iterable<string>,
) {
  const allowed = allowedUserIds ? new Set(allowedUserIds) : null;
  return bundle.members
    .filter(
      (member) =>
        (!allowed || allowed.has(member.user_id))
        && canMemberBeAssignedToTask(member, task, bundle),
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
