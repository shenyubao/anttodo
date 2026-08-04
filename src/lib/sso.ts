const DINGTALK_CALLBACK_PATH = /^\/auth\/dingtalk\/callback\/?$/i;

export type WorkspaceSsoProvider = {
  id: string;
  workspace_id: string;
  provider: "dingtalk";
  enabled: boolean;
  public_config: {
    corpId: string;
    appKey: string;
    agentId?: string;
  };
  credential_hint: string | null;
  created_at: string;
  updated_at: string;
};

export type DingtalkSsoPublicConfig = {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug?: string;
  corpId: string;
  appKey: string;
  agentId: string | null;
  redirectUri: string;
  state: string;
};

export type DingtalkSsoLoginProvider = {
  provider: "dingtalk";
  displayName: string;
  flow: "qr_or_redirect";
  config: {
    corpId: string;
    appKey: string;
    agentId: string | null;
    redirectUri: string;
    state: string;
  };
};

export type WorkspaceSsoLoginProvider = DingtalkSsoLoginProvider;

export type WorkspaceSsoLoginConfig = {
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
  providers: WorkspaceSsoLoginProvider[];
};

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseWorkspaceSsoLoginConfig(
  value: unknown,
): WorkspaceSsoLoginConfig | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!record.workspace || typeof record.workspace !== "object") return null;
  const workspaceRecord = record.workspace as Record<string, unknown>;
  const id = nonEmptyString(workspaceRecord.id);
  const name = nonEmptyString(workspaceRecord.name);
  const slug = nonEmptyString(workspaceRecord.slug);
  if (!id || !name || !slug || !Array.isArray(record.providers)) return null;

  const providers = record.providers.flatMap((item): WorkspaceSsoLoginProvider[] => {
    if (!item || typeof item !== "object") return [];
    const provider = item as Record<string, unknown>;
    if (
      provider.provider !== "dingtalk" ||
      provider.flow !== "qr_or_redirect" ||
      !provider.config ||
      typeof provider.config !== "object"
    ) {
      return [];
    }
    const config = provider.config as Record<string, unknown>;
    const displayName = nonEmptyString(provider.displayName);
    const corpId = nonEmptyString(config.corpId);
    const appKey = nonEmptyString(config.appKey);
    const redirectUri = nonEmptyString(config.redirectUri);
    const state = nonEmptyString(config.state);
    if (!displayName || !corpId || !appKey || !redirectUri || !state) return [];
    return [{
      provider: "dingtalk",
      displayName,
      flow: "qr_or_redirect",
      config: {
        corpId,
        appKey,
        agentId: nonEmptyString(config.agentId),
        redirectUri,
        state,
      },
    }];
  });

  return { workspace: { id, name, slug }, providers };
}

