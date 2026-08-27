import { expect, test } from "@playwright/test";

async function enableAllFeatureModules(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("anttodo:feature-modules", JSON.stringify({
      calendarEnabled: true,
      focusEnabled: true,
      mindMapEnabled: true,
    }));
  });
}

test("embedded Web mode keeps full navigation without the main rail", async ({ page }) => {
  await enableAllFeatureModules(page);
  await page.goto("/?demo=1&hideMenu=true");

  await expect(page.locator(".navigation-rail")).toHaveCount(0);
  const sidebarBox = await page.locator(".sidebar").boundingBox();
  expect(sidebarBox?.x).toBe(0);

  const navigation = page.getByRole("navigation", { name: "嵌入模式主导航" });
  await expect(navigation).toBeVisible();
  await expect(page.locator(".embedded-navigation")).toHaveCSS("position", "fixed");
  await expect(navigation.getByRole("button", { name: "待办" }))
    .toHaveAttribute("aria-current", "page");

  await navigation.getByRole("button", { name: "日历" }).click();
  await expect(page).toHaveURL(/\?demo=1&hideMenu=true#\/workspaces\/workspace-team\/calendar$/);
  await expect(page.locator(".calendar-workspace")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "嵌入模式主导航" }))
    .toBeVisible();
  await expect(navigation.getByRole("button", { name: "日历" }))
    .toHaveAttribute("aria-current", "page");

  await page.getByRole("navigation", { name: "嵌入模式主导航" })
    .getByRole("button", { name: "番茄专注" }).click();
  await expect(page.locator(".focus-workspace")).toBeVisible();

  await page.getByRole("navigation", { name: "嵌入模式主导航" })
    .getByRole("button", { name: "思维导图" }).click();
  await expect(page.locator(".mind-map-workspace")).toBeVisible();

  await page.goBack();
  await expect(page.locator(".focus-workspace")).toBeVisible();
  await page.goForward();
  await expect(page.locator(".mind-map-workspace")).toBeVisible();

  const urlBeforeSearch = page.url();
  await page.getByRole("navigation", { name: "嵌入模式主导航" })
    .getByRole("button", { name: "搜索" }).click();
  await expect(page).toHaveURL(urlBeforeSearch);
  await expect(page.locator(".task-search-workspace")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "搜索任务" })).toBeVisible();
  await expect(page.locator('.embedded-section-nav > button[aria-label="搜索"]'))
    .toHaveAttribute("aria-pressed", "true");

  const searchDialog = page.getByRole("dialog", { name: "搜索任务" });
  await searchDialog.getByRole("textbox", { name: "搜索任务" }).fill("完成 AntTodo 项目框架验收");
  await searchDialog.getByRole("button", { name: "打开任务：完成 AntTodo 项目框架验收" }).click();
  await expect(page.locator(".task-detail-panel")).toBeVisible();
  await page.getByRole("button", { name: "关闭详情" }).click();
  await expect(page.getByRole("heading", { name: "所有" })).toBeVisible();
});

test("embedded account menu exposes retained rail capabilities", async ({ page }) => {
  await enableAllFeatureModules(page);
  await page.goto("/?demo=1&hideMenu=true");

  await page.getByRole("button", { name: /账户与更多$/ }).click();
  const more = page.getByRole("dialog", { name: "账户与更多" });
  await expect(more).toBeVisible();
  await expect(more.getByRole("button", { name: "切换团队空间" })).toBeVisible();
  await expect(more.getByRole("button", { name: "通知" })).toBeVisible();
  await expect(more.getByRole("button", { name: "同步连接器" })).toBeVisible();
  await expect(more.getByRole("button", { name: "下载客户端" })).toBeVisible();
  await expect(more.getByRole("button", { name: "设置" })).toBeVisible();
  await expect(more.getByRole("button", { name: "退出登录" })).toBeVisible();
  await expect(more.getByText("账户与团队空间")).toHaveCount(0);
  await expect(more.getByText("查看并手动同步")).toHaveCount(0);
  await expect(more.getByText("获取桌面和移动客户端")).toHaveCount(0);
  await expect(more.getByText("账户、外观与功能模块")).toHaveCount(0);
  await expect(more.getByText(/条未读/)).toHaveCount(0);

  await more.getByRole("button", { name: "切换团队空间" }).click();
  await expect(more.getByRole("menu", { name: "选择团队空间" })).toBeVisible();
  await more.getByRole("button", { name: "切换团队空间" }).click();
  await more.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
});

test("embedded navigation compacts labels at a 960px desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 760 });
  await enableAllFeatureModules(page);
  await page.goto("/?demo=1&hideMenu=true");

  await expect(page.getByRole("navigation", { name: "嵌入模式主导航" })).toBeVisible();
  await expect(page.locator(".embedded-section-nav > button").first()).toHaveCSS("width", "28px");
  await expect(page.locator(".embedded-section-nav > button > span").first()).toBeHidden();

  const floatingMenu = page.locator(".embedded-navigation");
  const before = await floatingMenu.boundingBox();
  const handle = page.getByRole("button", { name: "拖动嵌入导航" });
  const handleBox = await handle.boundingBox();
  expect(before).not.toBeNull();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(120, 160, { steps: 8 });
  await page.mouse.up();
  const after = await floatingMenu.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.x - before!.x)).toBeGreaterThan(40);
  await expect.poll(() => page.evaluate(() =>
    window.localStorage.getItem("anttodo:embedded-navigation-position"),
  )).not.toBeNull();
});

test("regular Web mode keeps the rail and modal search", async ({ page }) => {
  await page.goto("/?demo=1");
  await expect(page.locator(".navigation-rail")).toBeVisible();
  await expect(page.locator(".embedded-navigation")).toHaveCount(0);
  await page.locator(".navigation-rail").getByRole("button", { name: "搜索" }).click();
  await expect(page.getByRole("dialog", { name: "搜索任务" })).toBeVisible();
  await expect(page.locator(".task-search-workspace")).toHaveCount(0);

  await page.goto("/?demo=1#/workspaces/workspace-team/search");
  await expect(page).toHaveURL(/\/views\/assigned$/);
  await expect(page.getByRole("dialog", { name: "搜索任务" })).toBeVisible();
});
