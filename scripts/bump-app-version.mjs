#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatAppVersionLabel, formatDeployAppVersion } from "./app-version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relativePath = process.argv[2] ?? "package.json";
const packageJsonPath = path.resolve(root, relativePath);

if (!packageJsonPath.startsWith(`${root}${path.sep}`)) {
  console.error("bump-app-version: package path must stay inside the repository");
  process.exit(1);
}

const source = readFileSync(packageJsonPath, "utf8");
const packageJson = JSON.parse(source);
const previous = typeof packageJson.version === "string" ? packageJson.version : "";
const next = formatDeployAppVersion();
const packageName = typeof packageJson.name === "string" && packageJson.name.trim()
  ? packageJson.name
  : relativePath;

if (!/"version"\s*:\s*"[^"]*"/.test(source)) {
  console.error(`bump-app-version: ${relativePath} is missing a version field`);
  process.exit(1);
}

const updated = source.replace(/("version"\s*:\s*")([^"]*)(")/, `$1${next}$3`);
writeFileSync(packageJsonPath, updated, "utf8");

console.log(
  `${packageName} version updated: ${formatAppVersionLabel(previous)} → ${formatAppVersionLabel(next)}`,
);
