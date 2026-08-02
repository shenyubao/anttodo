export const SESSION_BRIDGE_PATH = "/auth/session-bridge";
export const SESSION_STATUS_MESSAGE_TYPE = "anttodo:session-status";

const PRODUCTION_PARENT_ORIGINS = new Set([
  "https://anttodo.com",
  "https://www.anttodo.com",
]);

const DEVELOPMENT_PARENT_ORIGINS = new Set([
  "http://127.0.0.1:4174",
  "http://localhost:4174",
]);

export type SessionStatusMessage = {
  type: typeof SESSION_STATUS_MESSAGE_TYPE;
  authenticated: boolean;
};

export function isSessionBridgePath(pathname: string): boolean {
  return pathname.replace(/\/+$/, "") === SESSION_BRIDGE_PATH;
}

function originOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function resolveSessionBridgeParentOrigin(
  search: string,
  referrer: string,
  development = false,
): string | null {
  const requested = originOf(new URLSearchParams(search).get("parent_origin"));
  const referring = originOf(referrer);
  if (requested && referring && requested !== referring) return null;
  const candidate = requested ?? referring;
  if (!candidate) return null;
  if (PRODUCTION_PARENT_ORIGINS.has(candidate)) return candidate;
  if (development && DEVELOPMENT_PARENT_ORIGINS.has(candidate)) return candidate;
  return null;
}

export function sessionStatusMessage(authenticated: boolean): SessionStatusMessage {
  return { type: SESSION_STATUS_MESSAGE_TYPE, authenticated };
}
