import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  shouldShowUpdatePrompt,
  snoozeUpdate,
  UPDATE_CHECK_INTERVAL_MS,
  type DesktopUpdateAvailable,
  type DesktopUpdateCheckResult,
} from "./lib/desktopUpdate";

const VISIBILITY_CHECK_COOLDOWN_MS = 60_000;

export function useDesktopUpdateCheck() {
  const [availableUpdate, setAvailableUpdate] = useState<DesktopUpdateAvailable | null>(
    null,
  );
  const [dismissed, setDismissed] = useState(false);

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

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  function remindLater() {
    if (!availableUpdate) return;
    snoozeUpdate(availableUpdate.latestVersion);
    setDismissed(true);
  }

  async function downloadUpdate() {
    if (!availableUpdate) return;
    await window.anttodoDesktop?.updates.openDownload(availableUpdate.downloadUrl);
  }

  const visibleUpdate = !dismissed && availableUpdate && shouldShowUpdatePrompt(availableUpdate)
    ? availableUpdate
    : null;

  return {
    availableUpdate: visibleUpdate,
    remindLater,
    downloadUpdate,
  };
}

export function DesktopUpdateBanner({
  update,
  onDownload,
  onRemindLater,
}: {
  update: DesktopUpdateAvailable;
  onDownload: () => void;
  onRemindLater: () => void;
}) {
  return (
    <div className="desktop-update-banner" role="status">
      <Download size={16} aria-hidden="true" />
      <span>发现新版本 v{update.latestVersion}，建议更新以获取最新功能与修复。</span>
      <div className="desktop-update-banner-actions">
        <button type="button" className="button primary" onClick={onDownload}>
          立即更新
        </button>
        <button type="button" className="button" onClick={onRemindLater}>
          稍后提醒
        </button>
        <button
          type="button"
          className="desktop-update-banner-close"
          aria-label="关闭更新提示"
          onClick={onRemindLater}
        >
          <X size={15} />
        </button>
      </div>
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
