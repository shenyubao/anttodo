#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnvFiles } from "./load-local-env.mjs";
import { buildLatestMacYml } from "./mac-update-feed.mjs";

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
// Parallel part uploads have corrupted large DMG/ZIP objects (same size, wrong bytes).
const multipartParallel = 1;
const uploadAttempts = 2;

function resolvePublishVersion() {
  if (versionOverride) return versionOverride;
  if (existsSync(publishVersionFile)) {
    const stamped = readFileSync(publishVersionFile, "utf8").trim().replace(/^v/, "");
    if (stamped) return stamped;
  }
  return packageJson.version;
}

const version = resolvePublishVersion();

// DMG for first install / website; ZIP (+ blockmap + latest-mac.yml) for in-app updates.
const targets = [
  { arch: "arm64", format: "dmg", contentType: "application/x-apple-diskimage" },
  { arch: "x64", format: "dmg", contentType: "application/x-apple-diskimage" },
  { arch: "arm64", format: "zip", contentType: "application/zip" },
  { arch: "x64", format: "zip", contentType: "application/zip" },
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

async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function sha256Object(client, key) {
  const result = await client.getStream(key);
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of result.stream) {
    size += chunk.length;
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), size };
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

async function putObject(client, file, key, { contentType, cacheControl, downloadName, onProgress }) {
  const byteSize = statSync(file).size;
  const headers = {
    "Cache-Control": cacheControl,
    "Content-Disposition": `attachment; filename="${downloadName}"`,
  };

  if (byteSize >= multipartThresholdBytes) {
    await client.multipartUpload(key, file, {
      timeout: ossTimeoutMs,
      // Keep sequential: parallel part streams have produced same-size, wrong-hash objects.
      parallel: multipartParallel,
      partSize: 8 * 1024 * 1024,
      mime: contentType,
      headers,
      progress(percentage) {
        onProgress?.(percentage);
      },
    });
    return;
  }

  await client.put(key, file, {
    timeout: ossTimeoutMs,
    headers: {
      ...headers,
      "Content-Type": contentType,
    },
  });
}

