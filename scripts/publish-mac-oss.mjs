#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnvFiles } from "./load-local-env.mjs";

loadLocalEnvFiles();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "release");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
// Keep download object keys ASCII-stable; UI display name may be localized.
const artifactProductName = "AntTodo";
const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID?.trim();
const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET?.trim();
const bucket = process.env.OSS_BUCKET?.trim();
const regionRaw = process.env.OSS_REGION?.trim();
const endpointRaw = process.env.OSS_ENDPOINT?.trim();
const prefix = (process.env.OSS_PREFIX ?? "release").trim().replace(/^\/+|\/+$/g, "");
const dryRun = process.argv.includes("--dry-run");
const expectedVersionArg = process.argv.find((arg) => arg.startsWith("--expected-version="));
const expectedVersion = expectedVersionArg?.slice("--expected-version=".length).replace(/^v/, "");
const versionArg = process.argv.find((arg) => arg.startsWith("--version="));
const versionOverride = versionArg?.slice("--version=".length).replace(/^v/, "");
const publishVersionFile = path.join(releaseDir, "macos-publish-version");
const heartbeatMs = 10_000;
const multipartThresholdBytes = 8 * 1024 * 1024;
const ossTimeoutMs = 10 * 60 * 1000;

function resolvePublishVersion() {
  if (versionOverride) return versionOverride;
  if (existsSync(publishVersionFile)) {
    const stamped = readFileSync(publishVersionFile, "utf8").trim().replace(/^v/, "");
    if (stamped) return stamped;
  }
  return packageJson.version;
}

const version = resolvePublishVersion();

// Public downloads are DMG-only; ZIP artifacts from electron-builder stay local/CI.
const targets = [
  { arch: "arm64", format: "dmg", contentType: "application/x-apple-diskimage" },
  { arch: "x64", format: "dmg", contentType: "application/x-apple-diskimage" },
];

function fail(message) {
  console.error(`macOS OSS publish failed: ${message}`);
  process.exit(1);
}

function normalizeRegion(region) {
  if (!region) return undefined;
  return region.startsWith("oss-") ? region : `oss-${region}`;
}

