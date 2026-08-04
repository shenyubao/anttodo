export const MAC_DOWNLOAD_MANIFEST = "/api/downloads/macos";

export const FALLBACK_MAC_DOWNLOADS = {
  arm64:
    "https://anttodo-yuce.oss-cn-hangzhou.aliyuncs.com/release/macos/AntTodo-arm64-latest.dmg",
  x64:
    "https://anttodo-yuce.oss-cn-hangzhou.aliyuncs.com/release/macos/AntTodo-x64-latest.dmg",
} as const;

export type MacDownloads = {
  version: string | null;
  arm64: string;
  x64: string;
};

function safeDownloadUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
        && url.hostname === "anttodo-yuce.oss-cn-hangzhou.aliyuncs.com"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function parseMacDownloads(value: unknown): MacDownloads | null {
  if (!value || typeof value !== "object") return null;
  const root = value as Record<string, unknown>;
  const downloads = root.downloads as Record<string, unknown> | undefined;
  const macos = downloads?.macos as Record<string, unknown> | undefined;
  const arm64 = macos?.arm64 as Record<string, unknown> | undefined;
  const x64 = macos?.x64 as Record<string, unknown> | undefined;
  const arm64Dmg = arm64?.dmg as Record<string, unknown> | undefined;
  const x64Dmg = x64?.dmg as Record<string, unknown> | undefined;
  const arm64Url = safeDownloadUrl(arm64Dmg?.url);
  const x64Url = safeDownloadUrl(x64Dmg?.url);
  if (!arm64Url || !x64Url) return null;
  return {
    version: typeof root.version === "string" && root.version.trim() ? root.version : null,
    arm64: arm64Url,
    x64: x64Url,
  };
}

export function fallbackMacDownloads(): MacDownloads {
  return { version: null, ...FALLBACK_MAC_DOWNLOADS };
}
