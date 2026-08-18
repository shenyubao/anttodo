import { app, BrowserWindow, dialog, ipcMain, Notification, powerMonitor, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTH_DEEP_LINK_PREFIX,
  AUTH_DEEP_LINK_SCHEME,
  createAuthCallbackQueue,
  isAllowedDingtalkExternalUrl,
  parseAuthDeepLink,
} from "./auth-deep-link.mjs";
import {
  DEEP_LINK_PREFIX,
  createDeepLinkQueue,
  parseDesktopDeepLink,
} from "./deep-link.mjs";
import { createReminderScheduler } from "./reminder-scheduler.mjs";
import {
  checkForDesktopUpdate,
  isAllowedDownloadUrl,
} from "./update-checker.mjs";
import { createDesktopAutoUpdater } from "./auto-updater.mjs";
import { createAiTerminalManager } from "./ai-terminal.mjs";
import { createTrayController } from "./tray.mjs";
import { shouldMinimizeMainWindowOnClose } from "./main-window-behavior.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const authCallbackQueue = createAuthCallbackQueue(5);
const deepLinkQueue = createDeepLinkQueue(20);
let mainWindow = null;
let isQuitting = false;
let deepLinksReady = false;
let activeServiceOrigin = "https://app.anttodo.com";
const trayController = createTrayController({
  isDev,
  restoreMainWindow: () => restoreMainWindow(),
  getMainWindow: () => mainWindow,
});

const desktopAutoUpdater = createDesktopAutoUpdater({
  isPackaged: app.isPackaged,
  platform: process.platform,
});

const aiTerminalManager = createAiTerminalManager({
  send: (ownerId, channel, payload) => {
    const target = BrowserWindow.getAllWindows()
      .find((window) => window.webContents.id === ownerId)?.webContents;
    if (target && !target.isDestroyed()) target.send(channel, payload);
  },
});

function restoreMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function isReminderEntry(value) {
  return value && typeof value.id === "string"
    && typeof value.reminderId === "string"
    && typeof value.taskId === "string"
    && typeof value.workspaceId === "string"
    && typeof value.title === "string"
    && typeof value.body === "string"
    && typeof value.triggerAt === "string";
}

function isNotificationShowPayload(value) {
  return value && typeof value.title === "string"
    && typeof value.body === "string"
    && (value.workspaceId === undefined || typeof value.workspaceId === "string")
    && (value.taskId === undefined || typeof value.taskId === "string");
}

function openTaskFromNotification(target) {
  if (!target?.workspaceId || !target?.taskId) return;
  restoreMainWindow();
  mainWindow?.webContents.send("anttodo:open-task", target);
  // Keep the legacy reminder channel for older preload listeners.
  mainWindow?.webContents.send("anttodo:reminder-open-task", target);
}

function showNativeNotification({ title, body, workspaceId, taskId }, handlers = {}) {
  if (!Notification.isSupported()) {
    handlers.onFailed?.("unsupported");
    return false;
  }
  const notification = new Notification({ title, body });
  notification.once("show", () => handlers.onShow?.());
  notification.once("click", () => {
    handlers.onClick?.();
    openTaskFromNotification({ workspaceId, taskId });
  });
  notification.once("close", () => handlers.onClose?.());
  notification.once("failed", (_event, error) => {
    handlers.onFailed?.(error);
  });
  notification.show();
  return true;
}

const reminderScheduler = createReminderScheduler({
  show: (entry, acknowledge) => {
    const shown = showNativeNotification(entry, {
      onShow: () => {
        mainWindow?.webContents.send("anttodo:reminder-shown", entry.id);
      },
      onClick: acknowledge,
      onClose: acknowledge,
      onFailed: (error) => {
        mainWindow?.webContents.send("anttodo:reminder-failed", entry.id, error);
      },
    });
    if (!shown) {
      mainWindow?.webContents.send("anttodo:reminder-failed", entry.id, "unsupported");
    }
  },
});

