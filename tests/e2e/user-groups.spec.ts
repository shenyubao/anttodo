import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Session } from "@supabase/supabase-js";
import { _electron as electron, expect, test, type Page } from "@playwright/test";

const enabled = process.env.ANTTODO_LOCAL_GROUPS_E2E === "1";
const local = enabled ? JSON.parse(execFileSync("supabase", ["status", "-o", "json"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
})) as Record<string, string> : {};
const admin = enabled ? createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } }) : null;
const api = enabled ? createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth: { persistSession: false } }) : null;
const users: string[] = [];
const sessions: Session[] = [];
let workspaceId: string;
let groupId: string;
let labelId: string;
let taskId: string;
let cycleId: string;
let reportId: string;
async function checked<T>({ data, error }: { data: T; error: { message: string } | null }): Promise<T> {
  if (error) throw new Error(error.message);
  return data;
}
async function login(page: Page, member = false, desktop = false) {
  const input = { session: sessions[member ? 1 : 0], workspaceId, key: `sb-${new URL(local.API_URL).hostname.split(".")[0]}-auth-token` };
  const initialize = ({ session, key, workspaceId }: typeof input) => {
    localStorage.setItem(key, JSON.stringify(session));
    localStorage.setItem("anttodo:last-workspace-id", workspaceId);
    localStorage.setItem("anttodo:feature-modules", JSON.stringify({ okrEnabled: true, weeklyReportsEnabled: true }));
  };
  if (desktop) { await page.evaluate(initialize, input); await page.reload(); }
  else { await page.addInitScript(initialize, input); await page.goto("/"); }
  await expect(page.locator(".navigation-rail")).toBeVisible();
}
async function openGroups(page: Page) {
  await page.locator(".navigation-rail").getByRole("button", { name: "设置", exact: true }).click();
  await page.locator(".settings-tabs").getByRole("button", { name: "用户组", exact: true }).click();
  await expect(page.locator(".user-groups-panel")).toBeVisible();
}
async function saveRpc(memberIds: string[]) {
  const current = await checked(await api!.from("user_group_members").select("user_id").eq("group_id", groupId));
  return checked(await api!.rpc("save_user_group", { p_workspace_id: workspaceId, p_id: groupId, p_name: "权限验证组",
    p_member_ids: memberIds, p_expected_name: "权限验证组", p_expected_member_ids: current.map((row) => row.user_id) }));
}

