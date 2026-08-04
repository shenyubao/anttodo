import type {
  Label,
  LabelAccessDraft,
  LabelAccessScope,
  LabelKind,
  UserLabelOrder,
  WorkspaceBundle,
} from "../types";

export const DEFAULT_LABEL_COLOR = "#b8bdc8";

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
    },
    created.id,
    draft,
  );
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