if (process.defaultApp && process.argv[1]) {
  app.setAsDefaultProtocolClient(
    AUTH_DEEP_LINK_SCHEME,
    process.execPath,
    [path.resolve(process.argv[1])],
  );
} else {
  app.setAsDefaultProtocolClient(AUTH_DEEP_LINK_SCHEME);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function notifyAuthCallbackAvailable() {
  if (!mainWindow || mainWindow.isDestroyed() || !authCallbackQueue.hasPending()) return;
  mainWindow.webContents.send("anttodo:auth-callback-available");
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function receiveAuthDeepLink(url) {
  const code = parseAuthDeepLink(url);
  if (!code || !authCallbackQueue.enqueue(code)) return;
  notifyAuthCallbackAvailable();
}

function dispatchPendingDeepLinks() {
  if (!deepLinksReady || !mainWindow || mainWindow.isDestroyed()) return;
  let command = deepLinkQueue.take();
  if (!command) return;
  restoreMainWindow();
  while (command) {
    mainWindow.webContents.send("anttodo:deep-link-command", command);
    command = deepLinkQueue.take();
  }
}

function receiveDesktopDeepLink(url) {
  const command = parseDesktopDeepLink(url);
  if (!command) return;
  deepLinkQueue.enqueue(command);
  dispatchPendingDeepLinks();
}

function receiveDeepLink(url) {
  if (typeof url !== "string" || !url.startsWith(DEEP_LINK_PREFIX)) return;
  if (url.startsWith(AUTH_DEEP_LINK_PREFIX)) {
    receiveAuthDeepLink(url);
    return;
  }
  receiveDesktopDeepLink(url);
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  receiveDeepLink(url);
});

app.on("second-instance", (_event, commandLine) => {
  const deepLinks = commandLine.filter((arg) => arg.startsWith(DEEP_LINK_PREFIX));
  if (deepLinks.length > 0) {
    for (const deepLink of deepLinks) receiveDeepLink(deepLink);
  } else if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

function windowForEvent(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

ipcMain.on("anttodo:deep-links-ready", (event) => {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) return;
  deepLinksReady = true;
  dispatchPendingDeepLinks();
});

ipcMain.on("anttodo:window-close", (event) => {
  windowForEvent(event)?.close();
});

ipcMain.on("anttodo:window-minimize", (event) => {
  windowForEvent(event)?.minimize();
});

ipcMain.on("anttodo:window-toggle-full-screen", (event) => {
  const window = windowForEvent(event);
  if (window) window.setFullScreen(!window.isFullScreen());
});

ipcMain.handle("anttodo:auth-open-dingtalk", async (_event, url) => {
  if (typeof url !== "string" || !isAllowedDingtalkExternalUrl(url, activeServiceOrigin, isDev)) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle("anttodo:auth-set-service-origin", (_event, value) => {
  try {
    const url = new URL(value);
    const localHttp = isDev
      && url.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !localHttp) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash
    ) return false;
    activeServiceOrigin = url.origin;
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("anttodo:auth-take-pending", () => authCallbackQueue.take());

ipcMain.handle("anttodo:reminders-sync", (_event, entries) => {
  if (!Array.isArray(entries) || !entries.every(isReminderEntry)) return false;
  reminderScheduler.sync(entries.slice(0, 500));
  return true;
});

ipcMain.on("anttodo:reminders-acknowledge", (_event, reminderId) => {
  if (typeof reminderId === "string") reminderScheduler.acknowledge(reminderId);
});

ipcMain.handle("anttodo:notifications-show", (_event, payload) => {
  if (!isNotificationShowPayload(payload)) return false;
  return showNativeNotification({
    title: payload.title,
    body: payload.body,
    workspaceId: payload.workspaceId,
    taskId: payload.taskId,
  });
});

ipcMain.handle("anttodo:app-version", () => app.getVersion());

ipcMain.handle("anttodo:check-for-update", async () => {
  return checkForDesktopUpdate({ currentVersion: app.getVersion() });
});

ipcMain.handle("anttodo:open-download-url", async (_event, url) => {
  if (typeof url !== "string" || !isAllowedDownloadUrl(url)) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle("anttodo:download-and-install-update", async () => {
  return desktopAutoUpdater.downloadAndInstall();
});

ipcMain.handle("anttodo:ai-select-directory", async (event) => {
  const owner = windowForEvent(event);
  if (!owner) return null;
  const result = await dialog.showOpenDialog(owner, {
    title: "选择 AI 助理默认工作路径",
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle("anttodo:ai-terminal-start", (event, input) =>
  aiTerminalManager.start(event.sender.id, input));
ipcMain.handle("anttodo:ai-terminal-write", (event, sessionId, data) =>
  aiTerminalManager.write(sessionId, event.sender.id, data));
ipcMain.handle("anttodo:ai-terminal-resize", (event, sessionId, cols, rows) =>
  aiTerminalManager.resize(sessionId, event.sender.id, cols, rows));
ipcMain.handle("anttodo:ai-terminal-stop", (event, sessionId) =>
  aiTerminalManager.stop(sessionId, event.sender.id));

function createWindow() {
  const isMac = process.platform === "darwin";
  deepLinksReady = false;
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    // Keep the main window in macOS window switchers. The tray popover below
    // is the only window that should be excluded from them.
    skipTaskbar: false,
    ...(isMac
      ? {
          // System traffic-light spacing cannot be tightened; hide and draw compact
          // controls (TickTick-style) in the renderer instead.
          titleBarStyle: "hidden",
        }
      : {}),
    backgroundColor: "#f6f7f9",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const webContentsId = window.webContents.id;
  mainWindow = window;
  window.on("close", (event) => {
    if (shouldMinimizeMainWindowOnClose({ platform: process.platform, isQuitting })) {
      event.preventDefault();
      // Do not hide the window: hidden windows disappear from some Option-Tab
      // switchers. Minimized regular windows remain discoverable and restore
      // cleanly when selected there.
      window.minimize();
    }
  });
  window.on("closed", () => {
    aiTerminalManager.stopOwner(webContentsId);
    if (mainWindow === window) mainWindow = null;
  });
  window.webContents.on("render-process-gone", () => {
    aiTerminalManager.stopOwner(webContentsId);
  });
  window.webContents.on("did-start-loading", () => {
    if (mainWindow === window) deepLinksReady = false;
  });
  window.webContents.on("did-finish-load", () => {
    notifyAuthCallbackAvailable();
    dispatchPendingDeepLinks();
  });

  if (isMac) window.setWindowButtonVisibility(false);

  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const protocol = new URL(url).protocol;
      if (["http:", "https:", "mailto:"].includes(protocol)) {
        void shell.openExternal(url);
      }
    } catch {
      // Invalid and application-private URLs stay inside AntTodo.
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const allowed = isDev
      ? url.startsWith("http://127.0.0.1:5173")
      : url.startsWith("file://");
    if (!allowed) event.preventDefault();
  });

  if (isDev) {
    void window.loadURL("http://127.0.0.1:5173");
  } else {
    void window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

function setMacDockIcon() {
  if (process.platform !== "darwin" || !app.dock) return;

  // electron . does not have an app bundle whose Info.plist can provide the
  // product icon. Set it explicitly in both development and packaged builds
  // so the Dock and Command-Tab always use AntTodo's icon.
  app.dock.setIcon(path.join(__dirname, "../build/icon.png"));
}

if (hasSingleInstanceLock) {
  app.whenReady().then(() => {
    // macOS delivers protocol launches through `open-url`; argv is used only
    // by non-macOS launchers to cover cold-start protocol arguments.
    if (process.platform !== "darwin") {
      for (const arg of process.argv) receiveDeepLink(arg);
    }
    setMacDockIcon();
    createWindow();
    trayController.start();
    powerMonitor.on("resume", () => reminderScheduler.resume());
    app.on("activate", () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
        return;
      }
      restoreMainWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  trayController.dispose();
  for (const window of BrowserWindow.getAllWindows()) {
    aiTerminalManager.stopOwner(window.webContents.id);
  }
  reminderScheduler.dispose();
});
