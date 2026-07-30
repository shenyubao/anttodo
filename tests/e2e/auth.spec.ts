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
  await expect(page.getByRole("tab", { name: "钉钉扫码" })).toBeVisible();
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
  await page.getByRole("button", { name: "登录 AntTodo" }).click();
  await expect(page.getByRole("alert")).toContainText("验证码已过期");

  await page.getByRole("button", { name: "修改号码" }).click();
  await expect(page.getByPlaceholder("请输入手机号")).toHaveValue("13800138000");
});

test("shows a non-interactive DingTalk mock", async ({ page }) => {
  await page.getByRole("tab", { name: "钉钉扫码" }).click();
  await expect(page.getByLabel("钉钉登录模拟二维码")).toBeVisible();
  await expect(page.getByText("扫码登录能力暂未开放")).toBeVisible();
  await expect(page.getByRole("button", { name: "暂未开放" })).toBeDisabled();
});

test("keeps the login card usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("tab", { name: "手机号登录" })).toBeVisible();
  await expect(page.getByPlaceholder("请输入手机号")).toBeVisible();
  await expect(page.locator(".auth-preview")).toBeHidden();
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
        inviterDisplayName: "申玉宝",
        role: "admin",
        status: "active",
      }),
    });
  });

  await page.goto(`/invite/${linkId}`);
  await expect(page.getByRole("heading", { name: "AntTodo 产品团队" })).toBeVisible();
  await expect(page.getByText("加入身份：管理员")).toBeVisible();
  await expect(page.getByText("管理员可以管理团队成员、标签权限和连接器。"))
    .toBeVisible();
  await page.getByRole("button", { name: "登录后加入" }).click();
  await expect(page.getByRole("tab", { name: "手机号登录" })).toBeVisible();
});
