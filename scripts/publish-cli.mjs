#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options = {}) {
  const { capture = false } = options;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.on("error", reject);
    child.on("exit", (code) => {
      resolvePromise({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

const identity = await run("npm", ["whoami"], { capture: true });
if (identity.code !== 0 || !identity.stdout) {
  console.error("npm 未登录或本地令牌已失效，registry 会把无权限的 PUT 返回成 404。");
  console.error("@anttodos/cli 当前维护者是 ssybb1988，请先用该账号登录：");
  console.error("  npm login");
  console.error("然后再执行 pnpm deploy:cli。");
  process.exit(1);
}

console.log(`Publishing @anttodos/cli as ${identity.stdout}`);
const published = await run("npm", ["publish", "./cli", "--access", "public"]);
if (published.code !== 0) {
  process.exit(published.code);
}
