#!/usr/bin/env node

import { spawn, execFileSync } from "node:child_process";
import {
  accessSync,
  constants,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatAppVersionLabel } from "./app-version.mjs";
import { applyIosVersionsToPbxproj, resolveIosVersions } from "./ios-version.mjs";
import { loadLocalEnvFiles } from "./load-local-env.mjs";

loadLocalEnvFiles();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const xcodeDeveloperDir = "/Applications/Xcode.app/Contents/Developer";
const projectPath = path.join(root, "ios/App/App.xcodeproj");
const pbxprojPath = path.join(projectPath, "project.pbxproj");
const capSpmPackagePath = path.join(root, "ios/App/CapApp-SPM/Package.swift");
const releaseDir = path.join(root, "release/ios");
const archivePath = path.join(releaseDir, "App.xcarchive");
const exportPath = path.join(releaseDir, "export");
const exportOptionsPath = path.join(releaseDir, "ExportOptions.plist");
const xcodeLogPath = path.join(releaseDir, "xcodebuild.log");
const scheme = process.env.IOS_SCHEME?.trim() || "App";
const teamId = process.env.IOS_DEVELOPMENT_TEAM?.trim() || "U99DYL88T7";
const bundleId = process.env.IOS_BUNDLE_ID?.trim() || "com.anttodo.ios";
const dryRun = process.argv.includes("--dry-run");
const skipBump = process.argv.includes("--skip-bump");
const skipSync = process.argv.includes("--skip-sync");
const skipArchive = process.argv.includes("--skip-archive");

function fail(message) {
  console.error(`iOS TestFlight 发布失败：${message}`);
  process.exit(1);
}

function ensureXcode() {
  if (process.platform !== "darwin") {
    fail("只能在 macOS 上构建并上传 iOS 包。");
  }
  if (!existsSync(path.join(xcodeDeveloperDir, "usr/bin/xcodebuild"))) {
    fail(`未找到完整 Xcode：${xcodeDeveloperDir}`);
  }
  process.env.DEVELOPER_DIR = xcodeDeveloperDir;
}

function resolveAppleApiCredentials() {
  const keyPath = process.env.APPLE_API_KEY?.trim();
  const keyId = process.env.APPLE_API_KEY_ID?.trim();
  const issuer = process.env.APPLE_API_ISSUER?.trim();
  const present = {
    APPLE_API_KEY: Boolean(keyPath),
    APPLE_API_KEY_ID: Boolean(keyId),
    APPLE_API_ISSUER: Boolean(issuer),
  };
  const missing = Object.entries(present)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  if (missing.length === 0) {
    try {
      accessSync(keyPath, constants.R_OK);
    } catch {
      fail(`APPLE_API_KEY 指向的 .p8 文件不可读取：${keyPath}`);
    }
    return { keyPath, keyId, issuer };
  }

  if (missing.length < 3) {
    fail(
      `缺少 ${missing.join("、")}。请在 .env.local 补齐（Issuer ID 在 App Store Connect → 用户与访问 → Integrations）。`,
    );
  }

  fail(
    "缺少 App Store Connect API 凭据。请在 .env.local 设置 APPLE_API_KEY、APPLE_API_KEY_ID、APPLE_API_ISSUER。",
  );
}

function ensureIosPluginPackages() {
  if (!existsSync(capSpmPackagePath)) {
    fail(`缺少 ${capSpmPackagePath}，请先运行 pnpm ios:sync。`);
  }
  const source = readFileSync(capSpmPackagePath, "utf8");
  const packagePaths = [...source.matchAll(/path:\s*"([^"]+)"/g)].map((match) => match[1]);
  const missing = packagePaths
    .map((relativePath) => path.resolve(path.dirname(capSpmPackagePath), relativePath))
    .filter((absolutePath) => !existsSync(absolutePath));
  if (missing.length > 0) {
    fail(
      `Capacitor iOS 插件路径不存在，请先 pnpm install && pnpm ios:sync：\n${missing.join("\n")}`,
    );
  }
}

function hasDistributionCertificate() {
  try {
    const identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
      encoding: "utf8",
    });
    return /Apple Distribution|iOS Distribution/.test(identities);
  } catch {
    return false;
  }
}

function ensureDistributionCertificate() {
  if (hasDistributionCertificate()) return;
  fail(
    [
      "钥匙串中没有 Apple Distribution 证书，无法导出 App Store / TestFlight IPA。",
      "当前 API Key 也没有 Cloud Signing 权限（Cloud signing permission error）。",
      "",
      "请任选其一：",
      "1) 本地证书（推荐）：Xcode → Settings → Accounts → 选择 Team → Manage Certificates → + → Apple Distribution",
      "2) 云签名：在 App Store Connect 将 API Key 角色设为 Admin（或换一把 Admin Key）",
    ].join("\n"),
  );
}

function stageApiKeyForAltool(credentials) {
  const destDir = path.join(os.homedir(), ".appstoreconnect", "private_keys");
  mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, `AuthKey_${credentials.keyId}.p8`);
  if (!existsSync(destPath)) {
    copyFileSync(credentials.keyPath, destPath);
  }
  return destPath;
}

function findExportedIpa() {
  if (!existsSync(exportPath)) return null;
  const match = readdirSync(exportPath).find((name) => name.endsWith(".ipa"));
  return match ? path.join(exportPath, match) : null;
}

function summarizeXcodeFailure(output) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const interesting = lines.filter((line) =>
    /error:|❌|Provisioning|Code Sign|CODE_SIGN|does not exist|cannot be accessed|No profiles|Archive Failed|Cloud signing/i.test(
      line,
    ),
  );
  const unique = [...new Set(interesting)].slice(0, 20);
  return unique.length > 0 ? `\n${unique.join("\n")}` : "";
}

