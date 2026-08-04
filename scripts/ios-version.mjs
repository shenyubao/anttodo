import { normalizeAppVersion } from "./app-version.mjs";

/**
 * Map package.json `1.0.YYYYMMDDHHmm` onto Xcode version fields.
 * @param {unknown} packageVersion
 * @returns {{ marketingVersion: string, buildNumber: string }}
 */
export function resolveIosVersions(packageVersion) {
  const core = normalizeAppVersion(packageVersion);
  if (!core) {
    throw new Error(
      `无效的应用版本 “${String(packageVersion ?? "")}”，期望形如 1.0.YYYYMMDDHHmm`,
    );
  }
  const buildNumber = core.split(".")[2];
  if (!/^\d+$/.test(buildNumber)) {
    throw new Error(`无法从版本 “${core}” 解析 iOS build number`);
  }
  return { marketingVersion: core, buildNumber };
}

/**
 * Rewrite MARKETING_VERSION / CURRENT_PROJECT_VERSION in an Xcode pbxproj.
 * @param {string} source
 * @param {{ marketingVersion: string, buildNumber: string }} versions
 * @returns {string}
 */
export function applyIosVersionsToPbxproj(source, versions) {
  const { marketingVersion, buildNumber } = versions;
  let next = source;
  let marketingCount = 0;
  let buildCount = 0;

  next = next.replace(/MARKETING_VERSION = [^;]+;/g, () => {
    marketingCount += 1;
    return `MARKETING_VERSION = ${marketingVersion};`;
  });
  next = next.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, () => {
    buildCount += 1;
    return `CURRENT_PROJECT_VERSION = ${buildNumber};`;
  });

  if (marketingCount === 0 || buildCount === 0) {
    throw new Error(
      "project.pbxproj 中未找到 MARKETING_VERSION 或 CURRENT_PROJECT_VERSION",
    );
  }

  return next;
}
