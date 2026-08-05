#!/usr/bin/env node
/**
 * Push local Supabase migrations to the self-hosted production database over SSH.
 *
 * Requires ANTTODO_SUPABASE_SELFHOST_SSH (and optional
 * ANTTODO_SUPABASE_SELFHOST_DOCKER_DIR) in the environment or `.env.local`.
 * There is no Supabase Cloud / Management API fallback.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const selfHostSsh = readSetting("ANTTODO_SUPABASE_SELFHOST_SSH");
const selfHostDockerDir = readSetting(
  "ANTTODO_SUPABASE_SELFHOST_DOCKER_DIR",
) || "/home/ubuntu/projects/supabase/docker";

function readSetting(name) {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess) return fromProcess;

  const file = path.join(root, ".env.local");
  if (!fs.existsSync(file)) return "";
  const prefix = `${name}=`;
  const line = fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(prefix));
  if (!line) return "";
  const value = line.slice(prefix.length).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
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

function validateSelfHostConfig() {
  if (!selfHostSsh) {
    throw new Error(
      "Set ANTTODO_SUPABASE_SELFHOST_SSH in the environment or .env.local " +
        "(production migrations only target the self-hosted Supabase stack).",
    );
  }
  if (!/^[A-Za-z0-9_.@:-]+$/.test(selfHostSsh)) {
    throw new Error("ANTTODO_SUPABASE_SELFHOST_SSH contains unsafe characters");
  }
  if (!/^\/[A-Za-z0-9_./-]+$/.test(selfHostDockerDir)) {
    throw new Error(
      "ANTTODO_SUPABASE_SELFHOST_DOCKER_DIR must be an absolute path",
    );
  }
}

function runSelfHostPsql(flags, input) {
  validateSelfHostConfig();
  const remoteCommand =
    `cd ${selfHostDockerDir} && ` +
    "docker compose exec -T db psql -q -U postgres -d postgres -X " +
    flags.join(" ");
  return spawnSync("ssh", [selfHostSsh, remoteCommand], {
    cwd: root,
    input,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

function pushToSelfHost() {
  console.log(`Checking self-hosted migrations via SSH target ${selfHostSsh}…`);
  const list = runSelfHostPsql(
    ["--tuples-only", "--no-align", "--variable", "ON_ERROR_STOP=1"],
    "select version from supabase_migrations.schema_migrations order by version;\n",
  );
  if (list.error) throw list.error;
  if (list.status !== 0) {
    process.stderr.write(list.stderr ?? "");
    throw new Error(
      "Unable to read self-hosted migration history. Run the migration bootstrap first.",
    );
  }

  const remote = new Set(
    (list.stdout ?? "").split(/\r?\n/).map((value) => value.trim())
      .filter(Boolean),
  );
  const pending = migrationFiles().filter((item) => !remote.has(item.version));
  if (!pending.length) {
    console.log("Self-hosted database is up to date.");
    return;
  }

  for (const item of pending) {
    const escapedName = item.name.replace(/'/g, "''");
    const recordMigration = `
insert into supabase_migrations.schema_migrations
  (version, statements, name)
values ('${item.version}', array[]::text[], '${escapedName}');
`;
    console.log(`Applying ${item.version}_${item.name} to self-hosted…`);
    const result = runSelfHostPsql(
      ["--single-transaction", "--variable", "ON_ERROR_STOP=1"],
      `${item.sql.trim()}\n${recordMigration}`,
    );
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Failed to apply migration ${item.version}_${item.name}`);
    }
  }
  console.log(`Applied ${pending.length} migration(s) to self-hosted.`);
}

try {
  pushToSelfHost();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
