#!/usr/bin/env node
/**
 * Finish production setup that Wrangler OAuth cannot do alone:
 * 1) Cloudflare DNS *.team.anttodo.com (proxied)
 * 2) Advanced certificate for *.team.anttodo.com
 * 3) Apply workspace_slug migration via Supabase Management API
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=... SUPABASE_ACCESS_TOKEN=... node scripts/finish-team-domain-deploy.mjs
 *
 * Cloudflare token needs: Zone.DNS Edit, Zone.SSL and Certificates Edit
 * Supabase token: Personal access token (sbp_...) with project access
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN?.trim();
const SB_TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const ZONE_NAME = "anttodo.com";
const PROJECT_REF = "pyykoomrgvynyjlbfdba";
const MIGRATION_VERSION = "20260801163702";
const MIGRATION_FILE = path.join(
  root,
  "supabase/migrations/20260801163702_workspace_slug.sql",
);

async function cf(method, pathname, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${CF_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(
      `Cloudflare ${method} ${pathname}: ${JSON.stringify(json.errors || json)}`,
    );
  }
  return json.result;
}

async function sbQuery(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SB_TOKEN}`,
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

async function ensureDns(zoneId) {
  const records = await cf(
    "GET",
    `/zones/${zoneId}/dns_records?name=*.team.${ZONE_NAME}&per_page=50`,
  );
  if (records.length) {
    console.log("DNS already present:", records[0].name, records[0].type);
    return;
  }
  const created = await cf("POST", `/zones/${zoneId}/dns_records`, {
    type: "AAAA",
    name: "*.team",
    content: "100::",
    proxied: true,
    comment: "AntTodo team SSO wildcard",
  });
  console.log("Created DNS:", created.name, created.type, "proxied=", created.proxied);
}

async function ensureCert(zoneId) {
  const packs = await cf(
    "GET",
    `/zones/${zoneId}/ssl/certificate_packs?status=all`,
  );
  const existing = packs.find(
    (pack) =>
      Array.isArray(pack.hosts) &&
      pack.hosts.some((host) => String(host).includes("team.anttodo.com")),
  );
  if (existing) {
    console.log("Certificate pack already present:", existing.id, existing.status);
    return;
  }
  try {
    const ordered = await cf("POST", `/zones/${zoneId}/ssl/certificate_packs/order`, {
      type: "advanced",
      hosts: ["*.team.anttodo.com", "team.anttodo.com"],
      validation_method: "txt",
      validity_days: 90,
      certificate_authority: "google",
      cloudflare_branding: false,
    });
    console.log("Ordered certificate pack:", ordered.id, ordered.status);
  } catch (error) {
    console.warn(
      "Could not order advanced certificate (ACM may be required):",
      error.message,
    );
  }
}

async function ensureMigration() {
  const columns = await sbQuery(`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'workspaces'
      and column_name = 'slug'
  `);
  const hasSlug = Array.isArray(columns) && columns.length > 0;
  if (hasSlug) {
    console.log("workspaces.slug already exists");
  } else {
    const sql = fs.readFileSync(MIGRATION_FILE, "utf8");
    await sbQuery(sql);
    console.log("Applied workspace_slug migration SQL");
  }

  const rows = await sbQuery(`
    select version
    from supabase_migrations.schema_migrations
    where version = '${MIGRATION_VERSION}'
  `);
  if (Array.isArray(rows) && rows.length > 0) {
    console.log("Migration version already recorded:", MIGRATION_VERSION);
    return;
  }
  await sbQuery(`
    insert into supabase_migrations.schema_migrations (version, name, statements)
    values ('${MIGRATION_VERSION}', 'workspace_slug', array[]::text[])
    on conflict do nothing
  `);
  console.log("Recorded migration version:", MIGRATION_VERSION);
}

async function main() {
  if (!CF_TOKEN) {
    throw new Error("Set CLOUDFLARE_API_TOKEN (Zone.DNS Edit + Zone.SSL Edit)");
  }
  if (!SB_TOKEN) {
    throw new Error("Set SUPABASE_ACCESS_TOKEN (sbp_...)");
  }

  const zones = await cf("GET", `/zones?name=${ZONE_NAME}`);
  const zone = zones[0];
  if (!zone) throw new Error(`Zone not found: ${ZONE_NAME}`);
  console.log("Zone:", zone.id, zone.name);

  await ensureDns(zone.id);
  await ensureCert(zone.id);
  await ensureMigration();
  console.log("Done.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
