import type { WorkspaceInviteRole, WorkspaceRole } from "../types";

const INVITE_PATH = /^\/invite\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i;

export function workspaceInviteIdFromPath(pathname: string) {
  return INVITE_PATH.exec(pathname)?.[1] ?? null;
}

function validPublicBase(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function buildWorkspaceInviteUrl(
  linkId: string,
  configuredBase: string | undefined,
  currentOrigin: string,
) {
  const base = validPublicBase(configuredBase) ?? validPublicBase(currentOrigin);
  if (!base) return null;
  return new URL(`/invite/${linkId}`, base).toString();
}

export function workspaceInviteRoleLabel(role: WorkspaceInviteRole) {
  return role === "admin" ? "管理员" : "普通成员";
}

const ROLE_LEVEL: Record<WorkspaceRole, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

export function higherWorkspaceRole(
  current: WorkspaceRole,
  invited: WorkspaceInviteRole,
): WorkspaceRole {
  return ROLE_LEVEL[current] >= ROLE_LEVEL[invited] ? current : invited;
}
