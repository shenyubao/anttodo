import { describe, expect, it } from "vitest";
import {
  buildDingtalkCallbackUrl,
  DINGTALK_LOGIN_SCOPE,
  dingtalkExchangeOnce,
  dingtalkFrameLoginParams,
  dingtalkLoginErrorAction,
  dingtalkLoginErrorMessage,
  dingtalkOAuthAuthorizeUrl,
  dingtalkTokenHashOtpParams,
  edgeFunctionErrorMessage,
  isDingtalkCallbackPath,
  isDingtalkClientId,
  isDingtalkTransientLoginError,
  normalizeDingtalkLoginError,
} from "./sso";

describe("dingtalk sso helpers", () => {
  const workspaceId = "7e74efbb-780a-411b-aa7a-1867efbfa40a";

  it("detects callback path", () => {
    expect(isDingtalkCallbackPath("/auth/dingtalk/callback")).toBe(true);
    expect(isDingtalkCallbackPath("/auth/dingtalk/callback/")).toBe(true);
    expect(isDingtalkCallbackPath("/auth/callback")).toBe(false);
  });

  it("builds callback urls", () => {
    expect(
      buildDingtalkCallbackUrl("https://app.anttodo.com", "http://localhost:5173"),
    ).toBe("https://app.anttodo.com/auth/dingtalk/callback");
  });

  it("builds authorize url with openid scope and without corpId", () => {
    const url = new URL(
      dingtalkOAuthAuthorizeUrl({
        redirectUri: "https://app.anttodo.com/auth/dingtalk/callback",
        clientId: "ding-app-key",
        state: "workspace.state",
        corpId: "dingcorp",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://login.dingtalk.com/oauth2/auth");
    expect(url.searchParams.get("client_id")).toBe("ding-app-key");
    expect(url.searchParams.get("corpId")).toBeNull();
    expect(url.searchParams.get("scope")).toBe(DINGTALK_LOGIN_SCOPE);
  });

  it("builds DTFrameLogin params without corpId to avoid admin-only org scope", () => {
    const params = dingtalkFrameLoginParams({
      redirectUri: "https://app.anttodo.com/auth/dingtalk/callback",
      clientId: "dingirmgwhj3vsssirep",
      state: "workspace.state",
      corpId: "dingcorp",
    });
    expect(params.scope).toBe(DINGTALK_LOGIN_SCOPE);
    expect(params.scope.includes(" ")).toBe(false);
    expect(params.redirect_uri).toBe(
      encodeURIComponent("https://app.anttodo.com/auth/dingtalk/callback"),
    );
    expect("corpId" in params).toBe(false);
    expect(dingtalkLoginErrorMessage("900103 应用不存在")).toContain("AppKey");
    expect(
      dingtalkLoginErrorMessage("参数无效：scope not contains corpid, when request provide corpId"),
    ).toContain("参数无效");
    expect(dingtalkLoginErrorMessage("系统繁忙，请稍后再试")).toContain("扫码服务繁忙");
    expect(normalizeDingtalkLoginError({ errorMsg: "系统繁忙，请稍后再试" })).toBe(
      "系统繁忙，请稍后再试",
    );
    expect(isDingtalkTransientLoginError("系统繁忙，请稍后再试")).toBe(true);
    // Empty SDK callbacks are spurious and must not trigger a QR remount.
    expect(isDingtalkTransientLoginError("")).toBe(false);
    expect(isDingtalkTransientLoginError({})).toBe(false);
    expect(isDingtalkTransientLoginError("应用不存在")).toBe(false);
    expect(dingtalkLoginErrorAction("", 1, 3)).toBe("ignore");
    expect(dingtalkLoginErrorAction({}, 3, 3)).toBe("ignore");
    expect(dingtalkLoginErrorAction("系统繁忙", 1, 3)).toBe("retry");
    expect(dingtalkLoginErrorAction("系统繁忙", 3, 3)).toBe("fail");
    expect(dingtalkLoginErrorAction("应用不存在", 1, 3)).toBe("fail");
  });

  it("validates dingtalk client ids", () => {
    expect(isDingtalkClientId("dingirmgwhj3vsssirep")).toBe(true);
    expect(isDingtalkClientId("9b967827-3547-473f-aaa8-87004f9de90f")).toBe(false);
  });

  it("reads edge function error bodies from FunctionsHttpError context", async () => {
    const response = new Response(JSON.stringify({ error: "钉钉授权码无效" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
    await expect(
      edgeFunctionErrorMessage(
        { message: "Edge Function returned a non-2xx status code", context: response },
        null,
        "fallback",
      ),
    ).resolves.toBe("钉钉授权码无效");
  });

  it("dedupes concurrent auth-code exchanges", async () => {
    let runs = 0;
    const run = () =>
      dingtalkExchangeOnce("code-once", async () => {
        runs += 1;
        return {
          ok: true as const,
          workspaceId,
          tokenHash: "hash",
        };
      });
    const [a, b] = await Promise.all([run(), run()]);
    expect(runs).toBe(1);
    expect(a).toEqual(b);
  });

  it("verifies generated magic links with token hash fields only", () => {
    expect(dingtalkTokenHashOtpParams("hash")).toEqual({
      token_hash: "hash",
      type: "magiclink",
    });
  });
});
