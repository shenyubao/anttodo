import { describe, expect, it, vi } from "vitest";
import {
  createDesktopAutoUpdater,
  formatDesktopUpdateError,
  formatDesktopUpdateErrorDetail,
  isDesktopUpdateLocationError,
  isMissingDesktopUpdateConfigError,
  isAllowedUpdateFeedUrl,
  requiresManualDesktopUpdate,
  UPDATE_FEED_URL,
} from "./auto-updater.mjs";

describe("desktop auto updater helpers", () => {
  it("allows only the configured https update host", () => {
    expect(isAllowedUpdateFeedUrl(UPDATE_FEED_URL)).toBe(true);
    expect(isAllowedUpdateFeedUrl(`${UPDATE_FEED_URL}/`)).toBe(true);
    expect(isAllowedUpdateFeedUrl("http://anttodo-yuce.oss-cn-hangzhou.aliyuncs.com/release/macos")).toBe(false);
    expect(isAllowedUpdateFeedUrl("https://evil.example/release/macos")).toBe(false);
  });

  it("maps install-location failures to a clear Chinese message", () => {
    const locationError = new Error("Cannot update while running on a read-only volume");
    expect(isDesktopUpdateLocationError(locationError)).toBe(true);
    expect(formatDesktopUpdateError(locationError)).toBe(
      "macOS 阻止了应用内替换，请下载安装包重新安装",
    );
    expect(formatDesktopUpdateError(new Error("Please move the app into Applications"))).toBe(
      "请先将蚂蚁清单安装到「应用程序」文件夹后再更新",
    );
    expect(formatDesktopUpdateError(new Error("network timeout"))).toBe("network timeout");
    expect(formatDesktopUpdateError(new Error(""))).toBe("更新失败，请稍后重试");
    expect(formatDesktopUpdateErrorDetail(Object.assign(new Error("network timeout"), {
      code: "ETIMEDOUT",
    }))).toContain("code=ETIMEDOUT");
  });

  it("falls back to the installer when the packaged updater config is missing", () => {
    const missingConfig = Object.assign(
      new Error("ENOENT: no such file or directory, open '/Applications/蚂蚁清单.app/Contents/Resources/app-update.yml'"),
      { code: "ENOENT" },
    );
    expect(isMissingDesktopUpdateConfigError(missingConfig)).toBe(true);
    expect(requiresManualDesktopUpdate(missingConfig)).toBe(true);
    expect(formatDesktopUpdateError(missingConfig)).toBe(
      "当前版本无法应用内升级，已为你打开最新安装包",
    );
    expect(isMissingDesktopUpdateConfigError(
      Object.assign(new Error("ENOENT: missing task.json"), { code: "ENOENT" }),
    )).toBe(false);
  });

  it("reports unavailable outside packaged macOS builds", async () => {
    const updater = createDesktopAutoUpdater({
      isPackaged: false,
      platform: "darwin",
    });
    expect(updater.canInstallInApp()).toBe(false);
    await expect(updater.downloadAndInstall()).resolves.toEqual({
      status: "unavailable",
      message: "应用内更新仅在已安装的 macOS 桌面客户端中可用",
    });
  });

  it("downloads and installs when an update is available", async () => {
    const quitAndInstall = vi.fn();
    const downloadUpdate = vi.fn(async () => undefined);
    const checkForUpdates = vi.fn(async () => ({
      updateInfo: { version: "1.2.3" },
      cancellationToken: {},
    }));
    const on = vi.fn();
    const setFeedURL = vi.fn();
    const broadcast = vi.fn();

    const updater = createDesktopAutoUpdater({
      isPackaged: true,
      platform: "darwin",
      broadcast,
      loadUpdater: () => ({
        autoUpdater: {
          autoDownload: true,
          autoInstallOnAppQuit: false,
          setFeedURL,
          on,
          checkForUpdates,
          downloadUpdate,
          quitAndInstall,
        },
      }),
    });

    expect(updater.canInstallInApp()).toBe(true);
    await expect(updater.downloadAndInstall()).resolves.toEqual({ status: "installing" });
    expect(setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: UPDATE_FEED_URL,
    });
    expect(checkForUpdates).toHaveBeenCalledOnce();
    expect(downloadUpdate).toHaveBeenCalledOnce();
    expect(broadcast).toHaveBeenCalledWith(
      "anttodo:update-download-progress",
      expect.objectContaining({ percent: 0 }),
    );

    await new Promise((resolve) => setImmediate(resolve));
    expect(quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("surfaces updater errors to the caller", async () => {
    const updater = createDesktopAutoUpdater({
      isPackaged: true,
      platform: "darwin",
      broadcast: vi.fn(),
      loadUpdater: () => ({
        autoUpdater: {
          autoDownload: true,
          autoInstallOnAppQuit: false,
          setFeedURL: vi.fn(),
          on: vi.fn(),
          checkForUpdates: vi.fn(async () => {
            throw new Error("Cannot update while running from dmg");
          }),
          downloadUpdate: vi.fn(),
          quitAndInstall: vi.fn(),
        },
      }),
    });

    await expect(updater.downloadAndInstall()).resolves.toEqual({
      status: "manual",
      message: "macOS 阻止了应用内替换，请下载安装包重新安装",
      detail: expect.stringContaining("Cannot update while running from dmg"),
    });
  });

  it("uses manual installation when app-update.yml is absent", async () => {
    const missingConfig = Object.assign(
      new Error("ENOENT: no such file or directory, open '/Applications/蚂蚁清单.app/Contents/Resources/app-update.yml'"),
      { code: "ENOENT" },
    );
    const updater = createDesktopAutoUpdater({
      isPackaged: true,
      platform: "darwin",
      broadcast: vi.fn(),
      loadUpdater: () => ({
        autoUpdater: {
          autoDownload: true,
          autoInstallOnAppQuit: false,
          setFeedURL: vi.fn(),
          on: vi.fn(),
          checkForUpdates: vi.fn(async () => {
            throw missingConfig;
          }),
          downloadUpdate: vi.fn(),
          quitAndInstall: vi.fn(),
        },
      }),
    });

    await expect(updater.downloadAndInstall()).resolves.toEqual({
      status: "manual",
      message: "当前版本无法应用内升级，已为你打开最新安装包",
      detail: expect.stringContaining("code=ENOENT"),
    });
  });
});
