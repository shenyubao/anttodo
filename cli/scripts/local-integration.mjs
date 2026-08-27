#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
const endpoint = `${local.FUNCTIONS_URL ?? `${local.API_URL}/functions/v1`}/cli-device-auth`;
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
let oauthClientId;
let functionProcess;
let stage = "setup";

function removeIntegrationEdgeRuntime() {
  try {
    execFileSync("docker", ["rm", "-f", "supabase_edge_runtime_anttodo"], { stdio: "ignore" });
  } catch {
    // The integration runtime is intentionally ephemeral and may not exist yet.
  }
}

try {
  stage = "create OAuth client";
  const { data: oauthClient, error: oauthClientError } = await admin.auth.admin.oauth.createClient({
    client_name: "AntTodo CLI Integration",
    client_uri: "http://127.0.0.1:5173",
    redirect_uris: [endpoint],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "email profile phone",
    token_endpoint_auth_method: "client_secret_basic",
  });
  if (oauthClientError || !oauthClient?.client_secret) throw oauthClientError ?? new Error("Unable to create OAuth client");
  oauthClientId = oauthClient.client_id;
  const edgeEnvironmentFile = join(stateDirectory, "edge.env");
  await writeFile(edgeEnvironmentFile, [
    `CLI_OAUTH_CLIENT_ID=${JSON.stringify(oauthClient.client_id)}`,
    `CLI_OAUTH_CLIENT_SECRET=${JSON.stringify(oauthClient.client_secret)}`,
    `CLI_OAUTH_PUBLIC_URL=${JSON.stringify(local.API_URL)}`,
    'PUBLIC_APP_URL="http://127.0.0.1:5173"',
    "",
  ].join("\n"), { mode: 0o600 });
  removeIntegrationEdgeRuntime();
  functionProcess = spawn("supabase", ["functions", "serve", "cli-device-auth", "--no-verify-jwt", "--env-file", edgeEnvironmentFile, "--workdir", repositoryRoot], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: '{"action":"init"}' })
      .then((response) => response.status === 426).catch(() => false);
    if (ready) break;
    if (attempt === 59) throw new Error("cli-device-auth did not start");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  stage = "create user";
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

  stage = "initialize device request";
  const login = runCli("auth", "login", "--no-wait", "--no-open");
  const deviceCode = login.device_code;
  const userCode = new URL(login.verification_url).searchParams.get("user_code");
  const inspected = await deviceRequest({ action: "inspect", userCode });
  stage = "authorize device request";
  const authorization = await deviceRequest({ action: "authorize", requestId: inspected.requestId, userCode, lifetime: "360" }, signedIn.session.access_token);
  stage = "open OAuth authorization endpoint";
  const authorizeResponse = await fetch(authorization.authorizationUrl, { redirect: "manual" });
  const consentLocation = authorizeResponse.headers.get("location");
  if (!consentLocation) throw new Error(`OAuth authorize returned HTTP ${authorizeResponse.status}: ${await authorizeResponse.text()}`);
  const consentUrl = new URL(consentLocation);
  const authorizationId = consentUrl.searchParams.get("authorization_id");
  if (!authorizationId) throw new Error("OAuth authorization did not reach the consent endpoint");
  stage = "get OAuth authorization details";
  const { data: details, error: detailsError } = await publicClient.auth.oauth.getAuthorizationDetails(authorizationId);
  if (detailsError || !details) throw detailsError ?? new Error("Unable to inspect OAuth authorization");
  let callback;
  if ("redirect_url" in details) {
    callback = details.redirect_url;
  } else {
    if (details.client.id !== oauthClient.client_id || details.scope !== "email profile phone") throw new Error("OAuth client or scopes changed");
    stage = "validate OAuth consent";
    await deviceRequest({ action: "validate_consent", authorizationId, clientId: details.client.id,
      requestId: inspected.requestId, nonce: authorization.consentNonce }, signedIn.session.access_token);
    stage = "approve OAuth consent";
    const { data: approved, error: approvalError } = await publicClient.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (approvalError || !approved) throw approvalError ?? new Error("Unable to approve OAuth authorization");
    callback = approved.redirect_url;
  }
  stage = "complete OAuth callback";
  const callbackResponse = await fetch(callback, { redirect: "manual" });
  if (callbackResponse.status !== 302 || !callbackResponse.headers.get("location")?.includes("oauth_result=approved")) {
    throw new Error("OAuth callback did not complete device authorization");
  }
  stage = "consume CLI credential";
  runCli("auth", "login", "--device-code", deviceCode);
  const verifiedStatus = runCli("auth", "status", "--verify");
  if (!verifiedStatus.verified || verifiedStatus.device_id !== inspected.requestId) throw new Error("CLI credential verification failed");

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
    commands: 28,
    deviceAuthorization: "approved-and-consumed",
    oauthTokenExchange: "verified",
  })}\n`);
} catch (cause) {
  throw new Error(`CLI integration failed during: ${stage}`, { cause });
} finally {
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  if (userId) await admin.auth.admin.deleteUser(userId);
  if (oauthClientId) await admin.auth.admin.oauth.deleteClient(oauthClientId);
  functionProcess?.kill("SIGTERM");
  removeIntegrationEdgeRuntime();
  await rm(stateDirectory, { recursive: true, force: true });
}
