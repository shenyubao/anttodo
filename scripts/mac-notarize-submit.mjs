#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NOTARIZE_STATE_PATH,
  readNotarizeState,
  resetNotarizeState,
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

async function main() {
  if (!process.env.APPLE_KEYCHAIN_PROFILE && !process.env.APPLE_API_KEY) {
    process.env.APPLE_KEYCHAIN_PROFILE = "anttodo-notarization";
  }

  const skipBump = process.argv.includes("--skip-bump");
  // Mac 发布不推库；数据库迁移走 deploy:web / supabase:push。需要时加 --push。
  if (process.argv.includes("--push")) {
    await run("pnpm", ["supabase:push"]);
  }
  if (!skipBump) {
    await run("pnpm", ["bump:app-version"]);
  }

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const version = typeof packageJson.version === "string" ? packageJson.version.trim() : "";
  await resetNotarizeState(version);
  console.log(`已重置公证状态：${NOTARIZE_STATE_PATH}（版本 ${version || "-"}）`);

  await run("pnpm", ["mac:signing:check"]);
  await run("pnpm", ["build"]);
  await run(
    "pnpm",
    ["exec", "electron-builder", "--mac", "dir", "--arm64", "--x64"],
    { NOTARIZE_MODE: "submit" },
  );

  const state = await readNotarizeState();
  if (!state?.apps?.length) {
    throw new Error("公证 submit 完成，但未写入任何 submission ID");
  }

  console.log("");
  console.log("公证已提交，尚未等待 Apple 处理完成：");
  for (const app of state.apps) {
    console.log(`  - ${app.arch}: ${app.submissionId}`);
  }
  console.log("");
  console.log("查看列表：pnpm mac:list");
  console.log("公证完成后继续发布：pnpm mac:deploy");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
