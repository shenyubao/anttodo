import { expect, test } from "@playwright/test";

const settingsPath = "/workspaces/workspace-team/settings/";

test("connectors groups automatic sync and quick create with routing and deep links", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?demo=1#${settingsPath}connectors`);
  const settings = page.getByRole("region", { name: "设置", exact: true });
  const navigation = settings.getByRole("navigation", { name: "设置分类" });
  await expect(navigation.getByRole("button", { name: "快速创建", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "连接器", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(settings.getByRole("tab")).toHaveText(["自动同步", "快速创建"]);
  await expect(settings.getByRole("tab", { name: "自动同步" })).toHaveAttribute("aria-selected", "true");
  const syncPanel = settings.getByRole("tabpanel", { name: "自动同步", exact: true });
  await expect(syncPanel.getByText("云效-自动同步", { exact: true })).toBeVisible();
  await syncPanel.getByRole("button", { name: "接入", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "接入云效-自动同步" })).toBeVisible();
  await settings.getByRole("button", { name: "返回", exact: true }).click();
  await settings.getByRole("tab", { name: "快速创建" }).click();
  await expect(page).toHaveURL(new RegExp(`${settingsPath}quick-create$`));
  const quickPanel = settings.getByRole("tabpanel", { name: "快速创建", exact: true });
  await expect(quickPanel.getByText("钉钉机器人", { exact: true })).toBeVisible();
  await expect(quickPanel.getByText("云效-快速创建", { exact: true })).toBeVisible();
  await expect(quickPanel.getByText("云效-自动同步", { exact: true })).toHaveCount(0);
  await expect(settings.getByRole("heading", { name: "连接器", exact: true })).toHaveCount(1);
  await page.reload();
  await expect(settings.getByRole("tab", { name: "快速创建" })).toHaveAttribute("aria-selected", "true");
  await expect(navigation.getByRole("button", { name: "连接器", exact: true })).toHaveAttribute("aria-current", "page");
  await settings.getByRole("tab", { name: "自动同步" }).click();
  await expect(page).toHaveURL(new RegExp(`${settingsPath}connectors$`));
  await expect(settings.getByRole("tab", { name: "自动同步" })).toHaveAttribute("aria-selected", "true");
  const noticeClose = page.getByRole("button", { name: "关闭提示" });
  if (await noticeClose.isVisible()) await noticeClose.click();
  await page.screenshot({ path: "test-results/connectors-auto-sync.png" });
  await settings.getByRole("tab", { name: "快速创建" }).click();
  await page.screenshot({ path: "test-results/connectors-quick-create.png" });
  expect(errors).toEqual([]);
});

test("connector tabs fit mobile and disable installs offline", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?demo=1#${settingsPath}quick-create`);
  const settings = page.getByRole("region", { name: "设置", exact: true });
  await expect(settings.getByRole("tab", { name: "快速创建" })).toHaveAttribute("aria-selected", "true");
  expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await context.setOffline(true);
  await expect(settings.getByRole("button", { name: "接入", exact: true })).toBeDisabled();
  await settings.getByRole("tab", { name: "自动同步" }).click();
  await expect(settings.getByRole("button", { name: "接入", exact: true })).toBeDisabled();
  await context.setOffline(false);
  await expect(settings.getByRole("button", { name: "接入", exact: true })).toBeEnabled();
  expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const noticeClose = page.getByRole("button", { name: "关闭提示" });
  if (await noticeClose.isVisible()) await noticeClose.click();
  await page.screenshot({ path: "test-results/connectors-mobile.png" });
});
