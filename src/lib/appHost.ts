import {
  isValidWorkspaceSlug,
  normalizeWorkspaceSlug,
} from "./workspaceSlug";
import { instanceStorageKey } from "./instanceConfig";

export type AppEntry =
  | { kind: "main" }
  | { kind: "team"; slug: string };

const TEAM_PATH = /^\/team\/([^/]+)\/?$/i;

export const CLIENT_DOWNLOAD_URL = "https://anttodo.com/download";
export const PENDING_DOWNLOAD_GUIDE_KEY = "anttodo:pending-download-guide";

/** Resolve `/team/{slug}` as a team SSO entry. */
export function resolveAppLocation(pathname: string): AppEntry {
  const pathSlug = TEAM_PATH.exec(pathname)?.[1];
  if (pathSlug) {
    const slug = normalizeWorkspaceSlug(pathSlug);
    if (isValidWorkspaceSlug(slug)) return { kind: "team", slug };
  }

  return { kind: "main" };
}

/** True when the team login URL carries `?download=1` (client invite). */
export function isTeamClientDownloadInvite(search: string) {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  return params.get("download") === "1";
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

/** e.g. https://app.anttodo.com */
export function buildWorkspaceTeamOrigin(
  slug: string,
  configuredAppUrl: string | undefined,
  currentOrigin?: string,
) {
  const normalized = normalizeWorkspaceSlug(slug);
  if (!isValidWorkspaceSlug(normalized)) return null;

  const base =
    validPublicBase(configuredAppUrl) ?? validPublicBase(currentOrigin);
  if (!base) return null;

  return base.origin;
}

/** Team SSO entry URL shared with members. */
export function buildWorkspaceTeamLoginUrl(
  slug: string,
  configuredAppUrl: string | undefined,
  currentOrigin?: string,
) {
  const origin = buildWorkspaceTeamOrigin(
    slug,
    configuredAppUrl,
    currentOrigin,
  );
  return origin
    ? new URL(`/team/${normalizeWorkspaceSlug(slug)}`, origin).toString()
    : null;
}

/** Team SSO entry that triggers the post-login download client guide. */
export function buildWorkspaceTeamClientInviteUrl(
  slug: string,
  configuredAppUrl: string | undefined,
  currentOrigin?: string,
) {
  const loginUrl = buildWorkspaceTeamLoginUrl(
    slug,
    configuredAppUrl,
    currentOrigin,
  );
  if (!loginUrl) return null;
  const url = new URL(loginUrl);
  url.searchParams.set("download", "1");
  return url.toString();
}

let downloadGuideClaimed = false;

export function markPendingDownloadGuide() {
  downloadGuideClaimed = false;
  window.sessionStorage.setItem(instanceStorageKey(PENDING_DOWNLOAD_GUIDE_KEY), "1");
}

/** Returns true once if a download guide was pending, then clears the flag. */
export function consumePendingDownloadGuide() {
  if (window.sessionStorage.getItem(instanceStorageKey(PENDING_DOWNLOAD_GUIDE_KEY)) !== "1") {
    return false;
  }
  window.sessionStorage.removeItem(instanceStorageKey(PENDING_DOWNLOAD_GUIDE_KEY));
  return true;
}

/**
 * One-shot claim for the post-login guide. Survives React Strict Mode remounts
 * in the same document so the dialog still opens after sessionStorage is cleared.
 */
export function claimPendingDownloadGuide() {
  if (downloadGuideClaimed) return false;
  downloadGuideClaimed = true;
  if (typeof window !== "undefined" && window.anttodoDesktop) {
    window.sessionStorage.removeItem(instanceStorageKey(PENDING_DOWNLOAD_GUIDE_KEY));
    return false;
  }
  return consumePendingDownloadGuide();
}
