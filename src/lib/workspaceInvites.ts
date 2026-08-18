import type { WorkspaceInviteRole, WorkspaceRole } from "../types";
import { instanceStorageKey } from "./instanceConfig";

const INVITE_PATH = /^\/invite\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i;

export const PENDING_WORKSPACE_INVITE_KEY = "anttodo:pending-invite";
export const PENDING_WORKSPACE_KEY = "anttodo:pending-workspace";

export function workspaceInviteIdFromPath(pathname: string) {
  return INVITE_PATH.exec(pathname)?.[1] ?? null;
}

export function readPendingWorkspaceInvite() {
  try {
    return window.sessionStorage.getItem(instanceStorageKey(PENDING_WORKSPACE_INVITE_KEY));
  } catch {
    return null;
  }
}

export function writePendingWorkspaceInvite(linkId: string) {
  try {
    window.sessionStorage.setItem(instanceStorageKey(PENDING_WORKSPACE_INVITE_KEY), linkId);
  } catch {
    // Ignore quota / private-mode failures; accept can still be attempted manually.
  }
}

export function clearPendingWorkspaceInvite() {
  try {
    window.sessionStorage.removeItem(instanceStorageKey(PENDING_WORKSPACE_INVITE_KEY));
  } catch {
    // Ignore storage failures.
  }
}

export function writePendingWorkspace(workspaceId: string) {
  try {
    window.sessionStorage.setItem(instanceStorageKey(PENDING_WORKSPACE_KEY), workspaceId);
  } catch {
    // Ignore storage failures.
  }
}

export function readPendingWorkspace() {
  try {
    return window.sessionStorage.getItem(instanceStorageKey(PENDING_WORKSPACE_KEY));
  } catch {
    return null;
  }
}

export function clearPendingWorkspace() {
  try {
    window.sessionStorage.removeItem(instanceStorageKey(PENDING_WORKSPACE_KEY));
  } catch {
    // Ignore storage failures.
  }
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
