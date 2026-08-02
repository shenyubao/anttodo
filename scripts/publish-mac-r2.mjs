#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "release");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
// Keep download object keys ASCII-stable; UI display name may be localized.
const artifactProductName = "AntTodo";
const bucket = process.env.R2_BUCKET?.trim();
const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
const prefix = (process.env.R2_PREFIX ?? "").trim().replace(/^\/+|\/+$/g, "");
const dryRun = process.argv.includes("--dry-run");
const expectedVersionArg = process.argv.find((arg) => arg.startsWith("--expected-version="));
const expectedVersion = expectedVersionArg?.slice("--expected-version=".length).replace(/^v/, "");

const targets = [
  { arch: "arm64", format: "dmg", contentType: "application/x-apple-diskimage" },
  { arch: "arm64", format: "zip", contentType: "application/zip" },
  { arch: "x64", format: "dmg", contentType: "application/x-apple-diskimage" },
  { arch: "x64", format: "zip", contentType: "application/zip" },
];

function fail(message) {
  console.error(`macOS R2 publish failed: ${message}`);
  process.exit(1);
}

function objectKey(...segments) {
  return [prefix, ...segments].filter(Boolean).join("/");
}

function publicUrl(key) {
  return `${publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function upload(file, key, { contentType, cacheControl, downloadName }) {
  const destination = `${bucket}/${key}`;
  const args = [
    "exec",
    "wrangler",
    "r2",
    "object",
    "put",
    destination,
    "--file",
    file,
    "--remote",
    "--content-type",
    contentType,
    "--cache-control",
    cacheControl,
    "--content-disposition",
    `attachment; filename=\"${downloadName}\"`,
  ];

  console.log(`${dryRun ? "Would upload" : "Uploading"} ${destination}`);
  if (dryRun) return;

  const result = spawnSync("pnpm", args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail(`Wrangler exited with status ${result.status}`);
}

if (!bucket) fail("R2_BUCKET is required");
if (bucket.includes("/")) fail("R2_BUCKET must be a bucket name, not a path");
if (!publicBaseUrl) fail("R2_PUBLIC_BASE_URL is required");
try {
  const parsed = new URL(publicBaseUrl);
  if (parsed.protocol !== "https:") throw new Error("not HTTPS");
} catch {
  fail("R2_PUBLIC_BASE_URL must be an HTTPS URL");
}
if (expectedVersion && expectedVersion !== version) {
  fail(`tag version ${expectedVersion} does not match package.json version ${version}`);
}

const artifacts = targets.map(({ arch, format, contentType }) => {
  const fileName = `${artifactProductName}-${version}-${arch}.${format}`;
  const file = path.join(releaseDir, fileName);
  if (!existsSync(file)) fail(`missing artifact ${path.relative(root, file)}`);
  return {
    arch,
    format,
    contentType,
    file,
    fileName,
    versionedKey: objectKey("macos", `v${version}`, fileName),
    latestKey: objectKey("macos", `${artifactProductName}-${arch}-latest.${format}`),
  };
});

// Publish immutable objects first. The stable aliases and manifest only move after
// every versioned artifact is safely stored.
for (const artifact of artifacts) {
  upload(artifact.file, artifact.versionedKey, {
    contentType: artifact.contentType,
    cacheControl: "public, max-age=31536000, immutable",
    downloadName: artifact.fileName,
  });
}

for (const artifact of artifacts) {
  upload(artifact.file, artifact.latestKey, {
    contentType: artifact.contentType,
    cacheControl: "public, max-age=0, must-revalidate",
    downloadName: artifact.fileName,
  });
}

const manifest = {
  schemaVersion: 1,
  product: packageJson.build.productName,
  version,
  publishedAt: new Date().toISOString(),
  downloads: {
    macos: Object.fromEntries(
      ["arm64", "x64"].map((arch) => [
        arch,
        Object.fromEntries(
          artifacts
            .filter((artifact) => artifact.arch === arch)
            .map((artifact) => [
              artifact.format,
              {
                url: publicUrl(artifact.latestKey),
                versionedUrl: publicUrl(artifact.versionedKey),
                fileName: artifact.fileName,
                size: statSync(artifact.file).size,
                sha256: sha256(artifact.file),
              },
            ]),
        ),
      ]),
    ),
  },
};

const manifestFile = path.join(releaseDir, "macos-latest.json");
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
const manifestKey = objectKey("macos", "latest.json");
upload(manifestFile, manifestKey, {
  contentType: "application/json; charset=utf-8",
  cacheControl: "public, max-age=0, must-revalidate",
  downloadName: "macos-latest.json",
});

console.log("\nStable download URLs:");
for (const artifact of artifacts) console.log(`${artifact.arch} ${artifact.format}: ${publicUrl(artifact.latestKey)}`);
console.log(`manifest: ${publicUrl(manifestKey)}`);
