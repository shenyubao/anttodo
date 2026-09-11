import type {
  Label,
  LabelAccessDraft,
  LabelAccessScope,
  LabelKind,
  UserLabelOrder,
  WorkspaceBundle,
} from "../types";

export const DEFAULT_LABEL_COLOR = "#b8bdc8";

export function isSystemLabel(label: Pick<Label, "is_system"> | null | undefined) {
  return Boolean(label?.is_system);
}

export function userLabels<T extends Pick<Label, "is_system">>(labels: readonly T[]): T[] {
  return labels.filter((label) => !isSystemLabel(label));
}

export function systemLabelIdSet(
  labels: Iterable<Pick<Label, "id" | "is_system">>,
): Set<string> {
  const ids = new Set<string>();
  for (const label of labels) {
    if (isSystemLabel(label)) ids.add(label.id);
  }
  return ids;
}

export function userSpaceLabelFor(
  labels: Iterable<Pick<Label, "id" | "is_system" | "owner_user_id">>,
  userId: string,
) {
  for (const label of labels) {
    if (isSystemLabel(label) && label.owner_user_id === userId) return label;
  }
  return null;
}

export function taskUserLabelIds(
  labelIds: readonly string[],
  labels: Iterable<Pick<Label, "id" | "is_system">>,
) {
  const systemIds = systemLabelIdSet(labels);
  return labelIds.filter((labelId) => !systemIds.has(labelId));
}

export function taskHasUserLabels(
  task: Pick<{ label_ids: readonly string[] }, "label_ids">,
  labels: Iterable<Pick<Label, "id" | "is_system">>,
) {
  return taskUserLabelIds(task.label_ids, labels).length > 0;
}

export function defaultViewLabelIds(input: {
  selectedLabelId: string | null;
  userViewId?: string | null;
  labels: Iterable<Pick<Label, "id" | "is_system" | "owner_user_id">>;
}) {
  if (input.selectedLabelId) return [input.selectedLabelId];
  const space = input.userViewId ? userSpaceLabelFor(input.labels, input.userViewId) : null;
  return space ? [space.id] : [];
}

export const LABEL_COLORS = [
  "#ff6161",
  "#ffac38",
  "#ffd324",
  "#e6ea49",
  "#35d870",
  "#4ca1ff",
  "#6e75f4",
] as const;

export type LabelDropPlacement = "before" | "after" | "onto";

export type LabelDropIntent = {
  targetId: string;
  placement: LabelDropPlacement;
};

export function labelDropPlacementFromY(
  clientY: number,
  top: number,
  height: number,
): LabelDropPlacement {
  const ratio = (clientY - top) / Math.max(height, 1);
  if (ratio < 1 / 3) return "before";
  if (ratio > 2 / 3) return "after";
  return "onto";
}

export function userLabelOrderMap(
  rows: Iterable<Pick<UserLabelOrder, "label_id" | "position">> | undefined,
): Map<string, number> {
  const map = new Map<string, number>();
  if (!rows) return map;
  for (const row of rows) {
    map.set(row.label_id, row.position);
  }
  return map;
}

export function compareSiblingLabels(
  a: Label,
  b: Label,
  parentId: string | null,
  userOrder?: Map<string, number>,
) {
  if (parentId === null && userOrder) {
    const aUser = userOrder.get(a.id);
    const bUser = userOrder.get(b.id);
    if (aUser !== undefined || bUser !== undefined) {
      const aPos = aUser ?? Number.MAX_SAFE_INTEGER;
      const bPos = bUser ?? Number.MAX_SAFE_INTEGER;
      if (aPos !== bPos) return aPos - bPos;
    }
  }
  return a.position - b.position || a.name.localeCompare(b.name, "zh-Hans-CN");
}

export function sortSiblingLabels(
  labels: Label[],
  parentId: string | null,
  userOrder?: Map<string, number> | Iterable<Pick<UserLabelOrder, "label_id" | "position">>,
): Label[] {
  const orderMap = userOrder instanceof Map ? userOrder : userLabelOrderMap(userOrder);
  return labels
    .filter((label) => label.parent_id === parentId)
    .sort((a, b) => compareSiblingLabels(a, b, parentId, orderMap));
}

export function moveIdInOrder(
  orderedIds: string[],
  sourceId: string,
  targetId: string,
  placement: Exclude<LabelDropPlacement, "onto">,
): string[] | null {
  if (sourceId === targetId) return null;
  const withoutSource = orderedIds.filter((id) => id !== sourceId);
  const targetIndex = withoutSource.indexOf(targetId);
  if (targetIndex < 0) return null;
  const insertAt = placement === "before" ? targetIndex : targetIndex + 1;
  const next = [
    ...withoutSource.slice(0, insertAt),
    sourceId,
    ...withoutSource.slice(insertAt),
  ];
  if (next.length !== orderedIds.length) return null;
  if (next.every((id, index) => id === orderedIds[index])) return null;
  return next;
}

export function userLabelOrderRows(
  userId: string,
  workspaceId: string,
  orderedIds: string[],
): UserLabelOrder[] {
  return orderedIds.map((labelId, position) => ({
    user_id: userId,
    workspace_id: workspaceId,
    label_id: labelId,
    position,
  }));
}

export function hasExplicitLabelColor(color: string) {
  return color.toLowerCase() !== DEFAULT_LABEL_COLOR;
}

