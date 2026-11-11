import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const settingsPath = "/workspaces/workspace-team/settings/";

test("settings is a full page and returns to the selected task through history", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?demo=1");
  await page.getByText("完成 AntTodo 项目框架验收", { exact: true }).click();
  const previousUrl = page.url();
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("region", { name: "设置", exact: true });
  await expect(settings).toBeVisible();
  await expect(settings).toHaveCSS("width", "1440px");
  await expect(settings).toHaveCSS("height", "900px");
  await expect(page.locator(".task-detail-panel")).toBeHidden();
  await expect(page.locator(".dialog-overlay")).toHaveCount(0);
  const noticeClose = page.getByRole("button", { name: "关闭提示" });
  if (await noticeClose.isVisible()) await noticeClose.click();
  await page.screenshot({ path: "test-results/settings-desktop.png" });
  await settings.locator(".account-setting-row").filter({ hasText: "昵称" })
    .getByRole("button", { name: "修改" }).click();
  const nicknameDialog = page.getByRole("dialog", { name: "修改昵称" });
  await nicknameDialog.getByRole("textbox", { name: "昵称" }).click();
  await expect(page).toHaveURL(new RegExp(`${settingsPath}account$`));
  await page.keyboard.press("Escape");
  await expect(nicknameDialog).toHaveCount(0);
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "日期与时间", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${settingsPath}date$`));
  await page.reload();
  await expect(settings.getByRole("heading", { name: "日期与时间" })).toBeVisible();
  await settings.getByRole("button", { name: "返回应用" }).click();
  await expect(page).toHaveURL(previousUrl);
  await expect(page.locator(".detail-title")).toHaveValue("完成 AntTodo 项目框架验收");
  await page.goForward();
  await expect(settings.getByRole("heading", { name: "日期与时间" })).toBeVisible();
  await page.goBack();
  await expect(settings).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("settings uses the full window when opened from other app sections", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const section of ["calendar", "matrix", "okr", "focus", "mindmap", "weekly-reports"]) {
    await page.goto(`/?demo=1#/workspaces/workspace-team/${section}`);
    await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "设置" }).click();
    const settings = page.getByRole("region", { name: "设置", exact: true });
    await expect(settings).toHaveCSS("width", "1280px");
    await expect(settings).toHaveCSS("height", "800px");
    await settings.getByRole("button", { name: "返回应用" }).click();
    await expect(page).toHaveURL(new RegExp(`/${section}(/|$)`));
    await expect(settings).toHaveCount(0);
  }
});

test("direct settings links support mobile navigation, account dialogs and offline read-only controls", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?demo=1#${settingsPath}account`);
  const settings = page.getByRole("region", { name: "设置", exact: true });
  await expect(settings).toHaveCSS("width", "390px");
  await expect(settings).toHaveCSS("height", "844px");
  await expect(settings.locator(".settings-sidebar")).toHaveCSS("width", "54px");
  const nicknameRow = settings.locator(".account-setting-row").filter({ hasText: "昵称" });
  await nicknameRow.getByRole("button", { name: "修改" }).click();
  const nicknameDialog = page.getByRole("dialog", { name: "修改昵称" });
  await expect(nicknameDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(nicknameDialog).toHaveCount(0);
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "日期与时间", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "日期与时间" })).toBeVisible();
  expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await settings.getByRole("button", { name: "账户与安全" }).click();
  await context.setOffline(true);
  await expect(settings.getByRole("button", { name: "修改头像" })).toBeDisabled();
  await expect(nicknameRow.getByRole("button", { name: "修改" })).toBeDisabled();
  await context.setOffline(false);
  const noticeClose = page.getByRole("button", { name: "关闭提示" });
  if (await noticeClose.isVisible()) await noticeClose.click();
  await page.screenshot({ path: "test-results/settings-mobile.png" });
  await settings.getByRole("button", { name: "返回应用" }).click();
  await expect(page).toHaveURL(/views\/assigned$/);
  await expect(page.getByRole("button", { name: "打开导航" })).toBeVisible();
});

test("packaged Electron opens settings as a page and returns to tasks", async () => {
  test.skip(!process.env.ANTTODO_SETTINGS_ELECTRON_PATH, "Provide a local packaged executable");
  test.setTimeout(60_000);
  const profile = mkdtempSync(join(tmpdir(), "anttodo-settings-electron-"));
  const app = await electron.launch({ executablePath: process.env.ANTTODO_SETTINGS_ELECTRON_PATH,
    args: [`--user-data-dir=${profile}`], timeout: 20_000 });
  try {
    await expect.poll(() => app.windows().some((window) =>
      /file:.*index\.html/.test(window.url()) && !window.url().includes("#/tray"),
    )).toBe(true);
    const page = app.windows().find((window) =>
      /file:.*index\.html/.test(window.url()) && !window.url().includes("#/tray"),
    )!;
    await page.bringToFront();
    await page.getByRole("link", { name: /^(先)?查看产品演示$/ }).waitFor({ state: "visible" });
    const demoUrl = new URL(page.url());
    demoUrl.search = "?demo=1";
    demoUrl.hash = "/workspaces/workspace-team/views/assigned";
    await page.goto(demoUrl.href);
    await expect(page).toHaveURL(/\?demo=1/);
    await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "设置" }).click();
    const settings = page.getByRole("region", { name: "设置", exact: true });
    await expect(settings).toBeVisible();
    const noticeClose = page.getByRole("button", { name: "关闭提示" });
    if (await noticeClose.isVisible()) await noticeClose.click();
    await page.screenshot({ path: "test-results/settings-electron.png" });
    await settings.getByRole("button", { name: "连接器", exact: true }).click();
    await settings.getByRole("button", { name: "接入", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "接入云效-自动同步" })).toBeVisible();
    await expect(settings.getByRole("navigation", { name: "设置分类" })).toBeVisible();
    await settings.getByRole("button", { name: "返回", exact: true }).click();
    await settings.getByRole("tab", { name: "快速创建", exact: true }).click();
    await expect(settings.getByText("钉钉机器人", { exact: true })).toBeVisible();
    await expect(settings.getByText("云效-快速创建", { exact: true })).toBeVisible();
    await expect(settings.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: "快速创建", exact: true })).toHaveCount(0);
    await page.screenshot({ path: "test-results/connectors-electron.png" });
    await settings.getByRole("button", { name: "返回应用" }).click();
    await expect(page.getByRole("heading", { name: "指派给我" })).toBeVisible();
    expect(await app.evaluate(({ app, BrowserWindow }) => ({
      packaged: app.isPackaged,
      sandbox: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox,
      nodeIntegration: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().nodeIntegration,
    }))).toEqual({ packaged: true, sandbox: true, nodeIntegration: false });
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
