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
async function checked<T>({ data, error }: { data: T; error: { message: string } | null }): Promise<T> {
  if (error) throw new Error(error.message);
  return data;
}
async function login(page: Page, user = 1, desktop = false) {
  const input = { session: sessions[user], workspaceId, key: `sb-${new URL(local.API_URL).hostname.split(".")[0]}-auth-token` };
  const initialize = ({ session, key, workspaceId }: typeof input) => {
    localStorage.setItem(key, JSON.stringify(session));
    localStorage.setItem("anttodo:last-workspace-id", workspaceId);
    localStorage.setItem("anttodo:feature-modules", JSON.stringify({ weeklyReportsEnabled: true }));
  };
  if (desktop) { await page.evaluate(initialize, input); await page.reload(); }
  else { await page.addInitScript(initialize, input); await page.goto(`/#/workspaces/${workspaceId}/weekly-reports`); }
  await expect(page.locator(".navigation-rail")).toBeAttached();
  if (desktop) await page.locator(".navigation-rail").getByRole("button", { name: "周报", exact: true }).click();
  await expect(page.locator('.weekly-report-group-caption [aria-label="新建周报组"]')).toBeEnabled();
}
async function network(page: Page, online: boolean) {
  await page.evaluate((online) => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: online });
    window.dispatchEvent(new Event(online ? "online" : "offline"));
  }, online);
}
async function createGroup(page: Page) {
  await page.locator('.weekly-report-group-caption [aria-label="新建周报组"]').click();
  const dialog = page.getByRole("dialog", { name: "新建周报组", exact: true });
  await dialog.getByRole("textbox", { name: "组名", exact: true }).fill("成员创建周报组");
  await dialog.locator(".weekly-report-config-members label").filter({ hasText: "填写成员" }).getByRole("checkbox").check();
  await dialog.getByRole("radio", { name: "指定用户和用户组", exact: true }).check();
  await expect(dialog).toContainText("周报组创建者");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "成员创建周报组", exact: true })).toBeVisible();
  const row = await checked(await admin!.from("weekly_report_groups").select("id,created_by,participant_ids,viewer_user_ids")
    .eq("workspace_id", workspaceId).eq("name", "成员创建周报组").single());
  expect(row.created_by).toBe(users[1]);
  expect(row.participant_ids).toEqual([users[2]]);
  expect(row.viewer_user_ids).toEqual([]);
  return row.id as string;
}
async function deleteGroup(page: Page) {
  await expect(page.getByRole("button", { name: "删除周报组", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "删除周报组", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除周报组", exact: true });
  await dialog.getByRole("button", { name: "永久删除", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "默认周报组", exact: true })).toBeVisible();
}

test.describe("weekly report group creator permissions", () => {
  test.skip(!enabled, "Requires local Supabase and ANTTODO_LOCAL_WEEKLY_GROUPS_E2E=1");
  test.beforeAll(async () => {
    for (const name of ["团队所有者", "周报组创建者", "填写成员"]) {
      const email = `weekly-creator-${randomUUID()}@example.test`;
      const password = `Weekly-creator-${randomUUID()}!`;
      const user = (await checked(await admin!.auth.admin.createUser({ email, password, email_confirm: true,
        user_metadata: { display_name: name } }))).user!;
      users.push(user.id);
      const client = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth: { persistSession: false } });
      sessions.push((await checked(await client.auth.signInWithPassword({ email, password }))).session!);
    }
    await checked(await api!.auth.setSession(sessions[0]));
  });
  test.beforeEach(async () => {
    workspaceId = (await checked(await api!.from("workspaces").insert({ name: "创建者权限验证", created_by: users[0] }).select("id").single())).id;
    await checked(await admin!.from("workspace_members").insert(users.slice(1).map((user_id) => ({ workspace_id: workspaceId, user_id, role: "member" }))));
  });
  test.afterEach(async () => { if (workspaceId) await checked(await admin!.from("workspaces").delete().eq("id", workspaceId)); });
  test.afterAll(async () => { for (const id of users) await checked(await admin!.auth.admin.deleteUser(id)); });

  test("member creates, sees published reports, edits and deletes; other members cannot manage", async ({ page, browser }) => {
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await login(page);
    await expect(page.locator(".weekly-report-group-add")).toBeEnabled();
    const id = await createGroup(page);
    await expect(page.getByRole("button", { name: "新建周报", exact: true })).toBeDisabled();
    const now = new Date(); now.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const week = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    await checked(await admin!.from("weekly_reports").insert({ workspace_id: workspaceId, weekly_report_group_id: id,
      author_id: users[2], week_start: week, completed_text: "创建者可查看的已发布内容", status: "published", published_at: new Date().toISOString() }));
    await page.locator(".weekly-report-card").filter({ hasText: "填写成员" }).click();
    await expect(page.getByText("创建者可查看的已发布内容", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "返回周报列表", exact: true }).click();
    await page.getByRole("button", { name: "周报组配置", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "编辑周报组", exact: true });
    await edit.getByRole("textbox", { name: "组名", exact: true }).fill("创建者已编辑");
    await page.route("**/rest/v1/rpc/save_weekly_report_group", (route) => route.fulfill({ status: 403,
      contentType: "application/json", body: JSON.stringify({ message: "模拟保存失败" }) }));
    await edit.getByRole("button", { name: "保存", exact: true }).click();
    await expect(edit.getByRole("alert")).toContainText("模拟保存失败");
    await page.unroute("**/rest/v1/rpc/save_weekly_report_group");
    await edit.getByRole("button", { name: "保存", exact: true }).click();
    await expect(edit).toBeHidden();
    await expect(page.getByRole("heading", { name: "创建者已编辑", exact: true })).toBeVisible();
    const peer = await browser.newContext();
    try {
      const peerPage = await peer.newPage(); await login(peerPage, 2);
      await peerPage.locator(".weekly-report-group-row").filter({ hasText: "创建者已编辑" }).click();
      await expect(peerPage.getByRole("button", { name: "删除周报组", exact: true })).toHaveCount(0);
      await peerPage.getByRole("button", { name: "周报组配置", exact: true }).click();
      await expect(peerPage.getByRole("dialog").getByRole("textbox", { name: "组名", exact: true })).toBeDisabled();
    } finally { await peer.close(); }
    await page.screenshot({ path: "test-results/weekly-group-creator-desktop.png" });
    await page.reload();
    await expect(page.getByRole("heading", { name: "创建者已编辑", exact: true })).toBeVisible();
    await network(page, false);
    await expect(page.getByRole("button", { name: "删除周报组", exact: true })).toBeDisabled();
    await expect(page.locator(".weekly-report-group-add")).toBeDisabled();
    await network(page, true);
    await deleteGroup(page);
    expect(await checked(await admin!.from("weekly_reports").select("id").eq("weekly_report_group_id", id))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("shared mobile path supports member creation and creator configuration", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.locator(".weekly-report-mobile-toolbar").getByRole("button", { name: "默认周报组", exact: true }).click();
    await createGroup(page);
    await page.getByRole("button", { name: "周报组配置", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "编辑周报组", exact: true });
    await expect(dialog.getByRole("textbox", { name: "组名", exact: true })).toBeEnabled();
    const box = await dialog.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: "test-results/weekly-group-creator-phone.png" });
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await network(page, false);
    await expect(page.getByRole("button", { name: "删除周报组", exact: true })).toBeDisabled();
  });

  test("packaged Electron member creates and manages their own group", async () => {
    test.skip(!process.env.ANTTODO_WEEKLY_GROUPS_ELECTRON_PATH, "Requires packaged app configured for local Supabase");
    test.setTimeout(60000);
    const profile = mkdtempSync(join(tmpdir(), "anttodo-creator-weekly-group-"));
    const app = await electron.launch({ executablePath: process.env.ANTTODO_WEEKLY_GROUPS_ELECTRON_PATH, args: [`--user-data-dir=${profile}`] });
    try {
      await expect.poll(() => app.windows().some((page) => page.url().startsWith("file:") && !page.url().includes("#/tray"))).toBe(true);
      const page = app.windows().find((page) => page.url().startsWith("file:") && !page.url().includes("#/tray"))!;
      await page.waitForLoadState("domcontentloaded"); await login(page, 1, true);
      await createGroup(page);
      await page.screenshot({ path: "test-results/weekly-group-creator-electron.png" });
      await page.getByRole("button", { name: "周报组配置", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "编辑周报组", exact: true });
      await expect(dialog.getByRole("textbox", { name: "组名", exact: true })).toBeEnabled();
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      await network(page, false);
      await expect(page.getByRole("button", { name: "删除周报组", exact: true })).toBeDisabled();
      await network(page, true);
      await deleteGroup(page);
    } finally { await app.close(); rmSync(profile, { recursive: true, force: true }); }
  });
});
