#!/usr/bin/env node
import {
  createCipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomUUID,
} from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(cliRoot, "..");
const stateDirectory = await mkdtemp(join(tmpdir(), "anttodo-cli-integration-"));
const statusOutput = execFileSync("supabase", ["status", "--workdir", repositoryRoot, "-o", "env"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const local = Object.fromEntries(statusOutput.trim().split("\n").flatMap((line) => {
  const match = line.match(/^([A-Z0-9_]+)="(.*)"$/);
  return match ? [[match[1], match[2]]] : [];
}));
const endpoint = `${local.FUNCTIONS_URL}/cli-device-auth`;
const cliEnvironment = {
  ...process.env,
  ANTTODO_STATE_DIR: stateDirectory,
  ANTTODO_SUPABASE_URL: local.API_URL,
  ANTTODO_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
  ANTTODO_APP_URL: "http://127.0.0.1:5173",
  ANTTODO_DEVICE_AUTH_URL: endpoint,
};
Object.assign(process.env, {
  ANTTODO_STATE_DIR: stateDirectory,
  ANTTODO_SUPABASE_URL: local.API_URL,
  ANTTODO_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
  ANTTODO_APP_URL: "http://127.0.0.1:5173",
  ANTTODO_DEVICE_AUTH_URL: endpoint,
});

function runCli(...arguments_) {
  const stdout = execFileSync(process.execPath, [join(cliRoot, "dist/index.js"), ...arguments_], {
    cwd: repositoryRoot,
    env: cliEnvironment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const envelope = JSON.parse(stdout);
  if (!envelope.ok) throw new Error(`CLI command failed: ${arguments_.join(" ")}`);
  return envelope.data;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function encryptSession(publicJwk, session, requestId) {
  const ephemeral = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const shared = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: createPublicKey({ key: publicJwk, format: "jwk" }),
  });
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = Buffer.from(hkdfSync("sha256", shared, salt, Buffer.from("anttodo-cli-device-auth-v1"), 32));
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`anttodo-cli-device-auth-v1:${requestId}:${session.user.id}`));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      userId: session.user.id,
    })),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    ephemeralPublicKey: ephemeral.publicKey.export({ format: "jwk" }),
    salt: base64Url(salt),
    iv: base64Url(iv),
    ciphertext: base64Url(ciphertext),
  };
}

async function deviceRequest(body, accessToken) {
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
  if (!response.ok) throw new Error(`Device authorization ${body.action} failed (${response.status}): ${result.code ?? "unknown"}`);
  return result;
}