function normalizeEndpoint(endpoint) {
  return endpoint?.replace(/^https?:\/\//, "").replace(/\/+$/, "") || undefined;
}

function objectKey(...segments) {
  return [prefix, ...segments].filter(Boolean).join("/");
}

function resolvePublicBaseUrl() {
  const configured = process.env.OSS_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (configured) {
    return configured.replace(new RegExp(`/${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "");
  }
  const region = normalizeRegion(regionRaw);
  const endpoint = normalizeEndpoint(endpointRaw) ?? (region ? `${region}.aliyuncs.com` : undefined);
  if (!bucket || !endpoint) return null;
  return `https://${bucket}.${endpoint}`;
}

function publicUrl(key) {
  return `${publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === units.at(-1)) {
      return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
    }
    value /= 1024;
  }
  return `${bytes} B`;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

async function upload(client, file, key, { contentType, cacheControl, downloadName, step, total }) {
  const byteSize = statSync(file).size;
  const size = formatBytes(byteSize);
  const label = `[${step}/${total}]`;
  console.log(`${label} ${dryRun ? "Would upload" : "Uploading"} ${bucket}/${key} (${size})`);
  if (dryRun) return;

  const startedAt = Date.now();
  let lastProgressLog = 0;
  const heartbeat = setInterval(() => {
    console.log(
      `  …仍在上传（已用时 ${formatDuration(Date.now() - startedAt)}；大文件可能需要几分钟）`,
    );
  }, heartbeatMs);

  const headers = {
    "Cache-Control": cacheControl,
    "Content-Disposition": `attachment; filename="${downloadName}"`,
  };

  try {
    if (byteSize >= multipartThresholdBytes) {
      await client.multipartUpload(key, file, {
        timeout: ossTimeoutMs,
        parallel: 4,
        partSize: 8 * 1024 * 1024,
        mime: contentType,
        headers,
        progress(percentage) {
          const now = Date.now();
          if (percentage >= 1 || now - lastProgressLog >= heartbeatMs) {
            lastProgressLog = now;
            console.log(`  …进度 ${Math.floor(percentage * 100)}%`);
          }
        },
      });
    } else {
      await client.put(key, file, {
        timeout: ossTimeoutMs,
        headers: {
          ...headers,
          "Content-Type": contentType,
        },
      });
    }
    console.log(`${label} Done ${bucket}/${key} in ${formatDuration(Date.now() - startedAt)}`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    clearInterval(heartbeat);
  }
}

const publicBaseUrl = resolvePublicBaseUrl();
const region = normalizeRegion(regionRaw);
const endpoint = normalizeEndpoint(endpointRaw);

if (!bucket) fail("OSS_BUCKET is required");
if (bucket.includes("/")) fail("OSS_BUCKET must be a bucket name, not a path");
if (!publicBaseUrl) fail("OSS_PUBLIC_BASE_URL is required (or OSS_REGION/OSS_ENDPOINT with OSS_BUCKET)");
try {
  const parsed = new URL(publicBaseUrl);
  if (parsed.protocol !== "https:") throw new Error("not HTTPS");
} catch {
  fail("OSS_PUBLIC_BASE_URL must be an HTTPS URL");
}
if (!dryRun) {
  if (!accessKeyId) fail("ALIYUN_ACCESS_KEY_ID is required");
  if (!accessKeySecret) fail("ALIYUN_ACCESS_KEY_SECRET is required");
  if (!region && !endpoint) fail("OSS_REGION or OSS_ENDPOINT is required");
}
if (expectedVersion && expectedVersion !== version) {
  fail(`tag version ${expectedVersion} does not match publish version ${version}`);
}
if (version !== packageJson.version) {
  console.log(
    `Using packaged version ${version} (package.json is currently ${packageJson.version})`,
  );
}

const artifacts = targets.map(({ arch, format, contentType }) => {
  const fileName = `${artifactProductName}-${version}-${arch}.${format}`;
  const file = path.join(releaseDir, fileName);
  if (!existsSync(file)) {
    fail(
      `missing artifact ${path.relative(root, file)}` +
        (existsSync(publishVersionFile)
          ? ""
          : `; tip: re-run package:mac:all, or pass --version=<packaged-version>`),
    );
  }
  return {
    arch,
    format,
    contentType,
    file,
    fileName,
    size: statSync(file).size,
    versionedKey: objectKey("macos", `v${version}`, fileName),
    latestKey: objectKey("macos", `${artifactProductName}-${arch}-latest.${format}`),
  };
});

const uploads = [
  ...artifacts.map((artifact) => ({
    file: artifact.file,
    key: artifact.versionedKey,
    contentType: artifact.contentType,
    cacheControl: "public, max-age=31536000, immutable",
    downloadName: artifact.fileName,
  })),
  ...artifacts.map((artifact) => ({
    file: artifact.file,
    key: artifact.latestKey,
    contentType: artifact.contentType,
    cacheControl: "public, max-age=0, must-revalidate",
    downloadName: artifact.fileName,
  })),
];

const totalBytes = artifacts.reduce((sum, artifact) => sum + artifact.size, 0);
console.log(
  `Publishing AntTodo ${version} to OSS bucket "${bucket}" (${artifacts.length} files, ${formatBytes(totalBytes)} payload; ${uploads.length} object puts + manifest)`,
);
for (const artifact of artifacts) {
  console.log(
    `  - ${artifact.fileName} ${formatBytes(artifact.size)} → ${artifact.arch}/${artifact.format}`,
  );
}

let client = null;
if (!dryRun) {
  const { default: OSS } = await import("ali-oss");
  client = new OSS({
    accessKeyId,
    accessKeySecret,
    bucket,
    region,
    endpoint,
    timeout: ossTimeoutMs,
  });
}

const publishStartedAt = Date.now();
let step = 0;
const totalSteps = uploads.length + 1;

// Publish immutable objects first. The stable aliases and manifest only move after
// every versioned artifact is safely stored.
for (const item of uploads) {
  step += 1;
  if (step === 1) console.log("\nPhase 1/2: versioned objects");
  if (step === artifacts.length + 1) console.log("\nPhase 2/2: latest aliases");
  await upload(client, item.file, item.key, {
    contentType: item.contentType,
    cacheControl: item.cacheControl,
    downloadName: item.downloadName,
    step,
    total: totalSteps,
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
                size: artifact.size,
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
step += 1;
console.log("\nPublishing manifest");
await upload(client, manifestFile, manifestKey, {
  contentType: "application/json; charset=utf-8",
  cacheControl: "public, max-age=0, must-revalidate",
  downloadName: "macos-latest.json",
  step,
  total: totalSteps,
});

console.log(`\nPublish finished in ${formatDuration(Date.now() - publishStartedAt)}`);
console.log("Stable download URLs:");
for (const artifact of artifacts) console.log(`${artifact.arch} ${artifact.format}: ${publicUrl(artifact.latestKey)}`);
console.log(`manifest: ${publicUrl(manifestKey)}`);
