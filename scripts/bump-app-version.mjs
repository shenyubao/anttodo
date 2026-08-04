#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatAppVersionLabel, formatDeployAppVersion } from "./app-version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(root, "package.json");
const source = readFileSync(packageJsonPath, "utf8");
const packageJson = JSON.parse(source);
const previous = typeof packageJson.version === "string" ? packageJson.version : "";
const next = formatDeployAppVersion();

if (!/"version"\s*:\s*"[^"]*"/.test(source)) {
  console.error("bump-app-version: package.json is missing a version field");
  process.exit(1);
}

const updated = source.replace(/("version"\s*:\s*")([^"]*)(")/, `$1${next}$3`);
writeFileSync(packageJsonPath, updated, "utf8");

console.log(
  `App version updated: ${formatAppVersionLabel(previous)} → ${formatAppVersionLabel(next)}`,
);
