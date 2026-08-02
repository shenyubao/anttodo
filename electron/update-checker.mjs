export const UPDATE_MANIFEST_URL = "https://download.anttodo.com/macos/latest.json";
export const DOWNLOAD_HOST = "download.anttodo.com";

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function safeDownloadUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === DOWNLOAD_HOST
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isAllowedDownloadUrl(value) {
  return safeDownloadUrl(value) !== null;
}

/**
 * @param {string} version
 * @returns {[number, number, number] | null}
 */
export function parseVersionParts(version) {
  if (typeof version !== "string") return null;
  const core = version.trim().split(/[-+]/, 1)[0];
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(core);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {number | null} negative when left < right, 0 when equal, positive when left > right
 */
export function compareVersions(left, right) {
  const a = parseVersionParts(left);
  const b = parseVersionParts(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * @param {string} [arch]
 * @returns {"arm64" | "x64"}
 */
export function resolveMacArch(arch = process.arch) {
  return arch === "arm64" ? "arm64" : "x64";
}

/**
 * @param {unknown} value
 * @param {string} [arch]
 * @returns {{ version: string, downloadUrl: string } | null}
 */
export function parseUpdateManifest(value, arch = process.arch) {
  if (!value || typeof value !== "object") return null;
  const root = /** @type {Record<string, unknown>} */ (value);
  const version = typeof root.version === "string" ? root.version.trim() : "";
  if (!version || !parseVersionParts(version)) return null;

  const downloads = root.downloads;
  if (!downloads || typeof downloads !== "object") return null;
  const macos = /** @type {Record<string, unknown>} */ (downloads).macos;
  if (!macos || typeof macos !== "object") return null;

  const resolvedArch = resolveMacArch(arch);
  const archEntry = /** @type {Record<string, unknown>} */ (macos)[resolvedArch];
  if (!archEntry || typeof archEntry !== "object") return null;
  const dmg = /** @type {Record<string, unknown>} */ (archEntry).dmg;
  if (!dmg || typeof dmg !== "object") return null;
  const downloadUrl = safeDownloadUrl(/** @type {Record<string, unknown>} */ (dmg).url);
  if (!downloadUrl) return null;

  return { version, downloadUrl };
}

/**
 * @param {{
 *   currentVersion: string,
 *   arch?: string,
 *   fetchImpl?: typeof fetch,
 *   manifestUrl?: string,
 * }} options
 * @returns {Promise<
 *   | { status: "available", currentVersion: string, latestVersion: string, downloadUrl: string }
 *   | { status: "up-to-date", currentVersion: string, latestVersion: string }
 *   | { status: "error", message: string }
 * >}
 */
export async function checkForDesktopUpdate({
  currentVersion,
  arch = process.arch,
  fetchImpl = fetch,
  manifestUrl = UPDATE_MANIFEST_URL,
}) {
  if (!parseVersionParts(currentVersion)) {
    return { status: "error", message: "当前版本号无效" };
  }

  let response;
  try {
    response = await fetchImpl(manifestUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return { status: "error", message: "无法连接更新服务器" };
  }

  if (!response.ok) {
    return { status: "error", message: `更新检查失败（${response.status}）` };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { status: "error", message: "更新清单格式无效" };
  }

  const parsed = parseUpdateManifest(payload, arch);
  if (!parsed) {
    return { status: "error", message: "更新清单缺少可用下载" };
  }

  const compared = compareVersions(currentVersion, parsed.version);
  if (compared === null) {
    return { status: "error", message: "无法比较版本号" };
  }

  if (compared < 0) {
    return {
      status: "available",
      currentVersion,
      latestVersion: parsed.version,
      downloadUrl: parsed.downloadUrl,
    };
  }

  return {
    status: "up-to-date",
    currentVersion,
    latestVersion: parsed.version,
  };
}
