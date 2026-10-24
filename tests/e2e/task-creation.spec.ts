import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Session } from "@supabase/supabase-js";
import { _electron as electron, expect, test, type Page } from "@playwright/test";

// Explicit opt-in: fixtures and cleanup use the local stack only.
const enabled = process.env.ANTTODO_LOCAL_OKR_E2E === "1";
const local = enabled ? JSON.parse(execFileSync("supabase", ["status", "-o", "json"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
})) as Record<string, string> : {};
const admin = enabled ? createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
}) : null;
const owner = enabled ? createClient(local.API_URL, local.PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
}) : null;
let session: Session;
let userId: string;
let workspaceId: string;
let krId: string;
let labelId: string;
async function checked<T>({ data, error }: { data: T; error: { message: string } | null }): Promise<T> {
  if (error) throw new Error(error.message);
  return data;
}
async function login(page: Page) {
  await page.addInitScript(({ session, key, workspaceId }) => {
    localStorage.setItem(key, JSON.stringify(session));
    localStorage.setItem("anttodo:last-workspace-id", workspaceId);
    localStorage.setItem("anttodo:feature-modules", JSON.stringify({ okrEnabled: true }));
  }, { session, workspaceId, key: `sb-${new URL(local.API_URL).hostname.split(".")[0]}-auth-token` });
  await page.goto("/");
  await expect(page.locator(".navigation-rail")).toBeVisible();
}
async function openOkr(page: Page) {
  await page.locator(".navigation-rail").getByRole("button", { name: "OKR", exact: true }).click();
  await page.locator(".okr-kr-row .okr-task-count").first().click();
  return page.getByRole("dialog", { name: "OKR 详情" });
}

