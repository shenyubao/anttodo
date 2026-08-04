import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";

const statusOutput = execFileSync("supabase", ["status", "--workdir", ".", "-o", "env"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const local = Object.fromEntries(statusOutput.trim().split("\n").flatMap((line) => {
  const match = line.match(/^([A-Z0-9_]+)="(.*)"$/);
  return match ? [[match[1], match[2]]] : [];
}));
const endpoint = `${local.FUNCTIONS_URL}/cli-device-auth`;
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const publicClient = createClient(local.API_URL, local.PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
let session: Session;
let userId: string;

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
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const initialized = await deviceRequest({
    action: "init",
    deviceCodeHash: createHash("sha256").update(deviceCode).digest("hex"),
    publicKey: keys.publicKey.export({ format: "jwk" }),
    client: { name: "AntTodo CLI", version: "e2e", hostname: "playwright" },
  });
  return {
    ...initialized,
    deviceCode,
    userCode: new URL(initialized.verificationUrl).searchParams.get("user_code"),
  };
}

test.beforeAll(async () => {
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
});

test.beforeEach(async ({ page }) => {
  const storageKey = `sb-${new URL(local.API_URL).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: session });
});

test("restores login and approves a CLI request", async ({ page }) => {
  const request = await initiateDeviceRequest();
  expect(request.userCode).toMatch(/^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
  await page.goto(`/auth/cli?user_code=${request.userCode}`);
  await expect(page.getByRole("heading", { name: "授权 AntTodo CLI" })).toBeVisible();
  await expect(page.getByText("playwright", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "允许访问" }).click();
  await expect(page.getByRole("heading", { name: "授权已完成" })).toBeVisible();
  await expect.poll(async () => (await deviceRequest({
    action: "poll",
    requestId: request.requestId,
    deviceCode: request.deviceCode,
  })).status).toBe("approved");
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