test.describe("user-group saves and permission verification", () => {
  test.skip(!enabled, "Requires a build configured for local Supabase and ANTTODO_LOCAL_GROUPS_E2E=1");
  test.beforeAll(async () => {
    for (const name of ["用户组管理员", "用户组验证成员"]) {
      const email = `group-${randomUUID()}@example.test`;
      const password = `Group-${randomUUID()}!`;
      const user = (await checked(await admin!.auth.admin.createUser({ email, password, email_confirm: true,
        user_metadata: { display_name: name } }))).user!;
      users.push(user.id);
      const client = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth: { persistSession: false } });
      sessions.push((await checked(await client.auth.signInWithPassword({ email, password }))).session!);
    }
    await api!.auth.setSession(sessions[0]);
    workspaceId = (await checked(await api!.from("workspaces").insert({ name: "用户组优化验证", created_by: users[0] }).select("id").single())).id;
    await checked(await admin!.from("workspace_members").insert({ workspace_id: workspaceId, user_id: users[1], role: "member" }));
    groupId = randomUUID();
    await checked(await api!.rpc("save_user_group", { p_workspace_id: workspaceId, p_id: groupId, p_name: "权限验证组", p_member_ids: [users[1]] }));
    labelId = (await checked(await api!.rpc("create_label_with_access", { p_workspace_id: workspaceId, p_parent_id: null,
      p_name: "用户组私密标签", p_color: "#4772fa", p_kind: "team", p_view_scope: "groups", p_manage_scope: "groups",
      p_view_subject_ids: [groupId], p_manage_subject_ids: [groupId], p_inherit_permissions: false }))).id;
    taskId = (await checked(await admin!.from("tasks").insert({ workspace_id: workspaceId, created_by: users[0], title: "用户组私密任务" }).select("id").single())).id;
    await checked(await admin!.from("task_labels").insert({ task_id: taskId, label_id: labelId }));
    cycleId = (await checked(await admin!.from("okr_cycles").insert({ workspace_id: workspaceId, created_by: users[0], name: "用户组周期", starts_on: "2026-01-01", ends_on: "2026-12-31", status: "active" }).select("id").single())).id;
    const setId = (await checked(await admin!.from("okr_sets").insert({ workspace_id: workspaceId, cycle_id: cycleId, owner_id: users[0], visibility: "restricted", published_at: new Date().toISOString(), published_version: 1 }).select("id").single())).id;
    await checked(await admin!.from("okr_set_group_acl").insert({ workspace_id: workspaceId, set_id: setId, group_id: groupId }));
    await checked(await admin!.from("okr_objectives").insert({ workspace_id: workspaceId, set_id: setId, title: "用户组私密目标", published_at: new Date().toISOString() }));
    const weeklyGroup = (await checked(await admin!.from("weekly_report_groups").insert({ workspace_id: workspaceId, name: "用户组周报", participant_ids: [users[0]], visibility: "selected", viewer_group_ids: [groupId] }).select("id").single())).id;
    reportId = (await checked(await admin!.from("weekly_reports").insert({ workspace_id: workspaceId, weekly_report_group_id: weeklyGroup, author_id: users[0], week_start: "2026-11-02", completed_text: "用户组私密周报正文", status: "published", published_at: new Date().toISOString() }).select("id").single())).id;
  });
  test.afterAll(async () => {
    if (workspaceId) await admin!.from("workspaces").delete().eq("id", workspaceId);
    for (const id of users) await admin!.auth.admin.deleteUser(id);
  });

  test("one write closes the dialog while permission reads wait", async ({ page }) => {
    await login(page);
    await openGroups(page);
    let rpcWrites = 0;
    let taskPages = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/rpc/save_user_group")) rpcWrites++;
      if (request.url().endsWith("/rpc/get_task_page")) taskPages++;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/rest/v1/rpc/get_task_page", async (route) => { await gate; await route.continue(); });
    await page.getByRole("button", { name: "新建用户组", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "新建用户组" });
    await dialog.getByPlaceholder("例如：产品组").fill("优化用户组");
    await dialog.locator("label").filter({ hasText: "用户组验证成员" }).getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".user-group-row").filter({ hasText: "优化用户组" })).toBeVisible();
    await expect(page.locator(".permission-refresh-banner")).toBeVisible();
    expect(rpcWrites).toBe(1);
    await page.screenshot({ path: "test-results/user-groups-saved-pending.png" });
    release();
    await expect(page.locator(".permission-refresh-banner")).toBeHidden();
    expect(taskPages).toBeGreaterThanOrEqual(1);
  });

  test("rename and no-op avoid permission reloads", async ({ page }) => {
    const id = randomUUID();
    await checked(await api!.rpc("save_user_group", { p_workspace_id: workspaceId, p_id: id, p_name: "仅改名用户组", p_member_ids: [] }));
    await login(page);
    await openGroups(page);
    let rpcWrites = 0;
    let taskPages = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/rpc/save_user_group")) rpcWrites++;
      if (request.url().endsWith("/rpc/get_task_page")) taskPages++;
    });
    const row = page.locator(".user-group-row").filter({ hasText: "仅改名用户组" });
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑用户组" });
    await editor.getByPlaceholder("例如：产品组").fill("仅改名用户组已更新");
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(page.locator(".user-group-row").filter({ hasText: "仅改名用户组已更新" })).toBeVisible();
    await page.waitForTimeout(400);
    expect(taskPages).toBe(0);
    expect(rpcWrites).toBe(1);
    await page.locator(".user-group-row").filter({ hasText: "仅改名用户组已更新" }).getByRole("button", { name: "编辑", exact: true }).click();
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await expect(editor).toBeHidden();
    expect(rpcWrites).toBe(1);
  });

  test("another session retains readonly content while verifying, removes revoked content, and stays readonly offline", async ({ page, context }) => {
    await saveRpc([users[1]]);
    await login(page, true);
    await page.locator(".sidebar").getByRole("button", { name: /^用户组私密标签/ }).click();
    await expect(page.locator(".task-row").filter({ hasText: "用户组私密任务" })).toBeVisible();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/rest/v1/rpc/get_task_page", async (route) => { await gate; await route.continue(); });
    await saveRpc([]);
    await expect(page.locator(".permission-refresh-banner")).toBeVisible();
    await expect(page.locator(".task-row").filter({ hasText: "用户组私密任务" })).toBeVisible();
    await expect(page.locator(".workspace-main .quick-add input[data-quick-add-input]").first()).toBeDisabled();
    release();
    await expect(page.locator(".permission-refresh-banner")).toBeHidden();
    await expect(page.locator(".task-row").filter({ hasText: "用户组私密任务" })).toHaveCount(0);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".workspace-main .quick-add input[data-quick-add-input]").first()).toBeDisabled();
    await page.screenshot({ path: "test-results/user-groups-mobile-offline.png" });
    await context.setOffline(false);
    await page.reload();
    await expect(page.locator(".task-row").filter({ hasText: "用户组私密任务" })).toHaveCount(0);
  });

  test("revocation clears cached OKR and weekly-report views in other tabs", async ({ page, context }) => {
    await saveRpc([users[1]]);
    await login(page, true);
    await page.goto(`/#/workspaces/${workspaceId}/okr/${users[0]}/cycles/${cycleId}`);
    await expect(page.getByRole("button", { name: "用户组私密目标", exact: true })).toBeVisible();
    const weekly = await context.newPage();
    await login(weekly, true);
    await weekly.goto(`/#/workspaces/${workspaceId}/weekly-reports/${reportId}`);
    await expect(weekly.getByText("用户组私密周报正文", { exact: true })).toBeVisible();
    await saveRpc([]);
    await expect(page.getByRole("button", { name: "用户组私密目标", exact: true })).toHaveCount(0);
    await expect(weekly.getByText("用户组私密周报正文", { exact: true })).toHaveCount(0);
    await expect(page.locator(".permission-refresh-banner")).toBeHidden();
    await expect(weekly.locator(".permission-refresh-banner")).toBeHidden();
    await weekly.reload();
    await expect(weekly.getByText("用户组私密周报正文", { exact: true })).toHaveCount(0);
    await weekly.close();
  });

  test("a rejected write preserves input and a stale editor reports a conflict", async ({ page }) => {
    await login(page);
    await openGroups(page);
    await page.getByRole("button", { name: "新建用户组", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "新建用户组" });
    await dialog.getByPlaceholder("例如：产品组").fill("保留输入");
    await page.route("**/rest/v1/rpc/save_user_group", (route) => route.fulfill({ status: 403,
      contentType: "application/json", body: JSON.stringify({ code: "42501", message: "模拟保存被拒绝" }) }));
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("模拟保存被拒绝");
    await expect(dialog.getByPlaceholder("例如：产品组")).toHaveValue("保留输入");
    await page.unroute("**/rest/v1/rpc/save_user_group");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await page.locator(".user-group-row").filter({ hasText: "权限验证组" }).getByRole("button", { name: "编辑", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑用户组" });
    await editor.getByPlaceholder("例如：产品组").fill("我的修改");
    await checked(await api!.from("user_groups").update({ name: "其他人的修改" }).eq("id", groupId));
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText("重新打开");
    await expect(editor.getByPlaceholder("例如：产品组")).toHaveValue("我的修改");
    await checked(await api!.from("user_groups").update({ name: "权限验证组" }).eq("id", groupId));
  });

  test("a committed save remains successful when verification fails and retry sends reads only", async ({ page }) => {
    await login(page);
    await openGroups(page);
    let writes = 0;
    page.on("request", (request) => { if (request.url().endsWith("/rpc/save_user_group")) writes++; });
    await page.route("**/rest/v1/rpc/get_task_page", (route) => route.fulfill({ status: 503,
      contentType: "application/json", body: JSON.stringify({ message: "模拟权限读取不可用" }) }));
    await page.getByRole("button", { name: "新建用户组", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "新建用户组" });
    await dialog.getByPlaceholder("例如：产品组").fill("已保存待核对");
    await dialog.locator("label").filter({ hasText: "用户组验证成员" }).getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".user-group-row").filter({ hasText: "已保存待核对" })).toBeVisible();
    await expect(page.locator(".permission-refresh-banner")).toContainText("权限刷新失败");
    await page.getByRole("button", { name: "关闭设置", exact: true }).first().click();
    await page.unroute("**/rest/v1/rpc/get_task_page");
    await page.locator(".permission-refresh-banner").getByRole("button", { name: "重新加载", exact: true }).click();
    await expect(page.locator(".permission-refresh-banner")).toBeHidden();
    expect(writes).toBe(1);
  });

  test("packaged Electron saves with the shared RPC and disables writes offline", async () => {
    test.skip(!process.env.ANTTODO_GROUPS_ELECTRON_PATH, "Provide a packaged app configured for local Supabase");
    test.setTimeout(60_000);
    const profile = mkdtempSync(join(tmpdir(), "anttodo-groups-electron-"));
    const app = await electron.launch({ executablePath: process.env.ANTTODO_GROUPS_ELECTRON_PATH, args: [`--user-data-dir=${profile}`] });
    try {
      await expect.poll(() => app.windows().some((page) => page.url().startsWith("file:") && !page.url().includes("#/tray"))).toBe(true);
      const page = app.windows().find((page) => page.url().startsWith("file:") && !page.url().includes("#/tray"))!;
      await page.waitForLoadState("domcontentloaded");
      await login(page, false, true);
      await openGroups(page);
      await page.getByRole("button", { name: "新建用户组", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "新建用户组" });
      await dialog.getByPlaceholder("例如：产品组").fill("Electron 用户组");
      await dialog.getByRole("button", { name: "保存", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(page.locator(".user-group-row").filter({ hasText: "Electron 用户组" })).toBeVisible();
      await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, value: false }); window.dispatchEvent(new Event("offline")); });
      await expect(page.getByRole("button", { name: "新建用户组", exact: true })).toBeDisabled();
      const security = await app.evaluate(({ app, BrowserWindow }) => {
        const main = BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes("#/tray"))!;
        return { packaged: app.isPackaged, sandbox: main.webContents.getLastWebPreferences().sandbox, nodeIntegration: main.webContents.getLastWebPreferences().nodeIntegration };
      });
      expect(security).toEqual({ packaged: true, sandbox: true, nodeIntegration: false });
    } finally { await app.close(); rmSync(profile, { recursive: true, force: true }); }
  });
});