const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const publicClient = createClient(local.API_URL, local.PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const suffix = randomUUID();
const email = `cli-integration-${suffix}@example.test`;
const password = `Cli-${suffix}-Password!`;
let userId;
let workspaceId;

try {
  const health = await deviceRequest({ action: "unknown" }).catch((error) => {
    if (String(error).includes("(404)")) {
      throw new Error("Run `supabase functions serve cli-device-auth --no-verify-jwt --workdir .` first");
    }
    return null;
  });
  void health;

  const { data: created, error: createUserError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "CLI Integration" },
  });
  if (createUserError || !created.user) throw createUserError ?? new Error("Unable to create integration user");
  userId = created.user.id;

  const { data: signedIn, error: signInError } = await publicClient.auth.signInWithPassword({ email, password });
  if (signInError || !signedIn.session) throw signInError ?? new Error("Unable to sign in integration user");

  const login = runCli("auth", "login", "--no-wait", "--no-open");
  const deviceCode = login.device_code;
  const userCode = new URL(login.verification_url).searchParams.get("user_code");
  const pending = JSON.parse(await readFile(join(stateDirectory, "pending-authorizations.json"), "utf8"))[deviceCode];
  const inspected = await deviceRequest({ action: "inspect", userCode });
  const encryptedSession = encryptSession(inspected.publicKey, signedIn.session, inspected.requestId);
  await deviceRequest({
    action: "approve",
    requestId: inspected.requestId,
    userCode,
    encryptedSession,
  }, signedIn.session.access_token);
  runCli("auth", "login", "--device-code", deviceCode);
  runCli("auth", "status", "--verify");
  const { createClientContext } = await import("../dist/client.js");
  const cliClientContext = await createClientContext();
  const { data: refreshed, error: refreshError } = await cliClientContext.client.auth.refreshSession();
  if (refreshError || !refreshed.session) throw refreshError ?? new Error("CLI token refresh failed");
  if (pending.requestId !== inspected.requestId) throw new Error("Device request identity changed");

  const { data: workspace, error: workspaceError } = await admin.from("workspaces").insert({
    name: "CLI Integration",
    slug: `cli-${suffix}`,
    created_by: userId,
  }).select("id, slug").single();
  if (workspaceError || !workspace) throw workspaceError ?? new Error("Unable to create workspace");
  workspaceId = workspace.id;
  runCli("workspace", "list");
  runCli("workspace", "use", workspace.slug);
  const tag = runCli("tag", "create", "--name", "CLI tag");
  runCli("tag", "list");
  runCli("tag", "get", tag.id);
  const task = runCli(
    "task", "create", "--title", "CLI task", "--description", "integration",
    "--tag", tag.id, "--priority", "medium", "--assignee", userId,
    "--due-time", "2026-08-04T09:30:00+08:00", "--timezone", "Asia/Shanghai",
  );
  runCli("task", "list", "--status", "open", "--priority", "medium", "--assignee", userId, "--tag", tag.id, "--limit", "10", "--offset", "0");
  runCli("task", "get", task.id);
  runCli("task", "assign", task.id, "--clear");
  runCli("task", "assign", task.id, "--user", userId);
  runCli("task", "set-priority", task.id, "high");
  runCli("task", "set-duetime", task.id, "2026-08-05T10:00:00+08:00", "--timezone", "Asia/Shanghai");
  runCli("task", "set-duetime", task.id, "--clear");

  const pomodoro = runCli(
    "pomodoro",
    "--started-at", "2026-08-04T09:00:00+08:00",
    "--ended-at", "2026-08-04T09:25:00+08:00",
    "--planned-seconds", "1500",
    "--task", task.id,
    "--notes", "CLI pomodoro",
  );
  if (pomodoro.mode !== "pomodoro" || pomodoro.kind !== "focus"
    || pomodoro.planned_seconds !== 1500 || pomodoro.elapsed_seconds !== 1500
    || pomodoro.task_id !== task.id || pomodoro.notes !== "CLI pomodoro") {
    throw new Error("CLI pomodoro session did not match the requested recording");
  }
  const stopwatch = runCli(
    "stopwatch",
    "--started-at", "2026-08-04T09:30:00+08:00",
    "--ended-at", "2026-08-04T09:40:00+08:00",
  );
  if (stopwatch.mode !== "stopwatch" || stopwatch.kind !== "focus"
    || stopwatch.planned_seconds !== 600 || stopwatch.elapsed_seconds !== 600
    || stopwatch.task_id !== null || stopwatch.notes !== null) {
    throw new Error("CLI stopwatch session did not match the requested recording");
  }

  const subtask = runCli("subtask", "create", "--task", task.id, "--title", "CLI subtask");
  runCli("subtask", "list", "--task", task.id);
  runCli("subtask", "get", subtask.id);
  runCli("subtask", "set-duetime", subtask.id, "2026-08-05T11:00:00+08:00");
  runCli("subtask", "set-duetime", subtask.id, "--clear");
  runCli("subtask", "delete", subtask.id, "--yes");

  const note = runCli("note", "create", "--title", "CLI note", "--description", "integration", "--tag", tag.id);
  runCli("note", "list");
  runCli("note", "get", note.id);
  runCli("note", "delete", note.id);
  runCli("user", "list");
  runCli("task", "delete", task.id);
  runCli("task", "list", "--trash");
  runCli("tag", "delete", tag.id, "--yes");
  runCli("auth", "logout");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    commands: 34,
    deviceAuthorization: "approved-and-consumed",
    tokenRefresh: "verified",
  })}\n`);
} finally {
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  if (userId) await admin.auth.admin.deleteUser(userId);
  await rm(stateDirectory, { recursive: true, force: true });
}
