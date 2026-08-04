#!/usr/bin/env node
/**
 * Push local Supabase migrations with a Fake-IP / IPv6-safe fallback path.
 *
 * 1) Prefer `supabase db push` (linked project).
 * 2) On TLS / DNS failure, retry via the IPv4 pooler when SUPABASE_DB_PASSWORD is set.
 * 3) Otherwise apply pending migrations over the HTTPS Management API when
 *    SUPABASE_ACCESS_TOKEN is set.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const workdir = root;
const projectRef = readProjectRef();
const poolerHost = `aws-1-ap-northeast-2.pooler.supabase.com`;

function readProjectRef() {
  const file = path.join(root, "supabase/.temp/project-ref");
  if (!fs.existsSync(file)) return "pyykoomrgvynyjlbfdba";
  return fs.readFileSync(file, "utf8").trim() || "pyykoomrgvynyjlbfdba";
}

function runSupabase(args, env = process.env) {
  const result = spawnSync("supabase", args, {
    cwd: root,
    env,
    encoding: "utf8",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function isConnectivityFailure(output) {
  return /tls error|hostname resolving error|failed to connect to postgres|no route to host|i\/o timeout|EOF/i
    .test(output);
}

function migrationFiles() {
  const dir = path.join(root, "supabase/migrations");
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => {
      const version = name.slice(0, 14);
      const rest = name.slice(15).replace(/\.sql$/, "");
      return {
        version,
        name: rest,
        file: path.join(dir, name),
        sql: fs.readFileSync(path.join(dir, name), "utf8"),
      };
    })
    .sort((a, b) => a.version.localeCompare(b.version));
}

async function sbQuery(token, query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase query failed (${res.status}): ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function pushViaManagementApi(token) {
  console.log("Falling back to Supabase Management API over HTTPS…");
  const remoteRows = await sbQuery(
    token,
    "select version from supabase_migrations.schema_migrations order by version",
  );
  const remote = new Set(
    (Array.isArray(remoteRows) ? remoteRows : [])
      .map((row) => row?.version)
      .filter(Boolean),
  );
  const pending = migrationFiles().filter((item) => !remote.has(item.version));
  if (!pending.length) {
    console.log("Remote database is up to date.");
    return;
  }
  for (const item of pending) {
    console.log(`Applying ${item.version}_${item.name} via Management API…`);
    await sbQuery(token, item.sql);
    const escapedName = item.name.replace(/'/g, "''");
    await sbQuery(
      token,
      `insert into supabase_migrations.schema_migrations (version, name, statements)
       values ('${item.version}', '${escapedName}', array[]::text[])
       on conflict do nothing`,
    );
  }
  console.log(`Applied ${pending.length} migration(s) via Management API.`);
}

function pushViaPooler(password) {
  const user = `postgres.${projectRef}`;
  const encodedPassword = encodeURIComponent(password);
  // Session mode on 5432 keeps migration transactional semantics closer to direct.
  const dbUrl =
    `postgresql://${user}:${encodedPassword}@${poolerHost}:5432/postgres`;
  console.log(`Retrying via IPv4 pooler host ${poolerHost}…`);
  return runSupabase([
    "db",
    "push",
    "--yes",
    "--workdir",
    workdir,
    "--db-url",
    dbUrl,
  ]);
}

function printRecoveryHelp() {
  console.error(`
supabase db push failed because Postgres TLS cannot traverse the current proxy Fake-IP path,
and db.<ref>.supabase.co is IPv6-only while this machine has no IPv6 route.

Fix one of:
  1. Clash Verge: keep Merge.yaml DIRECT + fake-ip-filter for +.supabase.co / +.pooler.supabase.com,
     then reload the profile and retry.
  2. Set SUPABASE_DB_PASSWORD and retry (uses the IPv4 pooler).
  3. Set SUPABASE_ACCESS_TOKEN (sbp_...) and retry (applies SQL over HTTPS Management API).
`);
}

const initial = runSupabase(["db", "push", "--yes", "--workdir", workdir]);
process.stdout.write(initial.stdout);
process.stderr.write(initial.stderr);
if (initial.error) {
  console.error(initial.error.message);
  process.exit(1);
}
if (initial.status === 0) process.exit(0);

const combined = `${initial.stdout}\n${initial.stderr}`;
if (!isConnectivityFailure(combined)) {
  process.exit(initial.status);
}

const dbPassword = process.env.SUPABASE_DB_PASSWORD?.trim();
if (dbPassword) {
  const pooled = pushViaPooler(dbPassword);
  process.stdout.write(pooled.stdout);
  process.stderr.write(pooled.stderr);
  if (pooled.status === 0) process.exit(0);
}

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (token) {
  try {
    await pushViaManagementApi(token);
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }
}

printRecoveryHelp();
process.exit(initial.status || 1);
