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
  if (member.role === "owner" || member.role === "admin") return 2;

  let current: Label | undefined = label;
  let effectiveLevel: PermissionLevel = 2;

  while (current) {
    const acl = bundle.labelAcls.find(
      (item) =>
        item.label_id === current!.id && item.user_id === member.user_id,
    );
    const aclLevel: PermissionLevel =
      acl?.permission === "edit" ? 2 : acl?.permission === "view" ? 1 : 0;
    let localLevel: PermissionLevel;

    if (current.visibility === "private") {
      localLevel = current.created_by === member.user_id ? 2 : 0;
    } else if (current.visibility === "restricted") {
      localLevel =
        current.created_by === member.user_id ? 2 : aclLevel;
    } else {
      localLevel =
        current.created_by === member.user_id
          ? 2
          : (Math.max(1, aclLevel) as PermissionLevel);
    }

    effectiveLevel = Math.min(effectiveLevel, localLevel) as PermissionLevel;
    if (
      effectiveLevel === 0
      || !current.inherit_permissions
      || !current.parent_id
    ) {
      break;
    }
    current = bundle.labels.find((item) => item.id === current!.parent_id);
  }

  return effectiveLevel;
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
