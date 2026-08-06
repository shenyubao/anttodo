#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NOTARIZE_STATE_PATH,
  readNotarizeState,
  stapleApp,
  waitForNotarization,
} from "./notarize-macos.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, env = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} 退出码 ${code ?? "null"}`));
    });
  });
}

function prepackagedDirForArch(arch) {
  if (arch === "arm64") return join(root, "release", "mac-arm64");
  if (arch === "x64") return join(root, "release", "mac");
  throw new Error(`不支持的架构：${arch}`);
}

async function main() {
  if (!process.env.APPLE_KEYCHAIN_PROFILE && !process.env.APPLE_API_KEY) {
    process.env.APPLE_KEYCHAIN_PROFILE = "anttodo-notarization";
  }

  const state = await readNotarizeState();
  if (!state?.apps?.length) {
    throw new Error(
      `找不到本地公证状态：${NOTARIZE_STATE_PATH}\n请先运行 pnpm mac:submit`,
    );
  }

  console.log(
    `继续 macOS 发布：版本 ${state.version || "-"}，共 ${state.apps.length} 个架构`,
  );

  for (const app of state.apps) {
    if (!existsSync(app.appPath)) {
      throw new Error(`找不到已打包应用：${app.appPath}`);
    }
    console.log(`等待公证完成：${app.arch} ${app.submissionId}`);
    await waitForNotarization(app.submissionId);
    console.log(`装订公证票据：${app.appPath}`);
    await stapleApp(app.appPath);
    console.log(`公证完成：${app.arch} ${app.submissionId}`);
  }

  const arches = state.apps.map((app) => app.arch);
  for (const arch of arches) {
    const prepackaged = prepackagedDirForArch(arch);
    if (!existsSync(prepackaged)) {
      throw new Error(`找不到预打包目录：${prepackaged}`);
    }
    console.log(`生成 ${arch} DMG/ZIP…`);
    await run(
      "pnpm",
      [
        "exec",
        "electron-builder",
        "--mac",
        "dmg",
        "zip",
        `--${arch}`,
        "--prepackaged",
        prepackaged,
      ],
      { NOTARIZE_MODE: "skip" },
    );
  }

  console.log("验证产物…");
  await run("node", ["scripts/verify-macos-package.mjs", ...arches]);

  console.log("上传 OSS…");
  await run("node", ["scripts/publish-mac-oss.mjs"]);

  console.log("macOS 发布完成。");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