test.describe("shared online task creation", () => {
  test.skip(!enabled, "Build against local Supabase and set ANTTODO_LOCAL_OKR_E2E=1");
  test.beforeAll(async () => {
    const email = `task-create-${randomUUID()}@example.test`;
    const password = `Task-${randomUUID()}!`;
    userId = (await checked(await admin!.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: "创建验证用户" } }))).user!.id;
    session = (await checked(await owner!.auth.signInWithPassword({ email, password }))).session!;
    workspaceId = (await checked(await owner!.from("workspaces").insert({ name: "创建任务验证", created_by: userId }).select("id").single())).id;
    labelId = (await checked(await owner!.from("labels").insert({ workspace_id: workspaceId,
      created_by: userId, name: "统一创建标签", kind: "team", view_scope: "all", manage_scope: "all" }).select("id").single())).id;
    const cycle = await checked(await owner!.from("okr_cycles").insert({ workspace_id: workspaceId,
      created_by: userId, name: "创建验证周期", starts_on: "2026-01-01", ends_on: "2026-12-31", status: "active" }).select("id").single());
    const set = await checked(await owner!.from("okr_sets").insert({ workspace_id: workspaceId, cycle_id: cycle.id, owner_id: userId }).select("id").single());
    const objective = await checked(await owner!.from("okr_objectives").insert({ workspace_id: workspaceId, set_id: set.id, title: "统一提交体验" }).select("id").single());
    krId = (await checked(await owner!.from("okr_key_results").insert({ workspace_id: workspaceId, objective_id: objective.id, title: "立即显示待办", weight: 100 }).select("id").single())).id;
  });
  test.afterAll(async () => {
    if (workspaceId) await admin!.from("workspaces").delete().eq("id", workspaceId);
    if (userId) await admin!.auth.admin.deleteUser(userId);
  });

  for (const view of ["inbox", "label", "okr"] as const) {
    test(`${view}: displays the task while the committed server response is delayed, then deduplicates`, async ({ page }) => {
      await login(page);
      let input;
      let rows;
      if (view === "okr") {
        const dialog = await openOkr(page);
        input = dialog.locator(".quick-add input[data-quick-add-input]");
        rows = dialog.locator(".okr-linked-task");
      } else {
        if (view === "label") await page.locator(".sidebar").getByText("统一创建标签", { exact: true }).click();
        else await page.locator(".sidebar").getByRole("button", { name: "收集箱", exact: true }).click();
        input = page.locator(".workspace-main .quick-add input[data-quick-add-input]").first();
        rows = page.locator(".task-row");
      }
      const title = `立即显示-${view}-${randomUUID().slice(0, 8)}`;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let committed = false;
      await page.route("**/rest/v1/rpc/create_task_with_labels", async (route) => {
        const response = await route.fetch();
        committed = response.ok();
        await gate;
        await route.fulfill({ response });
      });
      try {
        await input.fill(title);
        await input.evaluate((node) => {
          const form = node.closest("form")!;
          form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });
        const row = rows.filter({ hasText: title });
        await expect(row).toHaveCount(1);
        await expect(row).toHaveAttribute("aria-busy", "true");
        await expect.poll(() => committed).toBe(true);
        // Exercise a focus refresh and allow an early Realtime row to arrive.
        await page.evaluate(() => { window.dispatchEvent(new Event("blur")); window.dispatchEvent(new Event("focus")); });
        await expect(row).toHaveCount(1);
        await page.screenshot({ animations: "disabled", path: `test-results/task-create-${view}-pending.png` });
        release();
        await expect(row).not.toHaveAttribute("aria-busy", "true");
        await expect(row).toHaveCount(1);
        const tasks = await checked(await owner!.from("tasks").select("id").eq("workspace_id", workspaceId).eq("title", title));
        expect(tasks).toHaveLength(1);
        if (view === "label") expect(await checked(await owner!.from("task_labels").select("task_id").eq("task_id", tasks[0].id).eq("label_id", labelId))).toHaveLength(1);
        if (view === "okr") expect(await checked(await owner!.from("task_okr_links").select("key_result_id").eq("task_id", tasks[0].id))).toEqual([{ key_result_id: krId }]);
      } finally { release(); }
    });
  }

  test("rolls back rejected creation, retains the input, and only retries a failed association", async ({ page, context }) => {
    await login(page);
    const dialog = await openOkr(page);
    const input = dialog.locator(".quick-add input[data-quick-add-input]");
    const title = `回滚重试-${randomUUID().slice(0, 8)}`;
    await page.route("**/rest/v1/rpc/create_task_with_labels", (route) => route.fulfill({ status: 403,
      contentType: "application/json", body: JSON.stringify({ message: "模拟创建失败" }) }));
    await input.fill(title);
    await input.press("Enter");
    await expect(input).toHaveValue(title);
    await expect(dialog.locator(".okr-linked-task").filter({ hasText: title })).toHaveCount(0);
    await page.unroute("**/rest/v1/rpc/create_task_with_labels");
    await page.setViewportSize({ width: 390, height: 844 });
    let createRequests = 0;
    page.on("request", (request) => { if (request.url().endsWith("/rpc/create_task_with_labels")) createRequests++; });
    await page.route("**/rest/v1/rpc/set_task_okr_link", (route) => route.fulfill({ status: 403,
      contentType: "application/json", body: JSON.stringify({ message: "模拟关联失败" }) }));
    await input.press("Enter");
    await expect(dialog.getByText("待办已创建，尚未关联 KR", { exact: true })).toBeVisible();
    await expect(dialog.locator(".okr-linked-task").filter({ hasText: title })).toHaveCount(0);
    await page.unroute("**/rest/v1/rpc/set_task_okr_link");
    await dialog.getByRole("button", { name: "重试关联", exact: true }).click();
    const retried = dialog.locator(".okr-linked-task").filter({ hasText: title });
    await expect(retried).toHaveCount(1);
    await expect(retried).not.toHaveAttribute("aria-busy", "true");
    await expect(input).toBeEnabled();
    await expect(dialog.getByText("待办已创建，尚未关联 KR", { exact: true })).toHaveCount(0);
    expect(createRequests).toBe(1);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(input).toBeDisabled();
    await expect(dialog.locator(".okr-linked-task").filter({ hasText: title })).toHaveCount(1);
    expect(createRequests).toBe(1);
    await page.screenshot({ animations: "disabled", path: "test-results/task-create-mobile-offline.png" });
  });

  test("packaged Electron uses the same optimistic creation and offline read-only path", async () => {
    test.skip(!process.env.ANTTODO_OKR_ELECTRON_PATH, "Provide a packaged app configured for local Supabase");
    test.setTimeout(60_000);
    const profile = mkdtempSync(join(tmpdir(), "anttodo-task-create-electron-"));
    const app = await electron.launch({ executablePath: process.env.ANTTODO_OKR_ELECTRON_PATH,
      args: [`--user-data-dir=${profile}`], timeout: 20_000 });
    try {
      // The hidden tray surface can be created before the main window.
      await expect.poll(() => app.windows().some((page) => page.url().startsWith("file:") && !page.url().includes("#/tray"))).toBe(true);
      const page = app.windows().find((page) => page.url().startsWith("file:") && !page.url().includes("#/tray"))!;
      await page.waitForLoadState("domcontentloaded");
      const security = await app.evaluate(({ app, BrowserWindow }) => {
        const main = BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes("#/tray"))!;
        return { packaged: app.isPackaged,
          sandbox: main.webContents.getLastWebPreferences().sandbox,
          nodeIntegration: main.webContents.getLastWebPreferences().nodeIntegration };
      });
      expect(security).toEqual({ packaged: true, sandbox: true, nodeIntegration: false });
      await page.evaluate(({ session, key, workspaceId }) => {
        localStorage.setItem(key, JSON.stringify(session));
        localStorage.setItem("anttodo:last-workspace-id", workspaceId);
        localStorage.setItem("anttodo:feature-modules", JSON.stringify({ okrEnabled: true }));
      }, { session, workspaceId, key: `sb-${new URL(local.API_URL).hostname.split(".")[0]}-auth-token` });
      await page.reload();
      await expect(page.locator(".navigation-rail")).toBeVisible();
      const dialog = await openOkr(page);
      const input = dialog.locator(".quick-add input[data-quick-add-input]");
      const title = `Electron 即时创建-${randomUUID().slice(0, 8)}`;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      await page.route("**/rest/v1/rpc/create_task_with_labels", async (route) => {
        const response = await route.fetch();
        await gate;
        await route.fulfill({ response });
      });
      try {
        await input.fill(title);
        await input.press("Enter");
        const row = dialog.locator(".okr-linked-task").filter({ hasText: title });
        await expect(row).toHaveAttribute("aria-busy", "true");
        await page.screenshot({ animations: "disabled", path: "test-results/task-create-electron-pending.png" });
        release();
        await expect(row).not.toHaveAttribute("aria-busy", "true");
        await expect(row).toHaveCount(1);
        await page.context().setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event("offline")));
        await expect(input).toBeDisabled();
        await expect(row).toHaveCount(1);
      } finally { release(); }
    } finally {
      await app.close();
      rmSync(profile, { recursive: true, force: true });
    }
  });
});
