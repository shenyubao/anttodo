import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Session } from "@supabase/supabase-js";
import { _electron as electron, expect, test, type Page } from "@playwright/test";

const enabled = process.env.ANTTODO_LOCAL_WEEKLY_GROUPS_E2E === "1";
const local = enabled ? JSON.parse(execFileSync("supabase", ["status", "-o", "json"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
})) as Record<string, string> : {};
const admin = enabled ? createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } }) : null;
const api = enabled ? createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth: { persistSession: false } }) : null;
const users: string[] = [];
const sessions: Session[] = [];
let workspaceId: string;
const userGroupIds = [randomUUID(), randomUUID(), randomUUID()];
async function checked<T>({ data, error }: { data: T; error: { message: string } | null }): Promise<T> {
  if (error) throw new Error(error.message);
  return data;
}
async function login(page: Page, user = 0, desktop = false) {
  const input = { session: sessions[user], workspaceId, key: `sb-${new URL(local.API_URL).hostname.split(".")[0]}-auth-token` };
  const initialize = ({ session, key, workspaceId }: typeof input) => {
    localStorage.setItem(key, JSON.stringify(session));
    localStorage.setItem("anttodo:last-workspace-id", workspaceId);
    localStorage.setItem("anttodo:feature-modules", JSON.stringify({ weeklyReportsEnabled: true }));
  };
  if (desktop) { await page.evaluate(initialize, input); await page.reload(); }
  else { await page.addInitScript(initialize, input); await page.goto(`/\u0023/workspaces/${workspaceId}/weekly-reports`); }
  await expect(page.locator(".navigation-rail")).toBeVisible();
  if (desktop) await page.locator(".navigation-rail").getByRole("button", { name: "周报", exact: true }).click();
  await expect(page.locator(".weekly-report-group-sidebar")).toBeAttached();
}
async function openNewGroup(page: Page) {
  await page.locator(".weekly-report-group-caption").getByRole("button", { name: "新建周报组", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建周报组" });
  await dialog.getByRole("radio", { name: "特定用户组", exact: true }).check();
  return dialog;
}
async function offline(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    window.dispatchEvent(new Event("offline"));
  });
}

