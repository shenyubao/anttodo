import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  formatUpdateProgressLabel,
  shouldShowUpdatePrompt,
  snoozeUpdate,
  UPDATE_CHECK_INTERVAL_MS,
  type DesktopUpdateAvailable,
  type DesktopUpdateCheckResult,
  type DesktopUpdateDownloadProgress,
} from "./lib/desktopUpdate";

const VISIBILITY_CHECK_COOLDOWN_MS = 60_000;

export function useDesktopUpdateCheck() {
  const [availableUpdate, setAvailableUpdate] = useState<DesktopUpdateAvailable | null>(
    null,
  );
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<DesktopUpdateDownloadProgress | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.anttodoDesktop?.updates) return;
    const desktopUpdates = window.anttodoDesktop.updates;

    let cancelled = false;
    let intervalId = 0;
    let lastCheckAt = 0;

    async function runCheck(force = false) {
      const now = Date.now();
      if (!force && now - lastCheckAt < VISIBILITY_CHECK_COOLDOWN_MS) return;
      lastCheckAt = now;
      try {
        const result = await desktopUpdates.check();
        if (cancelled) return;
        if (result.status === "available") {
          setAvailableUpdate(result);
          setDismissed(!shouldShowUpdatePrompt(result));
        } else {
          setAvailableUpdate(null);
          setDismissed(false);
        }
      } catch {
        // Network or IPC failures stay silent for the background banner.
      }
    }

    void runCheck(true);
    intervalId = window.setInterval(() => {
      void runCheck(true);
    }, UPDATE_CHECK_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void runCheck(false);
    };
    document.addEventListener("visibilitychange", onVisibility);

    const unsubscribeProgress = desktopUpdates.onDownloadProgress?.((next) => {
      if (!cancelled) {
        setProgress(next);
        setInstalling(true);
        setInstallError(null);
      }
    });
    const unsubscribeError = desktopUpdates.onDownloadError?.((payload) => {
      if (!cancelled) {
        setInstalling(false);
        setProgress(null);
        setInstallError(payload.message || "更新失败，请稍后重试");
      }
    });

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribeProgress?.();
      unsubscribeError?.();
    };
  }, []);

  function remindLater() {
    if (!availableUpdate) return;
    snoozeUpdate(availableUpdate.latestVersion);
    setDismissed(true);
    setInstallError(null);
  }

  async function downloadUpdate() {
    if (!availableUpdate || !window.anttodoDesktop?.updates) return;
    setInstalling(true);
    setInstallError(null);
    setProgress({ percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 });

    try {
      const result = await window.anttodoDesktop.updates.downloadAndInstall();
      if (result.status === "installing") {
        setProgress((current) => current ?? {
          percent: 100,
          transferred: 0,
          total: 0,
          bytesPerSecond: 0,
        });
        return;
      }
      if (result.status === "unavailable") {
        await window.anttodoDesktop.updates.openDownload(availableUpdate.downloadUrl);
        setInstalling(false);
        setProgress(null);
        return;
      }
      setInstallError(result.message);
      setInstalling(false);
      setProgress(null);
    } catch {
      setInstallError("更新失败，请稍后重试");
      setInstalling(false);
      setProgress(null);
    }
  }

  const visibleUpdate = !dismissed && availableUpdate && shouldShowUpdatePrompt(availableUpdate)
    ? availableUpdate
    : null;

  return {
    availableUpdate: visibleUpdate,
    remindLater,
    downloadUpdate,
    installing,
    progress,
    installError,
  };
}

export function DesktopUpdateBanner({
  update,
  onDownload,
  onRemindLater,
  installing = false,
  progress = null,
  installError = null,
}: {
  update: DesktopUpdateAvailable;
  onDownload: () => void;
  onRemindLater: () => void;
  installing?: boolean;
  progress?: DesktopUpdateDownloadProgress | null;
  installError?: string | null;
}) {
  const message = installError
    ? installError
    : installing
      ? formatUpdateProgressLabel(progress)
      : `发现新版本 v${update.latestVersion}，建议更新以获取最新功能与修复。`;

  return (
    <div className="desktop-update-banner" role="status">
      <Download size={16} aria-hidden="true" />
      <span>{message}</span>
      <div className="desktop-update-banner-actions">
        {!installing ? (
          <button type="button" className="button primary" onClick={onDownload}>
            {installError ? "重试更新" : "立即更新"}
          </button>
        ) : null}
        <button
          type="button"
          className="button"
          onClick={onRemindLater}
          disabled={installing && !installError}
        >
          稍后提醒
        </button>
        <button
          type="button"
          className="desktop-update-banner-close"
          aria-label="关闭更新提示"
          onClick={onRemindLater}
          disabled={installing && !installError}
        >
          <X size={15} />
        </button>
      </div>
      {installing && !installError ? (
        <div
          className="desktop-update-banner-progress"
          aria-hidden="true"
        >
          <div
            className="desktop-update-banner-progress-bar"
            style={{ width: `${Math.max(4, Math.min(100, Math.round(progress?.percent ?? 0)))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function formatUpdateCheckMessage(result: DesktopUpdateCheckResult): string {
  if (result.status === "available") {
    return `发现新版本 v${result.latestVersion}`;
  }
  if (result.status === "up-to-date") {
    return "当前已是最新版本";
  }
  return result.message;
}
