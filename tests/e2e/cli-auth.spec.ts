import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Route } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";

const statusOutput = execFileSync("supabase", ["status", "--workdir", ".", "-o", "env"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const local = Object.fromEntries(statusOutput.trim().split("\n").flatMap((line) => {
  const match = line.match(/^([A-Z0-9_]+)="(.*)"$/);
  return match ? [[match[1], match[2]]] : [];
}));
const endpoint = `${local.FUNCTIONS_URL ?? `${local.API_URL}/functions/v1`}/cli-device-auth`;
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const publicClient = createClient(local.API_URL, local.PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
test.use({ serviceWorkers: "block" });
let session: Session;
let userId: string;
let oauthClientId: string;
let functionProcess: ChildProcess;
let runtimeDirectory: string;

function removeEdgeRuntime() {
  try { execFileSync("docker", ["rm", "-f", "supabase_edge_runtime_anttodo"], { stdio: "ignore" }); } catch { /* optional */ }
}

async function deviceRequest(body: Record<string, unknown>, accessToken?: string) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: local.PUBLISHABLE_KEY,
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${body.action} failed: ${response.status} ${result.code ?? "unknown"}`);
  return result;
}

async function initiateDeviceRequest() {
  const deviceCode = randomBytes(32).toString("base64url");
  const initialized = await deviceRequest({
    action: "init",
    protocolVersion: 2,
    deviceCodeHash: createHash("sha256").update(deviceCode).digest("hex"),
    client: { name: "AntTodo CLI", version: "e2e", hostname: "playwright" },
  });
  return {
    ...initialized,
    deviceCode,
    userCode: new URL(initialized.verificationUrl).searchParams.get("user_code"),
  };
}

async function fulfillRedirectOnPreview(route: Route) {
  const response = await route.fetch({ maxRedirects: 0 });
  const headers = response.headers();
  if (headers.location) headers.location = headers.location.replace("http://127.0.0.1:5173", "http://127.0.0.1:4173");
  await route.fulfill({ status: response.status(), headers, body: await response.body() });
}

test.beforeAll(async () => {
  const { data: oauthClient, error: oauthError } = await admin.auth.admin.oauth.createClient({
    client_name: "AntTodo CLI Browser E2E",
    client_uri: "http://127.0.0.1:4173",
    redirect_uris: [endpoint],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "email profile phone",
    token_endpoint_auth_method: "client_secret_basic",
  });
  if (oauthError || !oauthClient?.client_secret) throw oauthError ?? new Error("Unable to create browser OAuth client");
  oauthClientId = oauthClient.client_id;
  runtimeDirectory = mkdtempSync(join(tmpdir(), "anttodo-cli-browser-"));
  const edgeEnvironmentFile = join(runtimeDirectory, "edge.env");
  writeFileSync(edgeEnvironmentFile, [
    `CLI_OAUTH_CLIENT_ID=${JSON.stringify(oauthClient.client_id)}`,
    `CLI_OAUTH_CLIENT_SECRET=${JSON.stringify(oauthClient.client_secret)}`,
    `CLI_OAUTH_PUBLIC_URL=${JSON.stringify(local.API_URL)}`,
    'PUBLIC_APP_URL="http://127.0.0.1:5173"',
    "",
  ].join("\n"), { mode: 0o600 });
  removeEdgeRuntime();
  functionProcess = spawn("supabase", ["functions", "serve", "cli-device-auth", "--no-verify-jwt", "--env-file", edgeEnvironmentFile, "--workdir", "."], { stdio: "ignore" });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: '{"action":"init"}' })
      .then((response) => response.status === 426).catch(() => false);
    if (ready) break;
    if (attempt === 59) throw new Error("cli-device-auth did not start");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const suffix = randomUUID();
  const email = `cli-auth-e2e-${suffix}@example.test`;
  const password = `Cli-${suffix}-Password!`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "CLI Auth E2E" },
  });
  if (createError || !created.user) throw createError ?? new Error("Unable to create browser test user");
  userId = created.user.id;
  const { data, error } = await publicClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error("Unable to sign in browser test user");
  session = data.session;
});

test.afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
  if (oauthClientId) await admin.auth.admin.oauth.deleteClient(oauthClientId);
  functionProcess?.kill("SIGTERM");
  removeEdgeRuntime();
  if (runtimeDirectory) rmSync(runtimeDirectory, { recursive: true, force: true });
});

test.beforeEach(async ({ page, context }) => {
  await context.route(`${local.API_URL}/auth/v1/oauth/authorize?**`, fulfillRedirectOnPreview);
  await context.route(`${local.API_URL}/functions/v1/cli-device-auth**`, async (route) => {
    if (route.request().method() === "GET") {
      await fulfillRedirectOnPreview(route);
      return;
    }
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  const storageKey = `sb-${new URL(local.API_URL).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: session });
});

test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: "ignoreErrors" });
});

test("restores login and approves a CLI request", async ({ page }) => {
  const request = await initiateDeviceRequest();
  expect(request.userCode).toMatch(/^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
  await page.goto(`/auth/cli?user_code=${request.userCode}`);
  await expect(page.getByRole("heading", { name: "授权 AntTodo CLI" })).toBeVisible();
  await expect(page.getByText("playwright", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "360 天" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "7 天" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "90 天" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "无限" })).toBeVisible();
  await page.getByRole("button", { name: "允许访问" }).click();
  await expect(page.getByRole("heading", { name: "授权已完成" })).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await deviceRequest({
    action: "poll",
    requestId: request.requestId,
    deviceCode: request.deviceCode,
  })).status).toBe("approved");
});

test("shows the unlimited authorization warning", async ({ page }) => {
  const request = await initiateDeviceRequest();
  await page.goto(`/auth/cli?user_code=${request.userCode}`);
  await page.getByRole("radio", { name: "无限" }).check();
  await expect(page.getByText(/不会自动到期/)).toBeVisible();
  await page.getByRole("button", { name: "拒绝" }).click();
  await expect(page.getByRole("heading", { name: "已拒绝授权" })).toBeVisible();
});

test("denies a CLI request", async ({ page }) => {
  const request = await initiateDeviceRequest();
  await page.goto(`/auth/cli?user_code=${request.userCode}`);
  await page.getByRole("button", { name: "拒绝" }).click();
  await expect(page.getByRole("heading", { name: "已拒绝授权" })).toBeVisible();
  await expect.poll(async () => (await deviceRequest({
    action: "poll",
    requestId: request.requestId,
    deviceCode: request.deviceCode,
  })).status).toBe("denied");
});

test("shows expired-link handling on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/auth/cli?user_code=EXPIRED1");
  await expect(page.getByRole("heading", { name: "无法完成授权" })).toBeVisible();
  await expect(page.getByText(/不存在或已经过期/)).toBeVisible();
  await expect(page.locator(".cli-auth-card")).toHaveCSS("width", "342px");
});
