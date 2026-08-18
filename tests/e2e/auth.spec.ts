import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/auth/v1/otp", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.route("**/auth/v1/verify", async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ message: "Token has expired" }),
    });
  });
  await page.goto("/");
});

test("uses a two-step mainland phone OTP flow", async ({ page }) => {
  await expect(page.getByRole("tab", { name: "手机号登录" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab", { name: "企业单点登录" })).toHaveAttribute(
    "aria-selected",
    "false",
  );
  await page.getByRole("tab", { name: "手机号登录" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "企业单点登录" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByLabel("手机号验证码登录")).toBeVisible();
  await expect(page.getByRole("tab", { name: "钉钉扫码" })).toHaveCount(0);
  await expect(page.getByText("CorpId", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("国家或地区区号")).toBeDisabled();
  await expect(page.getByText("邮箱", { exact: true })).toHaveCount(0);
  await expect(page.getByText("密码", { exact: true })).toHaveCount(0);

  await page.getByPlaceholder("请输入手机号").fill("12800138000");
  await page.getByRole("button", { name: "获取验证码" }).click();
  await expect(page.getByRole("alert")).toContainText("正确的 11 位");

  await page.getByPlaceholder("请输入手机号").fill("13800138000");
  await page.getByRole("button", { name: "获取验证码" }).click();
  await expect(page.getByText("验证码已发送至 +86 138****8000")).toBeVisible();
  await expect(page.getByRole("button", { name: /秒后可重新发送/ })).toBeDisabled();

  await page.getByPlaceholder("请输入 6 位验证码").fill("123456");
  await page.getByRole("button", { name: /^登录/ }).click();
  await expect(page.getByRole("alert")).toContainText("验证码已过期");

  await page.getByRole("button", { name: "修改号码" }).click();
  await expect(page.getByPlaceholder("请输入手机号")).toHaveValue("13800138000");
});

test("switches to enterprise login, validates slug, and opens the canonical team URL", async ({
  page,
}) => {
  await page.route("**/functions/v1/sso-login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspace: {
          id: "21000000-0000-0000-0000-000000000001",
          name: "宇策科技",
          slug: "yucekj",
        },
        providers: [
          {
            provider: "dingtalk",
            displayName: "钉钉企业登录",
            flow: "qr_or_redirect",
            config: {
              corpId: "dingcorp",
              appKey: "ding-app-key",
              agentId: null,
              redirectUri: "http://127.0.0.1:4173/auth/dingtalk/callback",
              state: "21000000-0000-0000-0000-000000000001.state",
            },
          },
        ],
      }),
    });
  });
  const enterpriseTab = page.getByRole("tab", { name: "企业单点登录" });
  await enterpriseTab.click();
  await expect(page.getByRole("form", { name: "企业单点登录" })).toBeVisible();
  await page.getByPlaceholder("例如 yucekj").fill("Team_Name");
  await page.getByRole("button", { name: "确认并继续" }).click();
  await expect(page.getByRole("alert")).toContainText("小写字母、数字和连字符");
  await expect(page).toHaveURL("/");

  await page.getByPlaceholder("例如 yucekj").fill(" YuCeKJ ");
  await page.getByRole("button", { name: "确认并继续" }).click();
  await expect(page).toHaveURL(/\/team\/yucekj$/);
  await expect(page.getByRole("tab", { name: "手机号登录" })).toHaveCount(0);
  await expect(page.getByText("宇策科技", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "跳转到钉钉授权" })).toBeVisible();
  await expect(page.getByLabel("钉钉登录二维码")).toBeVisible();
  await expect(page.getByText("使用钉钉扫码登录")).toHaveCount(0);
});

