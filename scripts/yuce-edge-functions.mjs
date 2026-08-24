import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const PRESERVED_FUNCTION_DIRS = ["hello", "main"];
export const DEFAULT_SELFHOST_DOCKER_DIR = "/home/ubuntu/projects/supabase/docker";

export function listLocalFunctionDirs(functionsRoot) {
  return readdirSync(functionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !PRESERVED_FUNCTION_DIRS.includes(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export function collectFunctionImportMaps(functionsRoot) {
  return listLocalFunctionDirs(functionsRoot).flatMap((name) => {
    const file = path.join(functionsRoot, name, "deno.json");
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      const imports = parsed && typeof parsed === "object" ? parsed.imports : null;
      if (!imports || typeof imports !== "object" || Array.isArray(imports)) return [];
      return [{ name, imports }];
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  });
}

export function mergeFunctionImportMaps(maps) {
  /** @type {Record<string, string>} */
  const merged = {};
  /** @type {Record<string, string>} */
  const from = {};
  for (const { name, imports } of maps) {
    for (const [key, specifier] of Object.entries(imports)) {
      if (typeof specifier !== "string" || !specifier.trim()) {
        throw new Error(`Edge Function ${name} has an invalid import for "${key}"`);
      }
      if (!merged[key]) {
        merged[key] = specifier;
        from[key] = name;
        continue;
      }
      if (merged[key] === specifier) continue;
      const preferred = preferCompatibleSpecifier(merged[key], specifier);
      if (!preferred) {
        throw new Error(
          `Edge Function import map conflict for "${key}": ${merged[key]} (${from[key]}) vs ${specifier} (${name})`,
        );
      }
      merged[key] = preferred;
    }
  }
  return Object.fromEntries(
    Object.entries(merged).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function buildSharedImportMap(functionsRoot) {
  return mergeFunctionImportMaps(collectFunctionImportMaps(functionsRoot));
}

export function formatSharedDenoJsonc(imports) {
  return `${JSON.stringify({ imports }, null, 2)}\n`;
}

export function remoteFunctionDirsToRemove(remoteNames, localNames) {
  const keep = new Set([...localNames, ...PRESERVED_FUNCTION_DIRS]);
  return remoteNames
    .filter((name) => name && !keep.has(name))
    .sort((left, right) => left.localeCompare(right));
}

function preferCompatibleSpecifier(left, right) {
  const parsedLeft = parseRegistrySpecifier(left);
  const parsedRight = parseRegistrySpecifier(right);
  if (!parsedLeft || !parsedRight) return null;
  if (parsedLeft.registry !== parsedRight.registry || parsedLeft.name !== parsedRight.name) {
    return null;
  }
  if (isCaretCovering(parsedLeft.version, parsedRight.version)) return left;
  if (isCaretCovering(parsedRight.version, parsedLeft.version)) return right;
  return null;
}

function parseRegistrySpecifier(value) {
  const match = String(value).match(/^(jsr|npm):(.+)@(.+)$/);
  if (!match) return null;
  return { registry: match[1], name: match[2], version: match[3] };
}

function isCaretCovering(range, version) {
  if (!range.startsWith("^")) return false;
  const major = range.slice(1).split(".")[0];
  return version === major || version.startsWith(`${major}.`);
}
