#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const statusOutput = execFileSync("supabase", ["status", "--workdir", repositoryRoot, "-o", "env"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const local = Object.fromEntries(statusOutput.trim().split("\n").flatMap((line) => {
  const match = line.match(/^([A-Z0-9_]+)="(.*)"$/);
  return match ? [[match[1], match[2]]] : [];
}));
const environment = {
  ...process.env,
  VITE_SUPABASE_URL: local.API_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
  VITE_PUBLIC_APP_URL: "http://127.0.0.1:4173",
};

execFileSync("pnpm", ["build:web"], { cwd: repositoryRoot, env: environment, stdio: "inherit" });
execFileSync("pnpm", ["exec", "playwright", "test", "tests/e2e/cli-auth.spec.ts"], {
  cwd: repositoryRoot,
  env: environment,
  stdio: "inherit",
});
