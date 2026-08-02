export const AUTH_DEEP_LINK_SCHEME = "anttodo";
export const AUTH_DEEP_LINK_PREFIX = "anttodo://auth/callback";

const HANDOFF_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function parseAuthDeepLink(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== `${AUTH_DEEP_LINK_SCHEME}:` ||
      url.hostname !== "auth" ||
      url.pathname !== "/callback" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      [...url.searchParams.keys()].some((key) => key !== "code")
    ) {
      return null;
    }
    const codes = url.searchParams.getAll("code");
    if (codes.length !== 1 || !HANDOFF_CODE_PATTERN.test(codes[0])) return null;
    return codes[0];
  } catch {
    return null;
  }
}

export function isAllowedDingtalkExternalUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) {
      return false;
    }
    return (
      (url.hostname === "login.dingtalk.com" && url.pathname === "/oauth2/auth") ||
      (url.hostname === "app.anttodo.com" &&
        /^\/auth\/dingtalk\/callback\/?$/.test(url.pathname))
    );
  } catch {
    return false;
  }
}

export function createAuthCallbackQueue(maxSize = 5) {
  const codes = [];
  return {
    enqueue(code) {
      if (codes.includes(code)) return false;
      codes.push(code);
      if (codes.length > maxSize) codes.shift();
      return true;
    },
    take() {
      return codes.shift() ?? null;
    },
    hasPending() {
      return codes.length > 0;
    },
  };
}
