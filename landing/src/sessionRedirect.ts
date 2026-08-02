export const APP_ORIGIN = "https://app.anttodo.com";
export const SESSION_MESSAGE_TYPE = "anttodo:session-status";

export type SessionStatusMessage = {
  type: typeof SESSION_MESSAGE_TYPE;
  authenticated: boolean;
};

export function isTrustedSessionMessage(
  event: Pick<MessageEvent, "origin" | "source" | "data">,
  iframeWindow: Window | null,
  appOrigin = APP_ORIGIN,
): event is MessageEvent<SessionStatusMessage> {
  if (!iframeWindow || event.source !== iframeWindow || event.origin !== appOrigin) return false;
  if (!event.data || typeof event.data !== "object") return false;
  const data = event.data as Partial<SessionStatusMessage>;
  return data.type === SESSION_MESSAGE_TYPE && typeof data.authenticated === "boolean";
}

export function sessionBridgeUrl(parentOrigin: string, appOrigin = APP_ORIGIN): string {
  const url = new URL("/auth/session-bridge", appOrigin);
  url.searchParams.set("parent_origin", parentOrigin);
  return url.toString();
}
