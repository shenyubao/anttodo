#!/usr/bin/env node
/**
 * Finish production Cloudflare setup that Wrangler OAuth cannot do alone:
 * 1) Cloudflare DNS *.team.anttodo.com (proxied)
 * 2) Advanced certificate for *.team.anttodo.com
 *
 * Database migrations belong on the self-hosted stack via `pnpm supabase:push`.
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=... node scripts/finish-team-domain-deploy.mjs
 *
 * Cloudflare token needs: Zone.DNS Edit, Zone.SSL and Certificates Edit
 */

const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN?.trim();
const ZONE_NAME = "anttodo.com";

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

async function main() {
  if (!CF_TOKEN) {
    throw new Error("Set CLOUDFLARE_API_TOKEN (Zone.DNS Edit + Zone.SSL Edit)");
  }

  const zones = await cf("GET", `/zones?name=${ZONE_NAME}`);
  const zone = zones[0];
  if (!zone) throw new Error(`Zone not found: ${ZONE_NAME}`);
  console.log("Zone:", zone.id, zone.name);

  await ensureDns(zone.id);
  await ensureCert(zone.id);
  console.log("Done.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