test.describe("weekly report participant groups", () => {
  test.skip(!enabled, "Requires local Supabase build and ANTTODO_LOCAL_WEEKLY_GROUPS_E2E=1");
  test.beforeAll(async () => {
    for (const name of ["周报管理员", "周报组成员"]) {
      const email = `weekly-group-${randomUUID()}@example.test`;
      const password = `Weekly-${randomUUID()}!`;
      const user = (await checked(await admin!.auth.admin.createUser({ email, password, email_confirm: true,
        user_metadata: { display_name: name } }))).user!;
      users.push(user.id);
      const client = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth: { persistSession: false } });
      sessions.push((await checked(await client.auth.signInWithPassword({ email, password }))).session!);
    }
    await checked(await api!.auth.setSession(sessions[0]));
    workspaceId = (await checked(await api!.from("workspaces").insert({ name: "周报用户组验证", created_by: users[0] }).select("id").single())).id;
    await checked(await admin!.from("workspace_members").insert({ workspace_id: workspaceId, user_id: users[1], role: "member" }));
    for (let i = 0; i < 3; i++) {
      await checked(await api!.rpc("save_user_group", { p_workspace_id: workspaceId, p_id: userGroupIds[i], p_name: ["研发用户组", "产品用户组", "空用户组"][i], p_member_ids: i === 2 ? [] : users }));
    }
  });
  test.afterAll(async () => {
    if (workspaceId) await checked(await admin!.from("workspaces").delete().eq("id", workspaceId));
    for (const id of users) await checked(await admin!.auth.admin.deleteUser(id));
  });

  test("creates, reopens and previews distinct members at desktop and phone widths", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await login(page);
    const dialog = await openNewGroup(page);
    await dialog.getByRole("textbox", { name: "组名", exact: true }).fill("研发和产品周报");
    await dialog.getByRole("checkbox", { name: "研发用户组", exact: true }).check();
    await dialog.getByRole("checkbox", { name: "产品用户组", exact: true }).check();
    await expect(dialog).toContainText("已选 2 个用户组，应填 2 人");
    await dialog.locator(".weekly-report-config-body").evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: "test-results/weekly-participant-groups-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeInViewport();
    await dialog.locator(".weekly-report-config-body").evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: "test-results/weekly-participant-groups-phone.png" });
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: "研发和产品周报", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "周报组配置", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "编辑周报组" });
    await expect(edit.getByRole("radio", { name: "特定用户组", exact: true })).toBeChecked();
    await expect(edit.getByRole("checkbox", { name: "研发用户组", exact: true })).toBeChecked();
    await expect(edit).toContainText("应填 2 人");
    await offline(page);
    await expect(edit.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
    await expect(edit.getByRole("radio", { name: "特定用户", exact: true })).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test("creates an empty group and refreshes writing permission after remote membership changes", async ({ page, context }) => {
    await login(page);
    const dialog = await openNewGroup(page);
    await dialog.getByRole("textbox", { name: "组名", exact: true }).fill("动态用户组周报");
    await dialog.getByRole("checkbox", { name: "空用户组", exact: true }).check();
    await dialog.getByRole("radio", { name: "指定用户和用户组", exact: true }).check();
    await expect(dialog).toContainText("当前暂无应填人员，成员加入后自动生效");
    await expect(dialog.getByRole("checkbox", { name: "开启每周提醒", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toBeHidden();
    const row = await checked(await api!.from("weekly_report_groups").select("id").eq("workspace_id", workspaceId).eq("name", "动态用户组周报").single());
    // Use the route produced by the UI, avoiding assumptions about route formats.
    const groupUrl = page.url();
    expect(groupUrl).toContain(row.id);
    const memberPage = await context.newPage();
    await login(memberPage, 1);
    await memberPage.goto(groupUrl);
    await expect(memberPage.getByRole("button", { name: "新建周报", exact: true })).toHaveCount(0);
    await checked(await api!.rpc("save_user_group", { p_workspace_id: workspaceId, p_id: userGroupIds[2], p_name: "空用户组", p_expected_name: "空用户组", p_expected_member_ids: [], p_member_ids: [users[1]] }));
    await expect(memberPage.getByRole("button", { name: "新建周报", exact: true })).toBeEnabled({ timeout: 15000 });
    await checked(await api!.rpc("save_user_group", { p_workspace_id: workspaceId, p_id: userGroupIds[2], p_name: "空用户组", p_expected_name: "空用户组", p_expected_member_ids: [users[1]], p_member_ids: [] }));
    await expect(memberPage.getByRole("button", { name: "新建周报", exact: true })).toHaveCount(0, { timeout: 15000 });
    await memberPage.close();
  });

  test("packaged Electron uses shared group selection and disables writes offline", async () => {
    test.skip(!process.env.ANTTODO_WEEKLY_GROUPS_ELECTRON_PATH, "Requires packaged app configured for local Supabase");
    test.setTimeout(60000);
    const profile = mkdtempSync(join(tmpdir(), "anttodo-weekly-groups-electron-"));
    const app = await electron.launch({ executablePath: process.env.ANTTODO_WEEKLY_GROUPS_ELECTRON_PATH, args: [`--user-data-dir=${profile}`] });
    try {
      await expect.poll(() => app.windows().some((page) => page.url().startsWith("file:") && !page.url().includes("#/tray"))).toBe(true);
      const page = app.windows().find((page) => page.url().startsWith("file:") && !page.url().includes("#/tray"))!;
      await page.waitForLoadState("domcontentloaded");
      await login(page, 0, true);
      const dialog = await openNewGroup(page);
      await dialog.getByRole("textbox", { name: "组名", exact: true }).fill("Electron 用户组周报");
      await dialog.getByRole("checkbox", { name: "研发用户组", exact: true }).check();
      await expect(dialog).toContainText("已选 1 个用户组，应填 2 人");
      await dialog.getByRole("button", { name: "保存", exact: true }).click();
      await expect(dialog).toBeHidden();
      await page.getByRole("button", { name: "周报组配置", exact: true }).click();
      await offline(page);
      await expect(page.getByRole("dialog").getByRole("button", { name: "保存", exact: true })).toBeDisabled();
      const security = await app.evaluate(({ app, BrowserWindow }) => {
        const main = BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes("#/tray"))!;
        return { packaged: app.isPackaged, sandbox: main.webContents.getLastWebPreferences().sandbox, nodeIntegration: main.webContents.getLastWebPreferences().nodeIntegration };
      });
      expect(security).toEqual({ packaged: true, sandbox: true, nodeIntegration: false });
    } finally { await app.close(); rmSync(profile, { recursive: true, force: true }); }
  });
});
