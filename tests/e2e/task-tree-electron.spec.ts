import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("packaged Electron moves task trees through the shared UI and stays read-only offline", async () => {
  test.skip(!process.env.ANTTODO_TREE_ELECTRON_PATH, "Provide an unsigned local packaged executable");
  test.setTimeout(60_000);
  const profile = mkdtempSync(join(tmpdir(), "anttodo-tree-electron-"));
  const app = await electron.launch({ executablePath: process.env.ANTTODO_TREE_ELECTRON_PATH,
    args: [`--user-data-dir=${profile}`], timeout: 20_000 });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    expect(await app.evaluate(({ app, BrowserWindow }) => ({
      packaged: app.isPackaged,
      sandbox: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox,
      nodeIntegration: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().nodeIntegration,
    }))).toEqual({ packaged: true, sandbox: true, nodeIntegration: false });
    const url = new URL(page.url());
    url.search = "?demo=1";
    url.hash = "/workspaces/workspace-team/views/all";
    await page.goto(url.href);
    const child = page.locator('.task-scroll article[data-task-id="task-1-package"]');
    const target = page.locator('.task-scroll article[data-task-id="task-3"]');
    await child.hover();
    const from = (await child.locator(".task-drag-handle").boundingBox())!;
    const to = (await target.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 100, to.y + 3, { steps: 10 });
    await expect(page.locator(".task-tree-drop")).toContainText("提升为顶级任务");
    await page.mouse.up();
    await expect(child).toHaveClass(/task-row/);
    await app.context().setOffline(true);
    await expect(page.locator(".offline-banner")).toBeVisible();
    await expect(child).toBeVisible();
    await expect(child.locator(".task-drag-handle")).toHaveCount(0);
    await page.screenshot({ path: "test-results/task-tree-electron.png" });
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