function run(command, args, options = {}) {
  const { logPath } = options;
  return new Promise((resolve, reject) => {
    const chunks = [];
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: logPath ? ["inherit", "pipe", "pipe"] : "inherit",
    });
    let logStream = null;
    if (logPath) {
      mkdirSync(path.dirname(logPath), { recursive: true });
      logStream = createWriteStream(logPath);
      const onData = (buffer) => {
        process.stdout.write(buffer);
        logStream.write(buffer);
        chunks.push(buffer);
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
    }
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (logStream) logStream.end();
      if (signal) {
        reject(new Error(`${command} 被信号终止：${signal}`));
        return;
      }
      if (code !== 0) {
        const output = Buffer.concat(chunks).toString("utf8");
        const detail = logPath ? summarizeXcodeFailure(output) : "";
        const logHint = logPath ? `\n完整日志：${logPath}` : "";
        reject(new Error(`${command} ${args.join(" ")} 退出码 ${code}${detail}${logHint}`));
        return;
      }
      resolve();
    });
  });
}

function readPackageVersion() {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  return packageJson.version;
}

function syncPbxprojVersion(packageVersion) {
  const versions = resolveIosVersions(packageVersion);
  const source = readFileSync(pbxprojPath, "utf8");
  const updated = applyIosVersionsToPbxproj(source, versions);
  if (updated !== source) {
    writeFileSync(pbxprojPath, updated, "utf8");
  }
  console.log(
    `iOS 版本已同步：MARKETING_VERSION=${versions.marketingVersion} CURRENT_PROJECT_VERSION=${versions.buildNumber}`,
  );
  return versions;
}

function writeExportOptions() {
  // Export locally with automatic signing, then upload via altool.
  // Avoid destination=upload + API Key cloud signing (needs Admin key).
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>destination</key>
	<string>export</string>
	<key>teamID</key>
	<string>${teamId}</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>signingCertificate</key>
	<string>Apple Distribution</string>
	<key>uploadSymbols</key>
	<true/>
	<key>manageAppVersionAndBuildNumber</key>
	<false/>
</dict>
</plist>
`;
  writeFileSync(exportOptionsPath, plist, "utf8");
}

function authArgs(credentials) {
  return [
    "-allowProvisioningUpdates",
    "-authenticationKeyPath",
    credentials.keyPath,
    "-authenticationKeyID",
    credentials.keyId,
    "-authenticationKeyIssuerID",
    credentials.issuer,
  ];
}

async function main() {
  ensureXcode();
  const credentials = resolveAppleApiCredentials();
  ensureDistributionCertificate();

  if (!skipBump && !dryRun && !skipArchive) {
    await run("node", ["scripts/bump-app-version.mjs"]);
  }

  const packageVersion = readPackageVersion();
  const versions = syncPbxprojVersion(packageVersion);

  mkdirSync(releaseDir, { recursive: true });
  writeExportOptions();

  console.log(
    `准备上传 TestFlight：${bundleId} ${formatAppVersionLabel(versions.marketingVersion)} (${versions.buildNumber})`,
  );

  if (dryRun) {
    ensureIosPluginPackages();
    console.log("dry-run：已校验 Xcode、凭据、分发证书、插件路径与版本同步，跳过构建与上传。");
    return;
  }

  if (!skipArchive) {
    if (!skipSync) {
      console.log("同步 Web 构建产物到 iOS…");
      await run("pnpm", ["ios:sync"]);
    }
    ensureIosPluginPackages();

    console.log("归档 Release…");
    await run(
      "xcodebuild",
      [
        "-project",
        projectPath,
        "-scheme",
        scheme,
        "-configuration",
        "Release",
        "-destination",
        "generic/platform=iOS",
        "-archivePath",
        archivePath,
        ...authArgs(credentials),
        "archive",
      ],
      { logPath: xcodeLogPath },
    );
  } else if (!existsSync(archivePath)) {
    fail(`--skip-archive 需要已有归档：${archivePath}`);
  } else {
    console.log(`跳过归档，复用 ${archivePath}`);
  }

  console.log("导出 IPA（使用本地 Apple Distribution，避免 API Key 云签名）…");
  mkdirSync(exportPath, { recursive: true });
  // Do not pass API key auth here: that forces cloud signing and needs Admin.
  await run(
    "xcodebuild",
    [
      "-exportArchive",
      "-archivePath",
      archivePath,
      "-exportPath",
      exportPath,
      "-exportOptionsPlist",
      exportOptionsPath,
      "-allowProvisioningUpdates",
    ],
    { logPath: xcodeLogPath },
  );

  const ipaPath = findExportedIpa();
  if (!ipaPath) {
    fail(`导出成功但未找到 IPA：${exportPath}`);
  }

  console.log(`上传 IPA 到 App Store Connect：${ipaPath}`);
  stageApiKeyForAltool(credentials);
  await run(
    "xcrun",
    [
      "altool",
      "--upload-app",
      "--type",
      "ios",
      "--file",
      ipaPath,
      "--apiKey",
      credentials.keyId,
      "--apiIssuer",
      credentials.issuer,
    ],
    { logPath: xcodeLogPath },
  );

  console.log(
    `已提交 TestFlight：${formatAppVersionLabel(versions.marketingVersion)} (build ${versions.buildNumber})`,
  );
  console.log("可在 App Store Connect → TestFlight 中查看处理进度。");
  console.log(`本机归档：${archivePath}`);
  console.log(`本机 IPA：${ipaPath}`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