async function upload(client, file, key, { contentType, cacheControl, downloadName, step, total, expectedSha256 }) {
  const byteSize = statSync(file).size;
  const size = formatBytes(byteSize);
  const label = `[${step}/${total}]`;
  const localSha = expectedSha256 ?? (await sha256File(file));
  console.log(`${label} ${dryRun ? "Would upload" : "Uploading"} ${bucket}/${key} (${size})`);
  if (dryRun) return;

  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    console.log(
      `  …仍在上传（已用时 ${formatDuration(Date.now() - startedAt)}；大文件可能需要几分钟）`,
    );
  }, heartbeatMs);

  try {
    let lastError = null;
    for (let attempt = 1; attempt <= uploadAttempts; attempt += 1) {
      let lastProgressLog = 0;
      try {
        await putObject(client, file, key, {
          contentType,
          cacheControl,
          downloadName,
          onProgress(percentage) {
            const now = Date.now();
            if (percentage >= 1 || now - lastProgressLog >= heartbeatMs) {
              lastProgressLog = now;
              console.log(`  …进度 ${Math.floor(percentage * 100)}%`);
            }
          },
        });
        console.log(`  …校验远程 SHA-256`);
        const remote = await sha256Object(client, key);
        if (remote.size !== byteSize || remote.sha256 !== localSha) {
          throw new Error(
            `checksum mismatch for ${key} (attempt ${attempt}/${uploadAttempts}): ` +
              `local ${localSha} (${byteSize} B) vs remote ${remote.sha256} (${remote.size} B)`,
          );
        }
        console.log(`${label} Done ${bucket}/${key} in ${formatDuration(Date.now() - startedAt)}`);
        return;
      } catch (error) {
        lastError = error;
        if (attempt >= uploadAttempts) break;
        console.warn(
          `  …上传或校验失败，准备重试：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    fail(lastError instanceof Error ? lastError.message : String(lastError));
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

const artifacts = [];
for (const { arch, format, contentType } of targets) {
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
  artifacts.push({
    arch,
    format,
    contentType,
    file,
    fileName,
    size: statSync(file).size,
    sha256: await sha256File(file),
    versionedKey: objectKey("macos", `v${version}`, fileName),
    latestKey: objectKey("macos", `${artifactProductName}-${arch}-latest.${format}`),
    // electron-updater resolves paths relative to latest-mac.yml in this feed root.
    feedKey: objectKey("macos", fileName),
  });
}

const zipArtifacts = artifacts.filter((artifact) => artifact.format === "zip");
const blockmapUploads = [];
for (const artifact of zipArtifacts) {
  const blockmapName = `${artifact.fileName}.blockmap`;
  const blockmapFile = path.join(releaseDir, blockmapName);
  if (!existsSync(blockmapFile)) {
    console.warn(`warning: missing blockmap ${path.relative(root, blockmapFile)} (differential updates disabled for ${artifact.arch})`);
    continue;
  }
  const blockmapSha = await sha256File(blockmapFile);
  blockmapUploads.push(
    {
      file: blockmapFile,
      key: objectKey("macos", `v${version}`, blockmapName),
      contentType: "application/octet-stream",
      cacheControl: "public, max-age=31536000, immutable",
      downloadName: blockmapName,
      expectedSha256: blockmapSha,
    },
    {
      file: blockmapFile,
      key: objectKey("macos", blockmapName),
      contentType: "application/octet-stream",
      cacheControl: "public, max-age=0, must-revalidate",
      downloadName: blockmapName,
      expectedSha256: blockmapSha,
    },
  );
}

const latestMacYml = buildLatestMacYml(zipArtifacts, version);
const latestMacYmlFile = path.join(releaseDir, "latest-mac.yml");
writeFileSync(latestMacYmlFile, latestMacYml);
const latestMacYmlKey = objectKey("macos", "latest-mac.yml");

const uploads = [
  ...artifacts.map((artifact) => ({
    file: artifact.file,
    key: artifact.versionedKey,
    contentType: artifact.contentType,
    cacheControl: "public, max-age=31536000, immutable",
    downloadName: artifact.fileName,
    expectedSha256: artifact.sha256,
  })),
  ...blockmapUploads.filter((item) => item.key.includes(`/v${version}/`)),
  ...artifacts.map((artifact) => ({
    file: artifact.file,
    key: artifact.latestKey,
    contentType: artifact.contentType,
    cacheControl: "public, max-age=0, must-revalidate",
    downloadName: artifact.fileName,
    expectedSha256: artifact.sha256,
  })),
  // Feed-root copies keep the exact builder filenames referenced by latest-mac.yml.
  ...zipArtifacts.map((artifact) => ({
    file: artifact.file,
    key: artifact.feedKey,
    contentType: artifact.contentType,
    cacheControl: "public, max-age=0, must-revalidate",
    downloadName: artifact.fileName,
    expectedSha256: artifact.sha256,
  })),
  ...blockmapUploads.filter((item) => !item.key.includes(`/v${version}/`)),
  {
    file: latestMacYmlFile,
    key: latestMacYmlKey,
    contentType: "text/yaml; charset=utf-8",
    cacheControl: "public, max-age=0, must-revalidate",
    downloadName: "latest-mac.yml",
  },
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
  if (step === artifacts.length + blockmapUploads.filter((item) => item.key.includes(`/v${version}/`)).length + 1) {
    console.log("\nPhase 2/2: latest aliases + update feed");
  }
  await upload(client, item.file, item.key, {
    contentType: item.contentType,
    cacheControl: item.cacheControl,
    downloadName: item.downloadName,
    expectedSha256: item.expectedSha256,
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
                sha256: artifact.sha256,
              },
            ]),
        ),
      ]),
    ),
  },
  updateFeed: {
    mac: publicUrl(latestMacYmlKey),
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
console.log(`update feed: ${publicUrl(latestMacYmlKey)}`);
console.log(`manifest: ${publicUrl(manifestKey)}`);
