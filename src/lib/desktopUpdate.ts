export type DesktopUpdateCheckResult =
  | {
      status: "available";
      currentVersion: string;
      latestVersion: string;
      downloadUrl: string;
    }
  | {
      status: "up-to-date";
      currentVersion: string;
      latestVersion: string;
    }
  | {
      status: "error";
      message: string;
    };

export type DesktopUpdateAvailable = Extract<
  DesktopUpdateCheckResult,
  { status: "available" }
>;

export type DesktopUpdateInstallResult =
  | { status: "installing" }
  | { status: "unavailable"; message: string }
  | { status: "manual"; message: string; detail?: string }
  | { status: "error"; message: string; detail?: string };

export type DesktopUpdateDownloadProgress = {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
};

export const UPDATE_SNOOZE_STORAGE_KEY = "anttodo.updateSnooze";
export const UPDATE_SNOOZE_MS = 24 * 60 * 60 * 1000;
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function formatUpdateProgressLabel(
  progress: DesktopUpdateDownloadProgress | null | undefined,
): string {
  if (!progress) return "正在下载更新…";
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
  if (progress.total > 0) {
    return `正在下载更新… ${percent}%`;
  }
  return "正在下载更新…";
}

type UpdateSnoozeRecord = {
  version: string;
  until: number;
};

function readSnoozeRecord(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): UpdateSnoozeRecord | null {
  try {
    const raw = storage.getItem(UPDATE_SNOOZE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UpdateSnoozeRecord>;
    if (
      typeof parsed.version !== "string"
      || !parsed.version.trim()
      || typeof parsed.until !== "number"
      || !Number.isFinite(parsed.until)
    ) {
      return null;
    }
    return { version: parsed.version, until: parsed.until };
  } catch {
    return null;
  }
}

export function isUpdateSnoozed(
  latestVersion: string,
  now = Date.now(),
  storage: Pick<Storage, "getItem"> = window.localStorage,
): boolean {
  const record = readSnoozeRecord(storage);
  if (!record) return false;
  if (record.version !== latestVersion) return false;
  return record.until > now;
}

export function snoozeUpdate(
  latestVersion: string,
  now = Date.now(),
  durationMs = UPDATE_SNOOZE_MS,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  const record: UpdateSnoozeRecord = {
    version: latestVersion,
    until: now + durationMs,
  };
  storage.setItem(UPDATE_SNOOZE_STORAGE_KEY, JSON.stringify(record));
}

export function clearUpdateSnooze(
  storage: Pick<Storage, "removeItem"> = window.localStorage,
): void {
  storage.removeItem(UPDATE_SNOOZE_STORAGE_KEY);
}

export function shouldShowUpdatePrompt(
  result: DesktopUpdateCheckResult | null | undefined,
  now = Date.now(),
  storage: Pick<Storage, "getItem"> = window.localStorage,
): result is DesktopUpdateAvailable {
  if (!result || result.status !== "available") return false;
  return !isUpdateSnoozed(result.latestVersion, now, storage);
}
