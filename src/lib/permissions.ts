import type { Task, WorkspaceBundle } from "../types";

export type PermissionLevel = 0 | 1 | 2;

export function intersectPermissionLevels(levels: PermissionLevel[]): PermissionLevel {
  if (levels.length === 0) return 0;
  return Math.min(...levels) as PermissionLevel;
}

export function currentLabelPermissionLevel(
  bundle: WorkspaceBundle,
  labelId: string,
): PermissionLevel {
  // Persisted query data can outlive additions to WorkspaceBundle. Treat a
  // missing permission map as no access until the background refresh finishes.
  return bundle.labelPermissionLevels?.[labelId] ?? 0;
}

export function currentTaskPermissionLevel(
  bundle: WorkspaceBundle,
  task: Task,
  currentUserId: string,
): PermissionLevel {
  if (task.label_ids.length > 0) {
    return intersectPermissionLevels(
      task.label_ids.map((labelId) => currentLabelPermissionLevel(bundle, labelId)),
    );
  }
  const member = bundle.members.find((item) => item.user_id === currentUserId);
  if (!member) return 0;
  return task.created_by === currentUserId
    || task.assignee_id === currentUserId
    || member.role === "owner"
    || member.role === "admin"
    ? 2
    : 1;
}

export function canAccessAllLabels(
  levels: PermissionLevel[],
  required: Exclude<PermissionLevel, 0>,
) {
  return levels.length > 0 && intersectPermissionLevels(levels) >= required;
}
