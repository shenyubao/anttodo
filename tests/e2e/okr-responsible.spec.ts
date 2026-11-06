import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient, type Session } from "@supabase/supabase-js";
import { _electron as electron, expect, test, type Page } from "@playwright/test";

const enabled = process.env.ANTTODO_LOCAL_OKR_E2E === "1";
const local = enabled ? JSON.parse(execFileSync("supabase", ["status", "-o", "json"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
})) as Record<string, string> : {};
const admin = enabled ? createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const contributor = enabled ? createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const users: string[] = [];
let session: Session;
let workspaceId: string;
let cycleId: string;
let keyResultId: string;
let otherKeyResultId: string;
let setId: string;
let route: string;
async function checked<T>(result: { data: T; error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
const authKey = () => `sb-${new URL(local.API_URL).hostname.split(".")[0]}-auth-token`;
async function restore(page: Page) {
  await page.addInitScript(({ session, key }) => {
    localStorage.setItem(key, JSON.stringify(session));
    localStorage.setItem("anttodo:feature-modules", JSON.stringify({ okrEnabled: true }));
  }, { session, key: authKey() });
  await page.goto(route);
}
async function verifyAndContribute(page: Page, name: string) {
  const detail = page.getByRole("dialog", { name: "OKR 详情" });
  await expect(detail).toBeVisible();
  await expect(detail.locator(".okr-task-composer input[placeholder]")).toBeEnabled();
  await detail.locator(".okr-task-composer input[placeholder]").fill(`${name} 负责人待办`);
  await detail.locator(".okr-task-composer input[placeholder]").press("Enter");
  await expect(detail.getByRole("button", { name: new RegExp(`${name} 负责人待办`) })).toBeVisible();
  await detail.getByRole("tab", { name: "进展记录" }).click();
  await detail.getByLabel("记录进展", { exact: true }).fill(`${name} 负责人更新进展`);
  await detail.locator('.okr-composer-value input').fill("55");
  await detail.getByRole("button", { name: "提交", exact: true }).click();
  await expect(detail.locator(".okr-progress-record-card").getByText(`${name} 负责人更新进展`, { exact: true })).toBeVisible();
  const records = await checked(await contributor!.from("okr_progress_records").select("actor_id,current_value").eq("key_result_id", keyResultId).eq("detail", `${name} 负责人更新进展`));
  expect(records).toEqual([{ actor_id: users[1], current_value: 55 }]);
  await detail.getByRole("tab", { name: "备注" }).click();
  await expect(detail.locator(".mdxeditor")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "编辑 Objective" })).toHaveCount(0);
  await detail.getByRole("tab", { name: "待办清单" }).click();
}

test.describe("KR responsible contributions on shared clients", () => {
  test.skip(!enabled, "Requires a build configured for local Supabase");
  test.beforeAll(async () => {
    for (const name of ["OKR 所有者", "刘兵验证"]) {
      const email = `okr-responsible-${randomUUID()}@example.test`;
      const password = `Okr-${randomUUID()}!`;
      const { user } = await checked(await admin!.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } }));
      users.push(user!.id);
      if (users.length === 2) session = (await checked(await contributor!.auth.signInWithPassword({ email, password }))).session!;
    }
    workspaceId = (await checked(await admin!.from("workspaces").insert({ name: "KR 负责人验证", created_by: users[0] }).select("id").single())).id;
    await checked(await admin!.from("workspace_members").insert({ workspace_id: workspaceId, user_id: users[1], role: "member" }));
    cycleId = (await checked(await admin!.from("okr_cycles").insert({ workspace_id: workspaceId, name: "验证周期", starts_on: "2026-01-01", ends_on: "2027-12-31", status: "active", created_by: users[0] }).select("id").single())).id;
    setId = (await checked(await admin!.from("okr_sets").insert({ workspace_id: workspaceId, cycle_id: cycleId, owner_id: users[0], published_at: new Date().toISOString(), published_version: 1 }).select("id").single())).id;
    const objective = await checked(await admin!.from("okr_objectives").insert({ workspace_id: workspaceId, set_id: setId, title: "夯实 Agent 底座", published_at: new Date().toISOString() }).select("id").single());
    const results = await checked(await admin!.from("okr_key_results").insert(["开放平台负责人协作", "其他成员的 KR"].map((title, position) => ({ workspace_id: workspaceId, objective_id: objective.id, title, position, weight: 50, published_at: new Date().toISOString() }))).select("id,position").order("position"));
    [keyResultId, otherKeyResultId] = results.map((r) => r.id);
    await checked(await admin!.from("okr_key_result_responsibles").insert({ key_result_id: keyResultId, workspace_id: workspaceId, user_id: users[1] }));
    route = `/workspaces/${workspaceId}/okr/${users[0]}/cycles/${cycleId}/key-results/${keyResultId}`;
  });
  test.afterAll(async () => {
    if (workspaceId) await admin!.from("workspaces").delete().eq("id", workspaceId);
    for (const id of users) await admin!.auth.admin.deleteUser(id);
  });
  test("Web and iPhone viewport can contribute; other KRs and offline remain read-only", async ({ page, context }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await restore(page);
    await verifyAndContribute(page, "Web");
    await page.screenshot({ path: "test-results/okr-responsible-web.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("tab", { name: "待办清单" }).click();
    await verifyAndContribute(page, "iPhone");
    await page.screenshot({ path: "test-results/okr-responsible-mobile.png" });
    await page.getByRole("tab", { name: "进展记录" }).click();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.getByLabel("记录进展", { exact: true })).toHaveCount(0);
    await page.getByRole("tab", { name: "待办清单" }).click();
    await expect(page.locator(".okr-task-composer input[placeholder]")).toBeDisabled();
    await expect(page.locator(".okr-linked-task")).toHaveCount(2);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.goto(route.replace(keyResultId, otherKeyResultId));
    await expect(page.locator(".okr-task-composer input[placeholder]")).toBeDisabled();
    await page.getByRole("tab", { name: "进展记录" }).click();
    await expect(page.getByLabel("记录进展", { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
  test("packaged macOS app uses the same contribution path and keeps sandbox enabled", async () => {
    test.skip(!process.env.ANTTODO_OKR_ELECTRON_PATH, "Requires a locally configured packaged executable");
    test.setTimeout(60_000);
    const profile = mkdtempSync(join(tmpdir(), "anttodo-okr-responsible-"));
    const app = await electron.launch({ executablePath: process.env.ANTTODO_OKR_ELECTRON_PATH, args: [`--user-data-dir=${profile}`], timeout: 20_000 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await page.evaluate(({ session, key, route }) => {
        localStorage.setItem(key, JSON.stringify(session));
        localStorage.setItem("anttodo:feature-modules", JSON.stringify({ okrEnabled: true }));
        location.hash = route;
      }, { session, key: authKey(), route });
      await page.reload();
      expect(await app.evaluate(({ app, BrowserWindow }) => ({ packaged: app.isPackaged, sandbox: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox, nodeIntegration: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().nodeIntegration }))).toEqual({ packaged: true, sandbox: true, nodeIntegration: false });
      await verifyAndContribute(page, "macOS");
      await page.screenshot({ path: "test-results/okr-responsible-macos.png" });
      await page.context().setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await page.getByRole("tab", { name: "进展记录" }).click();
      await expect(page.getByLabel("记录进展", { exact: true })).toHaveCount(0);
      await page.getByRole("tab", { name: "待办清单" }).click();
      await expect(page.locator(".okr-task-composer input[placeholder]")).toBeDisabled();
    } finally { await app.close(); rmSync(profile, { recursive: true, force: true }); }
  });
});
