import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type Session } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

// Explicitly opt in with a Web build pointing at this repository's local stack.
const enabled = process.env.ANTTODO_LOCAL_USER_GROUPS_E2E === "1";
const local = enabled ? JSON.parse(execFileSync("pnpm", ["dlx", "supabase", "status", "-o", "json"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
})) as Record<string, string> : {};
const admin = enabled ? createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } }) : null;
const owner = enabled ? createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth: { persistSession: false } }) : null;
const users: string[] = [];
let workspaceId: string;
let session: Session;
async function checked<T>(result: { data: T; error: { message: string } | null }): Promise<T> {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

test.describe("local user group submissions", () => {
  test.skip(!enabled, "Set ANTTODO_LOCAL_USER_GROUPS_E2E=1 and build against local Supabase");
  test.beforeAll(async () => {
    for (const name of ["直连管理者", "直连成员"]) {
      const email = `groups-${randomUUID()}@example.test`;
      const password = `Groups-${randomUUID()}!`;
      const { user } = await checked(await admin!.auth.admin.createUser({ email, password, email_confirm: true,
        user_metadata: { display_name: name } }));
      users.push(user!.id);
      if (users.length === 1) session = (await checked(await owner!.auth.signInWithPassword({ email, password }))).session!;
    }
    workspaceId = (await checked(await owner!.from("workspaces").insert({ name: "用户组异步验证", created_by: users[0] }).select("id").single())).id;
    await checked(await admin!.from("workspace_members").insert({ workspace_id: workspaceId, user_id: users[1], role: "member" }));
  });
  test.afterAll(async () => {
    if (workspaceId) await admin!.from("workspaces").delete().eq("id", workspaceId);
    for (const user of users) await admin!.auth.admin.deleteUser(user);
  });

  test("shows pending immediately, resumes partial writes without duplicates, refreshes remotely and disables offline writes", async ({ page, context }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let realtimeReady = false;
    page.on("websocket", (socket) => socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") return;
      const parsed = JSON.parse(payload);
      const frame = Array.isArray(parsed) ? { event: parsed[3], payload: parsed[4] } : parsed;
      if (frame.event === "phx_reply" && frame.payload?.response?.postgres_changes?.length) realtimeReady = true;
      if (frame.event === "phx_reply" && frame.payload?.status === "error") console.warn("Realtime subscription rejected", frame.payload.response);
    }));
    await page.addInitScript(({ session, key }) => localStorage.setItem(key, JSON.stringify(session)),
      { session, key: `sb-${new URL(local.API_URL).hostname.split(".")[0]}-auth-token` });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/rest/v1/user_groups*", async (route) => {
      if (route.request().method() === "POST") await gate;
      await route.continue();
    });
    let failMembers = true;
    await page.route("**/rest/v1/user_group_members*", async (route) => {
      if (failMembers && route.request().method() === "POST") {
        await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "42501", message: "模拟成员写入失败" }) });
      } else await route.continue();
    });
    await page.goto(`/#/workspaces/${workspaceId}/settings/user-groups`);
    await page.getByRole("button", { name: "新建用户组", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "新建用户组", exact: true });
    await dialog.getByRole("textbox", { name: "名称" }).fill("直连异步验证组");
    await dialog.locator("label").filter({ hasText: "直连成员" }).getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const row = page.locator(".user-group-row").filter({ hasText: "直连异步验证组" });
    await expect(row).toContainText("提交中…");
    await expect(row.getByRole("button", { name: "编辑", exact: true })).toBeDisabled();
    const id = await row.getAttribute("data-group-id");
    await page.screenshot({ path: "test-results/user-groups-local-pending.png" });
    release();
    await expect(row).toContainText("部分已保存");
    await page.screenshot({ path: "test-results/user-groups-local-partial.png" });
    expect((await checked(await admin!.from("user_groups").select("id").eq("workspace_id", workspaceId)))).toEqual([{ id }]);
    failMembers = false;
    await row.getByRole("button", { name: "重试", exact: true }).click();
    await expect(row).not.toHaveAttribute("aria-busy", "true");
    await expect(row.getByRole("button", { name: "删除", exact: true })).toBeEnabled();
    await expect(row).toContainText("1 位成员");
    expect(await checked(await admin!.from("user_groups").select("id").eq("workspace_id", workspaceId))).toEqual([{ id }]);
    expect(await checked(await admin!.from("user_group_members").select("user_id").eq("group_id", id!))).toEqual([{ user_id: users[1] }]);
    await expect.poll(() => realtimeReady, { timeout: 15_000 }).toBe(true);
    await checked(await admin!.from("user_groups").update({ name: "远端更新验证组" }).eq("id", id!));
    await expect(page.locator(".user-group-row").filter({ hasText: "远端更新验证组" })).toHaveCount(1);
    // IndexedDB writes are throttled; verify the confirmed snapshot before reloading.
    await expect.poll(() => page.evaluate(() => new Promise<string>((resolve, reject) => {
      const open = indexedDB.open("keyval-store");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const read = db.transaction("keyval").objectStore("keyval").get("ANTTODO_QUERY_CACHE");
        read.onerror = () => { db.close(); reject(read.error); };
        read.onsuccess = () => { db.close(); resolve(String(read.result ?? "")); };
      };
    }))).toContain("远端更新验证组");
    await context.setOffline(true);
    await expect(page.getByRole("button", { name: "新建用户组", exact: true })).toBeDisabled();
    await context.setOffline(false);
    await page.reload();
    const remote = page.locator(".user-group-row").filter({ hasText: "远端更新验证组" });
    await expect(remote).toHaveCount(1);
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    let failRefresh = true;
    await page.route("**/rest/v1/workspace_members*", async (route) => {
      await refreshGate;
      if (failRefresh) await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "模拟后台刷新失败" }) });
      else await route.continue();
    });
    await remote.getByRole("button", { name: "编辑", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "编辑用户组", exact: true });
    await edit.getByRole("textbox", { name: "名称" }).fill("直连编辑验证组");
    await edit.locator("label").filter({ hasText: "直连成员" }).getByRole("checkbox").uncheck();
    await edit.getByRole("button", { name: "保存", exact: true }).click();
    const updated = page.locator(".user-group-row").filter({ hasText: "直连编辑验证组" });
    try {
      await expect(updated.getByRole("button", { name: "删除", exact: true })).toBeEnabled();
      await expect(updated).toContainText("0 位成员");
      await expect(page.getByText("正在核对用户组权限…", { exact: true })).toBeVisible();
    } finally { releaseRefresh(); }
    await expect(page.getByText("权限刷新失败，相关写入暂不可用。", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(updated).toHaveCount(1);
    await expect(updated).not.toContainText("提交失败");
    failRefresh = false;
    await page.getByRole("button", { name: "重新核对", exact: true }).click();
    await expect(page.locator(".user-group-permission-status")).toHaveCount(0);
    expect(await checked(await admin!.from("user_group_members").select("user_id").eq("group_id", id!))).toEqual([]);
    page.once("dialog", (confirmation) => confirmation.accept());
    await updated.getByRole("button", { name: "删除", exact: true }).click();
    await expect(updated).toHaveCount(0);
    expect(await checked(await admin!.from("user_groups").select("id").eq("workspace_id", workspaceId))).toEqual([]);
    expect(errors).toEqual([]);
  });
});
