#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NOTARIZE_STATE_PATH,
  readNotarizeState,
  stapleApp,
  waitForNotarization,
} from "./notarize-macos.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const productName = packageJson.build?.productName;

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

/**
 * electron-builder --prepackaged 必须指向 .app 本身，不能指向包含它的目录。
 * 传目录会导致 DMG 出现 蚂蚁清单.app/蚂蚁清单.app，ZIP 顶层变成 mac-arm64/。
 */
function assertPrepackagedApp(appPath) {
  if (!existsSync(appPath)) {
    throw new Error(`找不到预打包应用：${appPath}`);
  }
  if (!existsSync(join(appPath, "Contents", "Info.plist"))) {
    throw new Error(`预打包应用结构无效（缺少 Contents/Info.plist）：${appPath}`);
  }
  const nestedApp = join(appPath, basename(appPath));
  if (existsSync(nestedApp)) {
    throw new Error(
      `预打包应用出现嵌套 .app（${nestedApp}）。请清理 release 后重新 package:mac。`,
    );
  }
}

async function main() {
  if (!productName) {
    throw new Error("package.json 缺少 build.productName。");
  }

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
    assertPrepackagedApp(app.appPath);
    console.log(`等待公证完成：${app.arch} ${app.submissionId}`);
    await waitForNotarization(app.submissionId);
    console.log(`装订公证票据：${app.appPath}`);
    await stapleApp(app.appPath);
    console.log(`公证完成：${app.arch} ${app.submissionId}`);
  }

  for (const app of state.apps) {
    assertPrepackagedApp(app.appPath);
    console.log(`生成 ${app.arch} DMG/ZIP（--prepackaged ${app.appPath}）…`);
    await run(
      "pnpm",
      [
        "exec",
        "electron-builder",
        "--mac",
        "dmg",
        "zip",
        `--${app.arch}`,
        "--prepackaged",
        app.appPath,
      ],
      { NOTARIZE_MODE: "skip" },
    );
  }

  const arches = state.apps.map((app) => app.arch);
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
