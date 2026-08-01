import {
  isValidWorkspaceSlug,
  normalizeWorkspaceSlug,
} from "./workspaceSlug";

export type AppEntry =
  | { kind: "main" }
  | { kind: "team"; slug: string };

const TEAM_PATH = /^\/team\/([^/]+)\/?$/i;

/** Resolve `/team/{slug}` as a team SSO entry. */
export function resolveAppLocation(pathname: string): AppEntry {
  const pathSlug = TEAM_PATH.exec(pathname)?.[1];
  if (pathSlug) {
    const slug = normalizeWorkspaceSlug(pathSlug);
    if (isValidWorkspaceSlug(slug)) return { kind: "team", slug };
  }

  return { kind: "main" };
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
