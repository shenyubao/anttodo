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
let groupId: string;
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
  else { await page.addInitScript(initialize, input); await page.goto(`/#/workspaces/${workspaceId}/weekly-reports`); }
  await expect(page.locator(".navigation-rail")).toBeVisible();
  if (desktop) await page.locator(".navigation-rail").getByRole("button", { name: "周报", exact: true }).click();
  await page.getByRole("complementary", { name: "周报组" }).getByRole("button", { name: "删除验证组", exact: true }).click();
  await expect(page.getByRole("heading", { name: "删除验证组", exact: true })).toBeVisible();
}
async function network(page: Page, online: boolean) {
  await page.evaluate((online) => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: online });
    window.dispatchEvent(new Event(online ? "online" : "offline"));
  }, online);
}
async function confirmDelete(page: Page) {
  await page.getByRole("button", { name: "删除周报组", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除周报组", exact: true });
  await expect(dialog).toContainText("所有周报（包括草稿）");
  await dialog.getByRole("button", { name: "永久删除", exact: true }).click();
  await expect(dialog).toBeHidden();
}

test.describe("delete weekly report groups", () => {
  test.skip(!enabled, "Requires local Supabase build and ANTTODO_LOCAL_WEEKLY_GROUPS_E2E=1");
  test.beforeAll(async () => {
    for (const name of ["删除验证管理员", "删除验证成员"]) {
      const email = `weekly-delete-${randomUUID()}@example.test`;
      const password = `Weekly-delete-${randomUUID()}!`;
      const user = (await checked(await admin!.auth.admin.createUser({ email, password, email_confirm: true,
        user_metadata: { display_name: name } }))).user!;
      users.push(user.id);
      const client = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth: { persistSession: false } });
      sessions.push((await checked(await client.auth.signInWithPassword({ email, password }))).session!);
    }
    await checked(await api!.auth.setSession(sessions[0]));
  });
  test.beforeEach(async () => {
    workspaceId = (await checked(await api!.from("workspaces").insert({ name: "周报组删除验证", created_by: users[0] }).select("id").single())).id;
    await checked(await admin!.from("workspace_members").insert({ workspace_id: workspaceId, user_id: users[1], role: "member" }));
    groupId = (await checked(await api!.rpc("save_weekly_report_group", { p_workspace_id: workspaceId, p_name: "删除验证组", p_participant_ids: users }))).id;
    const now = new Date(); now.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const week = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    await checked(await admin!.from("weekly_reports").insert([
      { workspace_id: workspaceId, weekly_report_group_id: groupId, author_id: users[1], week_start: week, completed_text: "组内已发布周报", status: "published", published_at: new Date().toISOString() },
      { workspace_id: workspaceId, weekly_report_group_id: groupId, author_id: users[0], week_start: week, completed_text: "组内草稿", status: "draft" },
    ]));
  });
  test.afterEach(async () => { if (workspaceId) await checked(await admin!.from("workspaces").delete().eq("id", workspaceId)); });
  test.afterAll(async () => { for (const id of users) await checked(await admin!.auth.admin.deleteUser(id)); });

  test("only admins see the adjacent delete action and the dialog fits phone width", async ({ page, browser }) => {
    await login(page);
    await expect(page.locator(".weekly-report-group-actions").getByRole("button")).toHaveCount(2);
    await page.screenshot({ path: "test-results/weekly-group-delete-desktop.png" });
    await page.getByRole("button", { name: "删除周报组", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "删除周报组", exact: true });
    await expect(dialog).toContainText("删除验证组");
    await page.setViewportSize({ width: 390, height: 844 });
    const box = await dialog.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await expect(dialog.getByRole("button", { name: "永久删除", exact: true })).toBeInViewport();
    await page.screenshot({ path: "test-results/weekly-group-delete-confirm-phone.png" });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    const member = await browser.newContext();
    try {
      const memberPage = await member.newPage(); await login(memberPage, 1);
      await expect(memberPage.getByRole("button", { name: "删除周报组", exact: true })).toHaveCount(0);
      await expect(memberPage.getByRole("button", { name: "周报组配置", exact: true })).toBeVisible();
    } finally { await member.close(); }
  });

  test("permanently deletes reports, selects a surviving group and stays deleted after reload", async ({ page }) => {
    await login(page);
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await network(page, false);
    await expect(page.getByRole("button", { name: "删除周报组", exact: true })).toBeDisabled();
    await network(page, true);
    await expect(page.getByRole("button", { name: "删除周报组", exact: true })).toBeEnabled();
    await confirmDelete(page);
    await expect(page.getByRole("heading", { name: "默认周报组", exact: true })).toBeVisible();
    const reports = await checked(await admin!.from("weekly_reports").select("id").eq("weekly_report_group_id", groupId));
    expect(reports).toEqual([]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "默认周报组", exact: true })).toBeVisible();
    await expect(page.locator(".weekly-report-group-row").filter({ hasText: "删除验证组" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("preserves the group on failure, retries, and supports deleting the default and last group", async ({ page }) => {
    await login(page);
    await page.route("**/rest/v1/rpc/delete_weekly_report_group", (route) => route.fulfill({ status: 503,
      contentType: "application/json", body: JSON.stringify({ message: "模拟删除失败" }) }));
    await page.getByRole("button", { name: "删除周报组", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "删除周报组", exact: true });
    await dialog.getByRole("button", { name: "永久删除", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("模拟删除失败");
    expect((await checked(await admin!.from("weekly_report_groups").select("id").eq("id", groupId))).length).toBe(1);
    await page.unroute("**/rest/v1/rpc/delete_weekly_report_group");
    await dialog.getByRole("button", { name: "永久删除", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: "默认周报组", exact: true })).toBeVisible();
    await confirmDelete(page);
    await expect(page.locator(".weekly-report-group-main").getByText("暂无可查看的周报组", { exact: true })).toBeVisible();
    await page.locator(".weekly-report-group-caption").getByRole("button", { name: "新建周报组", exact: true }).click();
    const create = page.getByRole("dialog", { name: "新建周报组", exact: true });
    await create.getByRole("textbox", { name: "组名", exact: true }).fill("重新创建周报组");
    await create.locator(".weekly-report-config-selection").getByRole("button", { name: "全选", exact: true }).click();
    await create.getByRole("button", { name: "保存", exact: true }).click();
    await expect(create).toBeHidden();
    await expect(page.getByRole("heading", { name: "重新创建周报组", exact: true })).toBeVisible();
  });

  test("packaged Electron confirms deletion and disables it offline", async () => {
    test.skip(!process.env.ANTTODO_WEEKLY_GROUPS_ELECTRON_PATH, "Requires packaged app configured for local Supabase");
    test.setTimeout(60000);
    const profile = mkdtempSync(join(tmpdir(), "anttodo-delete-weekly-group-"));
    const app = await electron.launch({ executablePath: process.env.ANTTODO_WEEKLY_GROUPS_ELECTRON_PATH, args: [`--user-data-dir=${profile}`] });
    try {
      await expect.poll(() => app.windows().some((page) => page.url().startsWith("file:") && !page.url().includes("#/tray"))).toBe(true);
      const page = app.windows().find((page) => page.url().startsWith("file:") && !page.url().includes("#/tray"))!;
      await page.waitForLoadState("domcontentloaded"); await login(page, 0, true);
      await confirmDelete(page);
      await expect(page.getByRole("heading", { name: "默认周报组", exact: true })).toBeVisible();
      await network(page, false);
      await expect(page.getByRole("button", { name: "删除周报组", exact: true })).toBeDisabled();
      expect((await checked(await admin!.from("weekly_reports").select("id").eq("weekly_report_group_id", groupId))).length).toBe(0);
    } finally { await app.close(); rmSync(profile, { recursive: true, force: true }); }
  });
});
