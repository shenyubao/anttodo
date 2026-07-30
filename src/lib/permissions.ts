export type PermissionLevel = 0 | 1 | 2;

export function intersectPermissionLevels(levels: PermissionLevel[]): PermissionLevel {
  if (levels.length === 0) return 0;
  return Math.min(...levels) as PermissionLevel;
}

export function canAccessAllLabels(
  levels: PermissionLevel[],
  required: Exclude<PermissionLevel, 0>,
) {
  return levels.length > 0 && intersectPermissionLevels(levels) >= required;
}
