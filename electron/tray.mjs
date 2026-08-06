import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { BrowserWindow, Tray, ipcMain, nativeImage, screen } = require("electron");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TRAY_WIDTH = 320;
const TRAY_HEIGHT = 560;
const TRAY_GAP = 6;
/** Keep the popover open through the tray-click focus churn on macOS. */
const SHOW_BLUR_GRACE_MS = 500;

/**
 * @param {{
 *   isDev: boolean;
 *   restoreMainWindow: () => void;
 *   getMainWindow: () => import("electron").BrowserWindow | null;
 * }} options
 */
export function createTrayController({ isDev, restoreMainWindow, getMainWindow }) {
  /** @type {import("electron").Tray | null} */
  let tray = null;
  /** @type {import("electron").BrowserWindow | null} */
  let trayWindow = null;
  let ignoreBlur = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let blurGraceTimer = null;
  let authenticated = false;
  let ipcRegistered = false;

  function loadTrayIcon() {
    const candidates = [
      path.join(__dirname, "assets/trayTemplate.png"),
      path.join(__dirname, "assets/trayTemplate@2x.png"),
      path.join(__dirname, "../build/icon.png"),
    ];
    for (const candidate of candidates) {
      const image = nativeImage.createFromPath(candidate);
      if (image.isEmpty()) continue;
      const sized = image.getSize().width > 22
        ? image.resize({ width: 18, height: 18 })
        : image;
      sized.setTemplateImage(true);
      return sized;
    }
    // 16x16 black square fallback so the status item is always clickable.
    const fallback = nativeImage.createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAEUlEQVR42mP8z8BQz0BFwGgAAH4AAf8xZq8AAAAASUVORK5CYII=",
    );
    fallback.setTemplateImage(true);
    return fallback;
  }

  function trayUrl() {
    if (isDev) return "http://127.0.0.1:5173/#/tray";
    return `file://${path.join(__dirname, "../dist/index.html")}#/tray`;
  }

  function clearBlurGrace() {
    if (blurGraceTimer) {
      clearTimeout(blurGraceTimer);
      blurGraceTimer = null;
    }
  }

  function beginBlurGrace() {
    ignoreBlur = true;
    clearBlurGrace();
    blurGraceTimer = setTimeout(() => {
      ignoreBlur = false;
      blurGraceTimer = null;
    }, SHOW_BLUR_GRACE_MS);
  }

  function createTrayWindow() {
    if (trayWindow && !trayWindow.isDestroyed()) {
      trayWindow.setSize(TRAY_WIDTH, TRAY_HEIGHT);
      return trayWindow;
    }

    const window = new BrowserWindow({
      width: TRAY_WIDTH,
      height: TRAY_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      movable: false,
      hasShadow: true,
      transparent: false,
      backgroundColor: "#ffffff",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setAlwaysOnTop(true, "floating");

    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      const allowed = isDev
        ? url.startsWith("http://127.0.0.1:5173")
        : url.startsWith("file://");
      if (!allowed) event.preventDefault();
    });

    window.on("blur", () => {
      if (ignoreBlur || !window.isVisible()) return;
      hideTrayWindow();
    });

    window.on("closed", () => {
      if (trayWindow === window) trayWindow = null;
    });

    if (isDev) {
      void window.loadURL(trayUrl());
    } else {
      void window.loadFile(path.join(__dirname, "../dist/index.html"), {
        hash: "/tray",
      });
    }

    trayWindow = window;
    return window;
  }

  /**
   * @param {{ x: number; y: number; width: number; height: number } | null} [clickBounds]
   */
  function positionTrayWindow(window, clickBounds = null) {
    const trayBounds = clickBounds && clickBounds.width > 0
      ? clickBounds
      : tray?.getBounds();
    const cursor = screen.getCursorScreenPoint();
    const hasTrayBounds = Boolean(
      trayBounds && trayBounds.width > 0 && trayBounds.height > 0,
    );
    const anchorX = hasTrayBounds
      ? trayBounds.x + trayBounds.width / 2
      : cursor.x;
    const anchorY = hasTrayBounds
      ? trayBounds.y + trayBounds.height
      : cursor.y;
    const display = screen.getDisplayNearestPoint({
      x: Math.round(anchorX),
      y: Math.round(anchorY),
    });
    const work = display.workArea;
    let x = Math.round(anchorX - TRAY_WIDTH / 2);
    let y = Math.round(anchorY + TRAY_GAP);
    // Menu bar is at the top; if the tray reports a lower y, open upward.
    if (process.platform === "darwin" && hasTrayBounds && trayBounds.y > work.y + 80) {
      y = Math.round(trayBounds.y - TRAY_HEIGHT - TRAY_GAP);
    }
    x = Math.min(Math.max(x, work.x + 8), work.x + work.width - TRAY_WIDTH - 8);
    y = Math.min(Math.max(y, work.y + 8), work.y + work.height - TRAY_HEIGHT - 8);
    window.setPosition(x, y, false);
  }

  function hideTrayWindow() {
    clearBlurGrace();
    ignoreBlur = false;
    if (!trayWindow || trayWindow.isDestroyed()) return;
    trayWindow.hide();
  }

  /**
   * @param {{ x: number; y: number; width: number; height: number } | null} [clickBounds]
   */
  function showTrayWindow(clickBounds = null) {
    const window = createTrayWindow();
    positionTrayWindow(window, clickBounds);
    beginBlurGrace();
    if (!window.isVisible()) window.show();
    window.focus();
  }

  /**
   * @param {{ x: number; y: number; width: number; height: number } | null} [clickBounds]
   */
  function toggleTrayWindow(clickBounds = null) {
    const window = createTrayWindow();
    if (window.isVisible()) {
      hideTrayWindow();
      return;
    }
    // Always show the popover. Unauthenticated users are redirected by TrayApp.
    showTrayWindow(clickBounds);
  }

  function openSettingsInMain() {
    restoreMainWindow();
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send("anttodo:open-settings");
    }
    hideTrayWindow();
  }

  /**
   * @param {{ workspaceId: string; taskId: string }} target
   */
  function openTaskInMain(target) {
    restoreMainWindow();
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send("anttodo:open-task", target);
    }
    hideTrayWindow();
  }

  function registerIpc() {
    if (ipcRegistered) return;
    ipcRegistered = true;
    ipcMain.on("anttodo:tray-set-authenticated", (_event, value) => {
      authenticated = Boolean(value);
    });
    ipcMain.on("anttodo:tray-hide", () => {
      hideTrayWindow();
    });
    ipcMain.on("anttodo:tray-ignore-blur", (_event, value) => {
      ignoreBlur = Boolean(value);
      if (value) clearBlurGrace();
    });
    ipcMain.on("anttodo:tray-show-main", () => {
      restoreMainWindow();
      hideTrayWindow();
    });
    ipcMain.on("anttodo:tray-open-settings", () => {
      openSettingsInMain();
    });
    ipcMain.on("anttodo:tray-open-task", (_event, target) => {
      if (
        target
        && typeof target.workspaceId === "string"
        && typeof target.taskId === "string"
      ) {
        openTaskInMain(target);
      }
    });
  }

  function start() {
    if (process.platform !== "darwin") return;
    registerIpc();
    if (tray) return;
    tray = new Tray(loadTrayIcon());
    tray.setToolTip("蚂蚁清单");
    tray.setIgnoreDoubleClickEvents(true);
    tray.on("click", (_event, bounds) => {
      toggleTrayWindow(bounds);
    });
    // Preload the tray surface so the first click feels instant.
    createTrayWindow();
  }

  function dispose() {
    hideTrayWindow();
    if (trayWindow && !trayWindow.isDestroyed()) {
      trayWindow.destroy();
      trayWindow = null;
    }
    if (tray) {
      tray.destroy();
      tray = null;
    }
  }

  return {
    start,
    dispose,
    hide: hideTrayWindow,
    setAuthenticated(value) {
      authenticated = Boolean(value);
    },
  };
}
