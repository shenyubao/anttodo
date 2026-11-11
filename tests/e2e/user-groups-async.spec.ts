import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";

const route = "/?demo=1#/workspaces/workspace-team/settings/user-groups";
async function createGroup(page: Page, name: string) {
  const noticeClose = page.getByRole("button", { name: "关闭提示", exact: true });
  if (await noticeClose.isVisible()) await noticeClose.click();
  await page.getByRole("button", { name: "新建用户组", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建用户组", exact: true });
  await dialog.getByRole("textbox", { name: "名称" }).fill(name);
  await dialog.locator('input[type="checkbox"]').first().check();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const row = page.locator(".user-group-row").filter({ has: page.getByText(name, { exact: true }) });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("1 位成员");
  await expect(row).not.toHaveAttribute("aria-busy", "true");
  return row;
}

test("user groups create, edit, validate and delete through the shared submission UI", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(route);
  const row = await createGroup(page, "异步提交验证组");
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑用户组", exact: true });
  await dialog.getByRole("textbox", { name: "名称" }).fill("异步提交已更新");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  const updated = page.locator(".user-group-row").filter({ hasText: "异步提交已更新" });
  await expect(updated).toHaveCount(1);
  await page.getByRole("button", { name: "新建用户组", exact: true }).click();
  await page.getByRole("textbox", { name: "名称" }).fill(" 异步提交已更新 ");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("用户组名称已存在");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.screenshot({ path: "test-results/user-groups-desktop.png" });
  page.once("dialog", (confirmation) => confirmation.accept());
  await updated.getByRole("button", { name: "删除", exact: true }).click();
  await expect(updated).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("mobile user groups stay within the viewport and are read-only offline", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(route);
  await createGroup(page, "移动端用户组验证");
  expect(await page.locator(".user-groups-panel").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await context.setOffline(true);
  await expect(page.getByRole("button", { name: "新建用户组", exact: true })).toBeDisabled();
  for (const button of await page.locator(".user-group-actions button").all()) await expect(button).toBeDisabled();
  await page.screenshot({ path: "test-results/user-groups-mobile-offline.png" });
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "新建用户组", exact: true })).toBeEnabled();
});

test("packaged Electron shares user group submissions and offline read-only behavior", async () => {
  test.skip(!process.env.ANTTODO_USER_GROUPS_ELECTRON_PATH, "Provide a local packaged executable");
  test.setTimeout(60_000);
  const profile = mkdtempSync(join(tmpdir(), "anttodo-user-groups-"));
  const app = await electron.launch({ executablePath: process.env.ANTTODO_USER_GROUPS_ELECTRON_PATH,
    args: [`--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const url = new URL(page.url()); url.search = "?demo=1"; url.hash = "/workspaces/workspace-team/settings/user-groups";
    await page.goto(url.href);
    await createGroup(page, "桌面端用户组验证");
    expect(await app.evaluate(({ app, BrowserWindow }) => ({ packaged: app.isPackaged,
      sandbox: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox,
      nodeIntegration: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().nodeIntegration,
    }))).toEqual({ packaged: true, sandbox: true, nodeIntegration: false });
    await app.context().setOffline(true);
    await expect(page.getByRole("button", { name: "新建用户组", exact: true })).toBeDisabled();
    await page.screenshot({ path: "test-results/user-groups-electron.png" });
  } finally { await app.close(); rmSync(profile, { recursive: true, force: true }); }
});
