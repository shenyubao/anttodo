import type {
  Label,
  LabelAccessDraft,
  LabelAccessScope,
  LabelKind,
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