export function initialWorkspaceSsoProvider(
  providers: WorkspaceSsoLoginProvider[],
) {
  return providers.length === 1 ? providers[0] : null;
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

export function isDingtalkCallbackPath(pathname: string) {
  return DINGTALK_CALLBACK_PATH.test(pathname);
}

export function buildDingtalkCallbackUrl(
  configuredBase: string | undefined,
  currentOrigin: string,
) {
  const base = validPublicBase(configuredBase) ?? validPublicBase(currentOrigin);
  if (!base) return null;
  return new URL("/auth/dingtalk/callback", base).toString();
}

/**
 * Use `openid` only for login QR / authorize.
 *
 * Passing `corpId` forces scope `openid corpid`, which DingTalk ties to org-admin
 * selection (`org_type=management` semantics) and breaks normal employee SSO.
 * Workspace binding stays in our signed `state`, so corpId is unnecessary here.
 */
export const DINGTALK_LOGIN_SCOPE = "openid";

export function dingtalkOAuthAuthorizeUrl(input: {
  redirectUri: string;
  clientId: string;
  state: string;
  /** Ignored: corpId in authorize URL forces admin-oriented corpid scope. */
  corpId?: string;
}) {
  const url = new URL("https://login.dingtalk.com/oauth2/auth");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("scope", DINGTALK_LOGIN_SCOPE);
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export function dingtalkFrameLoginUrl(input: {
  redirectUri: string;
  clientId: string;
  state: string;
}) {
  const url = new URL(dingtalkOAuthAuthorizeUrl(input));
  url.searchParams.set("iframe", "true");
  return url.toString();
}

export function dingtalkDesktopCallbackUrl(handoffCode: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(handoffCode)) return null;
  const url = new URL("anttodo://auth/callback");
  url.searchParams.set("code", handoffCode);
  return url.toString();
}

export function dingtalkFrameLoginParams(input: {
  redirectUri: string;
  clientId: string;
  state: string;
  /** Ignored: corpId in DTFrameLogin forces admin-oriented corpid scope. */
  corpId?: string;
}) {
  return {
    // SDK appends this value as-is; must already be encodeURIComponent'd.
    redirect_uri: encodeURIComponent(input.redirectUri),
    client_id: input.clientId,
    scope: DINGTALK_LOGIN_SCOPE,
    response_type: "code",
    state: input.state,
    prompt: "consent",
  };
}

export function normalizeDingtalkLoginError(error: unknown) {
  if (typeof error === "string") return error.trim();
  if (error && typeof error === "object") {
    const record = error as { errorMsg?: unknown; message?: unknown; errorCode?: unknown };
    for (const value of [record.errorMsg, record.message, record.errorCode]) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "";
}

export function isDingtalkTransientLoginError(error: unknown) {
  const message = normalizeDingtalkLoginError(error);
  if (!message) return false;
  return (
    message.includes("系统繁忙") ||
    message.includes("1002") ||
    message.includes("连接失败") ||
    message.includes("网络") ||
    message.toLowerCase().includes("timeout")
  );
}

export function dingtalkLoginErrorAction(
  error: unknown,
  attempt: number,
  maxAttempts: number,
): "ignore" | "retry" | "fail" {
  if (!normalizeDingtalkLoginError(error)) return "ignore";
  if (isDingtalkTransientLoginError(error) && attempt < maxAttempts) return "retry";
  return "fail";
}

export function dingtalkLoginErrorMessage(error: unknown) {
  const message = normalizeDingtalkLoginError(error);
  if (message) {
    if (message.includes("900103") || message.includes("应用不存在")) {
      return "钉钉应用不存在或 AppKey 无效，请联系管理员检查 SSO 配置。";
    }
    if (message.includes("scope not contains corpid") || message.includes("参数无效")) {
      return "钉钉登录参数无效，请刷新页面重试。";
    }
    if (
      message.toLowerCase().includes("admin") ||
      message.includes("管理员") ||
      message.includes("管理权限")
    ) {
      return "当前钉钉账号无企业登录权限，请使用该企业的成员账号扫码。";
    }
    if (message.includes("系统繁忙") || message.includes("1002")) {
      return "钉钉扫码服务繁忙，请稍后重试，或改用跳转登录。";
    }
    if (message.includes("Missing parameters")) {
      return "钉钉登录参数不完整，请刷新页面重试。";
    }
    if (message.includes("Element not found")) {
      return "钉钉二维码容器未就绪，请刷新页面重试。";
    }
    if (message.includes("Browser not support")) {
      return "当前浏览器不支持钉钉内嵌扫码，请改用跳转登录。";
    }
    return `钉钉二维码加载失败：${message}`;
  }
  return "钉钉二维码加载失败，请改用跳转登录。";
}

declare global {
  interface Window {
    DTFrameLogin?: (
      frameParams: { id: string; width?: number; height?: number },
      loginParams: {
        redirect_uri: string;
        client_id: string;
        scope: string;
        response_type: string;
        state: string;
        prompt: string;
        corpId?: string;
      },
      onSuccess: (result: { redirectUrl: string; authCode?: string; state?: string }) => void,
      onError?: (errorMsg: unknown) => void,
    ) => void;
  }
}

let dingtalkSdkPromise: Promise<void> | null = null;

export function loadDingtalkLoginSdk() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("DingTalk SDK requires a browser"));
  }
  if (typeof window.DTFrameLogin === "function") return Promise.resolve();
  if (dingtalkSdkPromise) return dingtalkSdkPromise;

  dingtalkSdkPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-dingtalk-login-sdk='true']",
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("钉钉登录脚本加载失败")),
        { once: true },
      );
      return;
    }
    const script = document.createElement("script");
    script.src = "https://g.alicdn.com/dingding/h5-dingtalk-login/0.21.0/ddlogin.js";
    script.async = true;
    script.dataset.dingtalkLoginSdk = "true";
    script.onload = () => resolve();
    script.onerror = () => {
      dingtalkSdkPromise = null;
      reject(new Error("钉钉登录脚本加载失败"));
    };
    document.head.appendChild(script);
  });
  return dingtalkSdkPromise;
}

export function isDingtalkClientId(value: string) {
  return /^ding[a-z0-9]+$/i.test(value.trim());
}

/** Extract the Edge Function JSON `error` field hidden behind FunctionsHttpError. */
export async function edgeFunctionErrorMessage(
  error: { message?: string; context?: unknown } | null | undefined,
  data: unknown,
  fallback: string,
) {
  if (data && typeof data === "object" && data !== null && "error" in data) {
    const message = (data as { error?: unknown }).error;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  const context =
    error && typeof error === "object" ? (error as { context?: unknown }).context : null;
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: unknown };
      if (typeof body?.error === "string" && body.error.trim()) return body.error.trim();
    } catch {
      // ignore non-JSON error bodies
    }
  }
  const message = error?.message?.trim();
  return message || fallback;
}

type DingtalkExchangeResult =
  | { ok: true; mode: "web"; workspaceId: string; tokenHash: string }
  | { ok: true; mode: "desktop"; workspaceId: string; handoffCode: string }
  | { ok: false; error: string };

const dingtalkExchangePromises = new Map<string, Promise<DingtalkExchangeResult>>();

export function dingtalkExchangeOnce(
  authCode: string,
  run: () => Promise<DingtalkExchangeResult>,
) {
  const existing = dingtalkExchangePromises.get(authCode);
  if (existing) return existing;
  const promise = run().catch(
    (error): DingtalkExchangeResult => ({
      ok: false,
      error: error instanceof Error ? error.message : "钉钉登录失败，请重试。",
    }),
  );
  dingtalkExchangePromises.set(authCode, promise);
  return promise;
}

export function dingtalkTokenHashOtpParams(tokenHash: string) {
  return {
    token_hash: tokenHash,
    type: "magiclink" as const,
  };
}
