import { createRequire } from "node:module";
import { DOWNLOAD_HOST } from "./update-checker.mjs";

const require = createRequire(import.meta.url);

export const UPDATE_FEED_URL =
  "https://anttodo-yuce.oss-cn-hangzhou.aliyuncs.com/release/macos";

/**
 * @param {unknown} error
 * @returns {string}
 */
export function formatDesktopUpdateError(error) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const normalized = raw.toLowerCase();
  if (
    normalized.includes("applications")
    || normalized.includes("read-only")
    || normalized.includes("dmg")
    || normalized.includes("volume")
  ) {
    return "请先将蚂蚁清单安装到「应用程序」文件夹后再更新";
  }
  if (!raw.trim()) return "更新失败，请稍后重试";
  return raw;
}

/**
 * @param {string | undefined} url
 * @returns {boolean}
 */
export function isAllowedUpdateFeedUrl(url) {
  if (typeof url !== "string" || !url.trim()) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === DOWNLOAD_HOST;
  } catch {
    return false;
  }
}

/**
 * @param {string} channel
 * @param {unknown} payload
 */
function broadcastToWindows(channel, payload) {
  const { BrowserWindow } = require("electron");
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

/**
 * @param {{
 *   isPackaged?: boolean,
 *   platform?: NodeJS.Platform,
 *   feedUrl?: string,
 *   loadUpdater?: () => { autoUpdater: import("electron-updater").AppUpdater },
 *   broadcast?: (channel: string, payload: unknown) => void,
 * }} [options]
 */
export function createDesktopAutoUpdater(options = {}) {
  const isPackaged = options.isPackaged ?? false;
  const platform = options.platform ?? process.platform;
  const feedUrl = options.feedUrl ?? UPDATE_FEED_URL;
  const broadcast = options.broadcast ?? broadcastToWindows;

  /** @type {import("electron-updater").AppUpdater | null} */
  let autoUpdater = null;
  let downloading = false;
  let listenersBound = false;

  function canInstallInApp() {
    return isPackaged && platform === "darwin" && isAllowedUpdateFeedUrl(feedUrl);
  }

  function getAutoUpdater() {
    if (!canInstallInApp()) return null;
    if (autoUpdater) return autoUpdater;

    const loaded = options.loadUpdater
      ? options.loadUpdater()
      : require("electron-updater");
    const updater = loaded.autoUpdater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    updater.setFeedURL({ provider: "generic", url: feedUrl });

    if (!listenersBound) {
      listenersBound = true;
      updater.on("download-progress", (progress) => {
        broadcast("anttodo:update-download-progress", {
          percent: Number(progress.percent) || 0,
          transferred: Number(progress.transferred) || 0,
          total: Number(progress.total) || 0,
          bytesPerSecond: Number(progress.bytesPerSecond) || 0,
        });
      });
      updater.on("error", (error) => {
        broadcast("anttodo:update-download-error", {
          message: formatDesktopUpdateError(error),
        });
      });
    }

    autoUpdater = updater;
    return autoUpdater;
  }

  /**
   * @returns {Promise<
   *   | { status: "installing" }
   *   | { status: "unavailable", message: string }
   *   | { status: "error", message: string }
   * >}
   */
  async function downloadAndInstall() {
    const updater = getAutoUpdater();
    if (!updater) {
      return {
        status: "unavailable",
        message: "应用内更新仅在已安装的 macOS 桌面客户端中可用",
      };
    }
    if (downloading) {
      return { status: "error", message: "正在下载更新，请稍候" };
    }

    downloading = true;
    broadcast("anttodo:update-download-progress", {
      percent: 0,
      transferred: 0,
      total: 0,
      bytesPerSecond: 0,
    });

    try {
      const check = await updater.checkForUpdates();
      if (!check?.updateInfo) {
        return { status: "error", message: "未找到可用更新" };
      }

      await updater.downloadUpdate(check.cancellationToken);
      // isSilent=false, isForceRunAfter=true — restart into the new version.
      setImmediate(() => {
        try {
          updater.quitAndInstall(false, true);
        } catch (error) {
          broadcast("anttodo:update-download-error", {
            message: formatDesktopUpdateError(error),
          });
        }
      });
      return { status: "installing" };
    } catch (error) {
      return { status: "error", message: formatDesktopUpdateError(error) };
    } finally {
      downloading = false;
    }
  }

  return {
    canInstallInApp,
    downloadAndInstall,
  };
}
