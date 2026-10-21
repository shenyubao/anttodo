import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient, type Session } from "@supabase/supabase-js";
import { _electron as electron, expect, test } from "@playwright/test";

// Requires a build configured for the local Supabase stack. Never uses a remote project.
const enabled = process.env.ANTTODO_LOCAL_OKR_E2E === "1";
const local = enabled ? JSON.parse(execFileSync("supabase", ["status", "-o", "json"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
})) as Record<string, string> : {};
const admin = enabled ? createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
}) : null;
const ownerClient = enabled ? createClient(local.API_URL, local.PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
}) : null;
let session: Session;
let workspaceId: string;
let cycleId: string;
let setId: string;
let objectiveId: string;
const users: string[] = [];

async function checked<T>(result: { data: T; error: { message: string } | null }): Promise<T> {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

test.describe("local OKR saves", () => {
  test.skip(!enabled, "Set ANTTODO_LOCAL_OKR_E2E=1 and build against the local Supabase stack");
  test.beforeAll(async () => {
    for (const name of ["OKR 验证", "产品同学", "研发同学"]) {
      const email = `okr-save-${randomUUID()}@example.test`;
      const password = `Okr-${randomUUID()}!`;
      const { user } = await checked(await admin!.auth.admin.createUser({ email, password,
        email_confirm: true, user_metadata: { display_name: name } }));
      users.push(user!.id);
      if (users.length === 1) {
        session = (await checked(await ownerClient!.auth.signInWithPassword({ email, password }))).session!;
      }
    }
    workspaceId = (await checked(await ownerClient!.from("workspaces").insert({ name: "OKR 保存验证", created_by: users[0] }).select("id").single())).id;
    await checked(await admin!.from("workspace_members").insert(users.slice(1).map((user_id) => ({ workspace_id: workspaceId, user_id, role: "member" }))));
    cycleId = (await checked(await ownerClient!.from("okr_cycles").insert({ workspace_id: workspaceId,
      name: "验证周期", starts_on: "2026-01-01", ends_on: "2026-12-31", status: "active", created_by: users[0] }).select("id").single())).id;
    setId = (await checked(await ownerClient!.from("okr_sets").insert({ workspace_id: workspaceId, cycle_id: cycleId, owner_id: users[0] }).select("id").single())).id;
    objectiveId = (await checked(await ownerClient!.from("okr_objectives").insert({ workspace_id: workspaceId, set_id: setId, title: "效率提升" }).select("id").single())).id;
    await checked(await ownerClient!.from("okr_key_results").insert(["优化自动化测试", "探索全栈开发", "提升交付质量"].map((title, position) => ({
      workspace_id: workspaceId, objective_id: objectiveId, title, position, weight: [33.33, 33.33, 33.34][position],
    }))));
  });
  test.afterAll(async () => {
    if (workspaceId) await admin!.from("workspaces").delete().eq("id", workspaceId);
    for (const user of users) await admin!.auth.admin.deleteUser(user);
  });

  test("uses one save RPC, reuses the member menu, refreshes remotely, and stays read-only offline", async ({ page, context }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(({ session, key }) => {
      localStorage.setItem(key, JSON.stringify(session));
      localStorage.setItem("anttodo:feature-modules", JSON.stringify({ okrEnabled: true }));
    }, { session, key: `sb-${new URL(local.API_URL).hostname.split(".")[0]}-auth-token` });
    await page.goto("/");
    await page.locator(".navigation-rail").getByRole("button", { name: "OKR", exact: true }).click();
    await page.getByRole("button", { name: "编辑 Objective" }).click();
    const editor = page.locator(".okr-objective-card.editing");
    const addBox = await editor.getByRole("button", { name: "添加 Key Result" }).boundingBox();
    const noteBox = await editor.getByLabel("备注", { exact: true }).boundingBox();
    expect(addBox!.y + addBox!.height).toBeLessThanOrEqual(noteBox!.y);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/rest/v1/")) requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    await editor.locator(".okr-member-control").first().getByRole("button").click();
    const menu = page.getByRole("menu", { name: "选择负责人" });
    await expect(menu.getByRole("searchbox", { name: "搜索负责人" })).toBeFocused();
    await menu.getByRole("searchbox").fill("研发");
    await expect(menu.getByRole("menuitemradio")).toHaveCount(1);
    expect(requests).toEqual([]);
    await menu.getByRole("searchbox").fill("");
    await page.screenshot({ path: "test-results/okr-member-desktop.png" });
    await menu.getByRole("menuitemradio", { name: "我", exact: true }).click();
    await editor.getByLabel("Objective 标题", { exact: true }).fill("效率提升：合并保存");
    await editor.getByLabel("KR1 标题", { exact: true }).fill("优化自动化测试与网络请求");
    await editor.getByLabel("KR2 标题", { exact: true }).fill("探索全栈开发并交付");
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    expect(requests.filter((url) => url === "POST /rest/v1/rpc/save_okr_changes")).toHaveLength(1);
    expect(requests.some((url) => /\/tasks(?:$|\?)/.test(url))).toBe(false);
    await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect(requests.filter((url) => url === "POST /rest/v1/rpc/save_okr_changes")).toHaveLength(1);
    await page.getByRole("button", { name: "编辑 Objective" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await editor.locator(".okr-member-control").first().getByRole("button").click();
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox!.x).toBeGreaterThanOrEqual(12);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(378);
    await page.screenshot({ path: "test-results/okr-member-mobile.png" });
    await page.keyboard.press("Escape");
    await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
    await checked(await ownerClient!.rpc("save_okr_changes", { p_set_id: setId,
      p_changes: { objectives: [{ id: objectiveId, fields: { note: "来自另一客户端的更新" } }] } }));
    await expect(page.getByLabel("备注", { exact: true }).first()).toHaveValue("来自另一客户端的更新");
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.getByRole("button", { name: "编辑 Objective" })).toHaveCount(0);
    await expect(page.getByText("效率提升：合并保存", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
  test("shows visible linked task totals and opens the existing task-list tab", async ({ page, context }) => {
    const keyResults = await checked(await ownerClient!.from("okr_key_results").select("id").eq("objective_id", objectiveId).order("position"));
    const taskRows = await checked(await admin!.from("tasks").insert([
      { workspace_id: workspaceId, created_by: users[0], title: "关联的进行中待办", status: "open", completed_at: null },
      { workspace_id: workspaceId, created_by: users[0], title: "关联的已完成待办", status: "completed", completed_at: new Date().toISOString() },
      { workspace_id: workspaceId, created_by: users[0], title: "已删除的关联待办", status: "open", completed_at: null },
    ]).select("id,title"));
    for (let index = 0; index < taskRows.length; index += 1) {
      await checked(await ownerClient!.rpc("set_task_okr_link", { p_task_id: taskRows[index].id, p_key_result_id: keyResults[index === 1 ? 1 : 0].id }));
    }
    await checked(await ownerClient!.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", taskRows[2].id));
    const privateLabel = await checked(await admin!.from("labels").insert({ workspace_id: workspaceId,
      created_by: users[1], name: "个人标签", kind: "private" }).select("id").single());
    const hidden = await checked(await admin!.from("tasks").insert({ workspace_id: workspaceId,
      created_by: users[0], title: "无权查看的关联待办" }).select("id").single());
    await checked(await ownerClient!.rpc("set_task_okr_link", { p_task_id: hidden.id, p_key_result_id: keyResults[0].id }));
    await checked(await admin!.from("task_labels").insert({ task_id: hidden.id, label_id: privateLabel.id }));
    expect(await checked(await ownerClient!.from("tasks").select("id").eq("id", hidden.id))).toEqual([]);
    await page.addInitScript(({ session, key }) => {
      localStorage.setItem(key, JSON.stringify(session));
      localStorage.setItem("anttodo:feature-modules", JSON.stringify({ okrEnabled: true }));
    }, { session, key: `sb-${new URL(local.API_URL).hostname.split(".")[0]}-auth-token` });
    const countRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith("/task_okr_links") && url.searchParams.get("select")?.includes("tasks!inner")) countRequests.push(request.url());
    });
    await page.goto("/");
    await page.locator(".navigation-rail").getByRole("button", { name: "OKR", exact: true }).click();
    const total = page.locator(".okr-objective-row .okr-task-count").first();
    const krCounts = page.locator(".okr-kr-row .okr-task-count");
    await expect(total).toHaveText("2");
    await expect(krCounts).toHaveText(["1", "1", "0"]);
    expect(countRequests).toHaveLength(1);
    await page.mouse.move(0, 700);
    await page.screenshot({ path: "test-results/okr-task-counts-desktop.png" });
    await total.click();
    const detail = page.getByRole("dialog", { name: "OKR 详情" });
    await expect(detail.getByRole("tab", { name: "待办清单" })).toHaveAttribute("aria-selected", "true");
    await expect(detail.locator(".okr-linked-task")).toHaveCount(2);
    await expect(detail).toContainText("关联的已完成待办");
    await expect(detail).not.toContainText("已删除的关联待办");
    await expect(detail).not.toContainText("无权查看的关联待办");
    await page.getByRole("button", { name: "关闭 OKR 详情" }).click();
    await krCounts.first().click();
    await expect(detail.getByRole("tab", { name: "待办清单" })).toHaveAttribute("aria-selected", "true");
    await expect(detail.locator(".okr-linked-task")).toHaveCount(1);
    await page.getByRole("button", { name: "关闭 OKR 详情" }).click();
    await krCounts.nth(2).click();
    await expect(detail.getByRole("tab", { name: "待办清单" })).toHaveAttribute("aria-selected", "true");
    await expect(detail).toContainText("暂无关联待办");
    await page.getByRole("button", { name: "关闭 OKR 详情" }).click();
    await checked(await ownerClient!.rpc("set_task_okr_link", { p_task_id: taskRows[0].id, p_key_result_id: null }));
    await expect(total).toHaveText("1");
    await expect(krCounts.first()).toHaveText("0");
    await total.click();
    await expect(detail.locator(".okr-linked-task")).toHaveCount(1);
    await page.getByRole("button", { name: "关闭 OKR 详情" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => {
      const sidebar = await page.locator(".okr-member-sidebar").boundingBox();
      return Math.ceil(sidebar!.x + sidebar!.width);
    }).toBeLessThanOrEqual(0);
    await page.screenshot({ path: "test-results/okr-task-counts-mobile.png" });
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(total).toHaveText("1");
    await total.click();
    await expect(detail.getByRole("tab", { name: "待办清单" })).toHaveAttribute("aria-selected", "true");
    await expect(detail.locator(".okr-linked-task")).toHaveCount(1);
  });

  test("packaged Electron keeps the shared save path and sandbox enabled", async () => {
    test.skip(!process.env.ANTTODO_OKR_ELECTRON_PATH, "Provide a locally configured packaged app executable");
    test.setTimeout(60_000);
    const profile = mkdtempSync(join(tmpdir(), "anttodo-okr-electron-"));
    const app = await test.step("Launch packaged Electron", () => electron.launch({ executablePath: process.env.ANTTODO_OKR_ELECTRON_PATH,
      args: [`--user-data-dir=${profile}`], timeout: 20_000 }));
    try {
      const page = await test.step("Wait for main window", () => app.firstWindow());
      const security = await app.evaluate(({ app, BrowserWindow }) => ({
        packaged: app.isPackaged,
        sandbox: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox,
        nodeIntegration: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().nodeIntegration,
      }));
      expect(security).toEqual({ packaged: true, sandbox: true, nodeIntegration: false });
      await test.step("Wait for app document", () => page.waitForLoadState("domcontentloaded"));
      await page.evaluate(({ session, key }) => {
        localStorage.setItem(key, JSON.stringify(session));
        localStorage.setItem("anttodo:feature-modules", JSON.stringify({ okrEnabled: true }));
      }, { session, key: `sb-${new URL(local.API_URL).hostname.split(".")[0]}-auth-token` });
      await test.step("Restore signed-in app", () => page.reload());
      await page.locator(".navigation-rail").getByRole("button", { name: "OKR", exact: true }).click();
      await page.getByRole("button", { name: "编辑 Objective" }).click();
      const requests: string[] = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && request.url().includes("/rpc/save_okr_changes")) requests.push(request.url());
      });
      await page.getByLabel("Objective 标题", { exact: true }).fill("Electron 批量保存验证");
      await page.getByLabel("KR1 标题", { exact: true }).fill("Electron 与 Web 共用接口");
      await page.getByRole("button", { name: "保存草稿", exact: true }).click();
      await expect(page.locator(".okr-objective-card.editing")).toHaveCount(0);
      expect(requests).toHaveLength(1);
      await expect(page.locator(".okr-objective-row .okr-task-count").first()).toHaveText(/\d+/);
      await page.locator(".okr-objective-row .okr-task-count").first().click();
      await expect(page.getByRole("dialog", { name: "OKR 详情" }).getByRole("tab", { name: "待办清单" })).toHaveAttribute("aria-selected", "true");
      await page.getByRole("button", { name: "关闭 OKR 详情" }).click();
      await page.screenshot({ path: "test-results/okr-electron.png" });
    } finally {
      await test.step("Close packaged app", () => app.close());
      rmSync(profile, { recursive: true, force: true });
    }
  });

});
