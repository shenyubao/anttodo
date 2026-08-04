export function normalizeAppVersion(version: string | null | undefined): string | null {
  if (!version?.trim()) return null;
  const core = version.trim().replace(/^v/i, "");
  return /^\d+\.\d+\.\d+$/.test(core) ? core : null;
}

export function formatAppVersionLabel(version: string | null | undefined): string {
  const core = normalizeAppVersion(version);
  return core ? `v${core}` : "未知";
}

export function getBuildAppVersion(): string {
  return import.meta.env.VITE_APP_VERSION || "0.0.0";
}
