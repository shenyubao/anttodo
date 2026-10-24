import { chromium, _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Optional local-only verification, sharing the integration run's disposable user.
export async function verifyOkrClients({ runCli, session, local, objectiveId, keyResultId, workspaceId, repositoryRoot }) {
  const browserUrl = process.env.ANTTODO_CLI_BROWSER_URL;
  const electronPath = process.env.ANTTODO_OKR_ELECTRON_PATH;
  if (!browserUrl && !electronPath) return;
  const tokenKey = `sb-${new URL(local.API_URL).hostname.split(".")[0]}-auth-token`;
  const output = join(repositoryRoot, "test-results", "cli-okr");
  await mkdir(output, { recursive: true });

  async function verify(page, context, label, restore) {
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await restore();
    process.stdout.write(`OKR client smoke: ${label} loaded\n`);
    await page.evaluate((id) => { window.location.hash = `/workspaces/${id}/okr`; }, workspaceId);
    await expect(page.getByText("CLI objective", { exact: true })).toBeVisible();
    process.stdout.write(`OKR client smoke: ${label} signed in\n`);
    const title = `CLI realtime ${label}`;
    runCli("okr", "objective", "update", objectiveId, "--title", title, "--note", `**${label}** via CLI`);
    await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 15_000 });
    runCli("okr", "key-result", "progress", keyResultId, "--value", "50", "--detail", `Realtime ${label}`);
    await expect(page.locator(".okr-kr-row .okr-progress-current").first()).toHaveText("50%", { timeout: 15_000 });
    await expect(page.locator(".okr-objective-row .okr-progress-current").first()).toHaveText("25%");
    await page.screenshot({ path: join(output, `${label}.png`) });
    // Wait until the successful server result has been persisted for offline reload.
    await expect.poll(() => page.evaluate(async (title) => {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open("keyval-store");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const query = db.transaction("keyval").objectStore("keyval").getAll();
          query.onsuccess = () => { resolve(JSON.stringify(query.result).includes(title)); db.close(); };
          query.onerror = () => { reject(query.error); db.close(); };
        };
      });
    }, title)).toBe(true);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.getByRole("button", { name: "编辑 Objective" })).toHaveCount(0);
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
    await context.setOffline(false);
    runCli("okr", "objective", "update", objectiveId, "--title", "CLI objective");
  }

  const state = { session, tokenKey };
  const seed = ({ session, tokenKey }) => {
    localStorage.setItem(tokenKey, JSON.stringify(session));
    localStorage.setItem("anttodo:feature-modules", JSON.stringify({ okrEnabled: true }));
  };
  if (browserUrl) {
    const browser = await chromium.launch();
    try {
      for (const [label, viewport] of [["web", { width: 1440, height: 900 }], ["ios-shared", { width: 390, height: 844 }]]) {
        const context = await browser.newContext({ viewport, serviceWorkers: "allow" });
        await context.addInitScript(seed, state);
        const page = await context.newPage();
        try { await verify(page, context, label, () => page.goto(browserUrl)); }
        catch (error) {
          await page.screenshot({ path: join(output, `${label}-failure.png`) }).catch(() => {});
          process.stderr.write(`OKR smoke failed at ${page.url()}: ${await page.locator("body").innerText().catch(() => "unavailable")}\n`);
          throw error;
        }
        finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
  if (electronPath) {
    const profile = await mkdtemp(join(tmpdir(), "anttodo-cli-okr-electron-"));
    let app;
    try {
      app = await electron.launch({ executablePath: electronPath, args: [`--user-data-dir=${profile}`] });
      const security = await app.evaluate(({ app, BrowserWindow }) => {
        const prefs = BrowserWindow.getAllWindows().map((window) => window.webContents.getLastWebPreferences());
        return { packaged: app.isPackaged, sandbox: prefs.every((p) => p.sandbox), nodeIntegration: prefs.some((p) => p.nodeIntegration) };
      });
      expect(security).toEqual({ packaged: true, sandbox: true, nodeIntegration: false });
      // The hidden tray surface may finish loading before the main window.
      const mainPage = () => app.windows().find((page) => page.url().startsWith("file:") && !page.url().includes("/tray"));
      await expect.poll(() => Boolean(mainPage()), { timeout: 15_000 }).toBe(true);
      const page = mainPage();
      await page.waitForLoadState("domcontentloaded");
      await page.evaluate(seed, state);
      try { await verify(page, app.context(), "electron", () => page.reload()); }
      catch (error) {
        await page.screenshot({ path: join(output, "electron-failure.png") }).catch(() => {});
        process.stderr.write(`Electron OKR smoke failed at ${page.url()}: ${await page.locator("body").innerText().catch(() => "unavailable")}\n`);
        throw error;
      }
    } finally {
      await app?.close();
      await rm(profile, { recursive: true, force: true });
    }
  }
}