test("desktop enterprise login requests a desktop state and opens DingTalk externally", async ({
  page,
}) => {
  let requestedClient = "";
  await page.route("**/functions/v1/sso-login", async (route) => {
    requestedClient = route.request().postDataJSON().client;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspace: {
          id: "21000000-0000-0000-0000-000000000001",
          name: "宇策科技",
          slug: "yucekj",
        },
        providers: [{
          provider: "dingtalk",
          displayName: "钉钉企业登录",
          flow: "qr_or_redirect",
          config: {
            corpId: "dingcorp",
            appKey: "ding-app-key",
            agentId: null,
            redirectUri: "https://app.anttodo.com/auth/dingtalk/callback",
            state: "21000000-0000-0000-0000-000000000001.desktop.state",
          },
        }],
      }),
    });
  });
  await page.addInitScript(() => {
    const openedUrls: string[] = [];
    Object.assign(window, {
      __openedDingtalkUrls: openedUrls,
      anttodoDesktop: {
        platform: "darwin",
        versions: { electron: "test", chrome: "test" },
        windowControls: {
          close() {},
          minimize() {},
          toggleFullScreen() {},
        },
        tray: {
          setAuthenticated() {},
          showMainWindow() {},
          hide() {},
        },
        auth: {
          async setServiceOrigin() {
            return true;
          },
          async openDingtalkUrl(url: string) {
            openedUrls.push(url);
            return true;
          },
          async takePendingCallback() {
            return null;
          },
          onCallbackAvailable() {
            return () => {};
          },
        },
      },
      DTFrameLogin: (
        _frame: unknown,
        _params: unknown,
        onSuccess: (result: { redirectUrl: string }) => void,
      ) => onSuccess({
        redirectUrl:
          "https://app.anttodo.com/auth/dingtalk/callback?authCode=test&state=test",
      }),
    });
  });
  await page.reload();

  await page.getByRole("tab", { name: "企业单点登录" }).click();
  await page.getByPlaceholder("例如 yucekj").fill("yucekj");
  await page.getByRole("button", { name: "确认并继续" }).click();

  await expect(page.getByText("宇策科技", { exact: true })).toBeVisible();
  expect(requestedClient).toBe("desktop");
  await page.getByRole("button", { name: "跳转到钉钉授权" }).click();
  await expect.poll(() =>
    page.evaluate(() =>
      (window as typeof window & { __openedDingtalkUrls: string[] })
        .__openedDingtalkUrls.length
    )
  ).toBe(1);
});

test("direct team links show a uniform unavailable SSO state without login tabs", async ({
  page,
}) => {
  await page.route("**/functions/v1/sso-login", async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "未找到可用的企业联合登录配置" }),
    });
  });
  await page.goto("/team/yucekj");

  await expect(page.getByRole("tab", { name: "手机号登录" })).toHaveCount(0);
  await expect(page.getByText("暂时无法登录", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("未找到可用的企业联合登录配置");
  await expect(page.getByRole("link", { name: "返回主站登录" })).toBeVisible();
});

test("keeps the login card usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("手机号验证码登录")).toBeVisible();
  await expect(page.getByPlaceholder("请输入手机号")).toBeVisible();
  await page.getByRole("tab", { name: "企业单点登录" }).click();
  await expect(page.getByPlaceholder("例如 yucekj")).toBeVisible();
  await expect(page.locator(".auth-preview")).toBeHidden();
});

test("keeps the current login tab after reload", async ({ page }) => {
  await page.getByRole("tab", { name: "企业单点登录" }).click();
  await expect(page.getByRole("form", { name: "企业单点登录" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tab", { name: "企业单点登录" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("form", { name: "企业单点登录" })).toBeVisible();
});

test("keeps the current login tab when switching desktop services", async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      anttodoDesktop: {
        platform: "darwin",
        versions: { electron: "test", chrome: "test" },
        windowControls: {
          close() {},
          minimize() {},
          toggleFullScreen() {},
        },
        tray: {
          setAuthenticated() {},
          showMainWindow() {},
          hide() {},
        },
        auth: {
          async setServiceOrigin() {
            return true;
          },
          async openDingtalkUrl() {
            return true;
          },
          async takePendingCallback() {
            return null;
          },
          onCallbackAvailable() {
            return () => {};
          },
        },
      },
    });
  });
  await page.reload();

  await page.getByRole("tab", { name: "企业单点登录" }).click();
  await expect(page.getByRole("form", { name: "企业单点登录" })).toBeVisible();

  await page.getByLabel("当前服务", { exact: true }).selectOption("custom");
  await expect(page.getByRole("tab", { name: "企业单点登录" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByPlaceholder("https://todo.yuce-tech.cn")).toBeVisible();
  await expect(page.getByPlaceholder("例如 yucekj")).toBeVisible();

  await page.evaluate(() => {
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="当前服务"]');
    const accountTab = document.getElementById("auth-tab-account");
    if (!select || !accountTab) throw new Error("login controls missing");
    select.value = "official";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    accountTab.click();
  });
  await expect(page.getByRole("tab", { name: "企业单点登录" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("form", { name: "企业单点登录" })).toBeVisible();
});

test("desktop validates, remembers, and restores a custom service", async ({ page }) => {
  await page.route("https://todo.yuce-tech.cn/.well-known/anttodo.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        schemaVersion: 1,
        instanceId: "8e78719f-8d1f-4d0d-90fc-b18c7f99fd84",
        displayName: "宇策科技 AntTodo",
        deployMode: "onPremises",
        workspaceSlug: "yucekj",
        appUrl: "https://todo.yuce-tech.cn",
        supabaseUrl: "https://supabase.yuce-tech.cn",
        publishableKey: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
        deviceAuthorizationEndpoint:
          "https://supabase.yuce-tech.cn/functions/v1/cli-device-auth",
      }),
    });
  });
  await page.addInitScript(() => {
    const serviceOrigins: string[] = [];
    Object.assign(window, {
      __serviceOrigins: serviceOrigins,
      anttodoDesktop: {
        platform: "darwin",
        versions: { electron: "test", chrome: "test" },
        windowControls: {
          close() {},
          minimize() {},
          toggleFullScreen() {},
        },
        tray: {
          setAuthenticated() {},
          showMainWindow() {},
          hide() {},
        },
        auth: {
          async setServiceOrigin(origin: string) {
            serviceOrigins.push(origin);
            return true;
          },
          async openDingtalkUrl() {
            return true;
          },
          async takePendingCallback() {
            return null;
          },
          onCallbackAvailable() {
            return () => {};
          },
        },
      },
    });
  });
  await page.reload();

  const service = page.getByLabel("登录服务");
  await expect(service.getByText("AntTodo 官方服务")).toBeVisible();
  await service.getByRole("button").first().click();
  await service.getByPlaceholder("https://todo.yuce-tech.cn").fill("todo.yuce-tech.cn");
  await service.getByRole("button", { name: "连接此服务" }).click();

  await expect(service.getByText("宇策科技 AntTodo")).toBeVisible();
  await expect(page.getByRole("heading", { name: "蚂蚁待办 x 宇策科技 AntTodo" })).toBeVisible();
  await expect(page).toHaveTitle("宇策科技 AntTodo");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("anttodo:selected-service-origin")))
    .toBe("https://todo.yuce-tech.cn");
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __serviceOrigins: string[] }
  ).__serviceOrigins.includes("https://todo.yuce-tech.cn"))).toBe(true);

  await page.getByRole("tab", { name: "企业单点登录" }).click();
  await expect(page.getByText("当前企业名称：宇策科技 AntTodo")).toBeVisible();
  await expect(page.getByText("当前企业Slug：yucekj")).toBeVisible();
  await expect(page.getByPlaceholder("例如 yucekj")).toHaveCount(0);
  await expect(page.getByLabel("企业 Slug")).toHaveCount(0);

  await service.getByRole("button").first().click();
  await service.getByRole("button", { name: "恢复官方服务" }).click();
  await expect(service.getByText("AntTodo 官方服务")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("anttodo:selected-service-origin")))
    .toBeNull();
});