export function taskLabelBarColor(
  labels: readonly Pick<Label, "id" | "color">[],
  taskLabelIds: readonly string[],
  preferredLabelId?: string | null,
): string | null {
  if (preferredLabelId) {
    const preferred = labels.find((label) => label.id === preferredLabelId);
    if (preferred && hasExplicitLabelColor(preferred.color)) {
      return preferred.color;
    }
  }
  const byId = new Map(labels.map((label) => [label.id, label]));
  for (const id of taskLabelIds) {
    const label = byId.get(id);
    if (label && hasExplicitLabelColor(label.color)) {
      return label.color;
    }
  }
  return null;
}

export type NewLabelAccessDefaults = {
  kind: LabelKind;
  viewScope: LabelAccessScope;
  manageScope: LabelAccessScope;
};

export function newLabelAccessDefaults(
  labels: Label[],
  parentId: string | null,
): NewLabelAccessDefaults {
  const parent = parentId
    ? labels.find((label) => label.id === parentId)
    : undefined;

  if (!parent) {
    return {
      kind: "private",
      viewScope: "all",
      manageScope: "users",
    };
  }

  return {
    kind: parent.kind,
    viewScope: "inherit",
    manageScope: "inherit",
  };
}

export function applyLabelAccessToBundle(
  bundle: WorkspaceBundle,
  labelId: string,
  draft: LabelAccessDraft,
): WorkspaceBundle {
  const userPermissions = new Map<string, "view" | "edit">();
  const groupPermissions = new Map<string, "view" | "edit">();
  if (draft.kind === "team") {
    if (draft.viewScope === "users") {
      draft.viewSubjectIds.forEach((id) => userPermissions.set(id, "view"));
    }
    if (draft.manageScope === "users") {
      draft.manageSubjectIds.forEach((id) => userPermissions.set(id, "edit"));
    }
    if (draft.viewScope === "groups") {
      draft.viewSubjectIds.forEach((id) => groupPermissions.set(id, "view"));
    }
    if (draft.manageScope === "groups") {
      draft.manageSubjectIds.forEach((id) => groupPermissions.set(id, "edit"));
    }
  }
  const workspaceId = bundle.labels.find((label) => label.id === labelId)?.workspace_id;
  if (!workspaceId) return bundle;

  return {
    ...bundle,
    labelUserAcls: [
      ...bundle.labelUserAcls.filter((acl) => acl.label_id !== labelId),
      ...[...userPermissions].map(([userId, permission]) => ({
        label_id: labelId,
        workspace_id: workspaceId,
        user_id: userId,
        permission,
      })),
    ],
    labelGroupAcls: [
      ...bundle.labelGroupAcls.filter((acl) => acl.label_id !== labelId),
      ...[...groupPermissions].map(([groupId, permission]) => ({
        label_id: labelId,
        workspace_id: workspaceId,
        group_id: groupId,
        permission,
      })),
    ],
  };
}

export function appendCreatedLabelToBundle(
  bundle: WorkspaceBundle,
  created: Label,
  draft: LabelAccessDraft,
): WorkspaceBundle {
  if (bundle.labels.some((label) => label.id === created.id)) {
    return applyLabelAccessToBundle(bundle, created.id, draft);
  }
  return applyLabelAccessToBundle(
    {
      ...bundle,
      labels: [...bundle.labels, created],
      labelPermissionLevels: {
        ...bundle.labelPermissionLevels,
        [created.id]: 2,
      },
      labelTaskCounts: {
        ...bundle.labelTaskCounts,
        [created.id]: 0,
      },
    },
    created.id,
    draft,
  );
}

export function removeLabelSubtreeFromBundle(
  bundle: WorkspaceBundle,
  rootLabelId: string,
): WorkspaceBundle {
  const removedIds = new Set([rootLabelId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const label of bundle.labels) {
      if (label.parent_id && removedIds.has(label.parent_id) && !removedIds.has(label.id)) {
        removedIds.add(label.id);
        changed = true;
      }
    }
  }

  return {
    ...bundle,
    labels: bundle.labels.filter((label) => !removedIds.has(label.id)),
    labelUserAcls: bundle.labelUserAcls.filter((acl) => !removedIds.has(acl.label_id)),
    labelGroupAcls: bundle.labelGroupAcls.filter((acl) => !removedIds.has(acl.label_id)),
    labelPermissionLevels: Object.fromEntries(
      Object.entries(bundle.labelPermissionLevels).filter(([labelId]) => !removedIds.has(labelId)),
    ),
    userLabelOrder: bundle.userLabelOrder.filter((row) => !removedIds.has(row.label_id)),
    labelTaskCounts: Object.fromEntries(
      Object.entries(bundle.labelTaskCounts ?? {}).filter(([labelId]) => !removedIds.has(labelId)),
    ),
    tasks: bundle.tasks.map((task) => {
      const labelIds = task.label_ids.filter((labelId) => !removedIds.has(labelId));
      return labelIds.length === task.label_ids.length ? task : { ...task, label_ids: labelIds };
    }),
  };
}

export function labelIdFromRealtimeChange(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const change = payload as {
    table?: unknown;
    new?: Record<string, unknown>;
    old?: Record<string, unknown>;
  };
  const record = change.new && Object.keys(change.new).length > 0 ? change.new : change.old;
  if (!record) return null;
  const value = change.table === "labels" ? record.id : record.label_id;
  return typeof value === "string" ? value : null;
}
