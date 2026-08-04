/**
 * App version helpers.
 * Stored form: 1.0.YYYYMMDDHHmm
 * Display form: v1.0.YYYYMMDDHHmm
 */

const VERSION_CORE_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * @param {number} value
 * @returns {string}
 */
function pad2(value) {
  return String(value).padStart(2, "0");
}

/**
 * @param {Date} [date]
 * @returns {string}
 */
export function formatDeployAppVersion(date = new Date()) {
  const stamp = [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
    pad2(date.getHours()),
    pad2(date.getMinutes()),
  ].join("");
  return `1.0.${stamp}`;
}

/**
 * @param {unknown} version
 * @returns {string | null}
 */
export function normalizeAppVersion(version) {
  if (typeof version !== "string") return null;
  const core = version.trim().replace(/^v/i, "");
  return VERSION_CORE_PATTERN.test(core) ? core : null;
}

/**
 * @param {unknown} version
 * @returns {string}
 */
export function formatAppVersionLabel(version) {
  const core = normalizeAppVersion(version);
  return core ? `v${core}` : "未知";
}