test("previews a workspace invite before asking the visitor to sign in", async ({
  page,
}) => {
  const linkId = "7e74efbb-780a-411b-aa7a-1867efbfa40a";
  await page.route("**/functions/v1/workspace-invite-preview", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspaceName: "AntTodo 产品团队",
        workspaceSlug: "anttodo-product",
        inviterDisplayName: "申玉宝",
        role: "admin",
        status: "active",
        ssoEnabled: false,
      }),
    });
  });

  await page.goto(`/invite/${linkId}`);
  await expect(page.getByRole("heading", { name: "AntTodo 产品团队" })).toBeVisible();
  await expect(page.getByText("加入身份：管理员")).toBeVisible();
  await expect(page.getByText("管理员可以管理团队成员、标签权限和连接器。"))
    .toBeVisible();
  await page.getByRole("button", { name: "登录后加入" }).click();
  await expect(page.getByLabel("手机号验证码登录")).toBeVisible();
  await expect(page.getByRole("tab", { name: "钉钉扫码" })).toHaveCount(0);
});

test("forces DingTalk SSO when the invited workspace has SSO enabled", async ({
  page,
}) => {
  const linkId = "8f85facc-891b-422c-bb8b-2978f0c0b51b";
  await page.route("**/functions/v1/workspace-invite-preview", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspaceName: "预测科技",
        workspaceSlug: "yucekj",
        inviterDisplayName: "团队管理员",
        role: "member",
        status: "active",
        ssoEnabled: true,
      }),
    });
  });
  await page.route("**/functions/v1/sso-login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspace: {
          id: "21000000-0000-4000-8000-000000000001",
          name: "预测科技",
          slug: "yucekj",
        },
        providers: [
          {
            provider: "dingtalk",
            displayName: "钉钉企业登录",
            flow: "qr_or_redirect",
            config: {
              corpId: "dingcorp",
              appKey: "ding-app-key",
              agentId: null,
              redirectUri: "http://127.0.0.1:4173/auth/dingtalk/callback",
              state: "21000000-0000-4000-8000-000000000001.web.state",
            },
          },
        ],
      }),
    });
  });

  await page.goto(`/invite/${linkId}`);
  await expect(page.getByRole("heading", { name: "预测科技" })).toBeVisible();
  await page.getByRole("button", { name: "钉钉登录并加入" }).click();
  await expect(page.getByLabel("手机号验证码登录")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "手机号登录" })).toHaveCount(0);
  await expect(page.getByText("预测科技", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "跳转到钉钉授权" })).toBeVisible();
});
