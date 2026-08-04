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
import { createReminderScheduler } from "./reminder-scheduler.mjs";
import {
  checkForDesktopUpdate,
  isAllowedDownloadUrl,
} from "./update-checker.mjs";
import { createAiTerminalManager } from "./ai-terminal.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const authCallbackQueue = createAuthCallbackQueue(5);
let mainWindow = null;
let isQuitting = false;

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

const reminderScheduler = createReminderScheduler({
  show: (entry, acknowledge) => {
    if (!Notification.isSupported()) {
      mainWindow?.webContents.send("anttodo:reminder-failed", entry.id, "unsupported");
      return;
    }
    const notification = new Notification({ title: entry.title, body: entry.body });
    notification.once("show", () => {
      mainWindow?.webContents.send("anttodo:reminder-shown", entry.id);
    });
    notification.once("click", () => {
      acknowledge();
      restoreMainWindow();
      mainWindow?.webContents.send("anttodo:reminder-open-task", {
        workspaceId: entry.workspaceId,
        taskId: entry.taskId,
      });
    });
    notification.once("close", acknowledge);
    notification.once("failed", (_event, error) => {
      mainWindow?.webContents.send("anttodo:reminder-failed", entry.id, error);
    });
    notification.show();
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

app.on("open-url", (event, url) => {
  event.preventDefault();
  receiveAuthDeepLink(url);
});

app.on("second-instance", (_event, commandLine) => {
  const deepLink = commandLine.find((arg) => arg.startsWith(AUTH_DEEP_LINK_PREFIX));
  if (deepLink) receiveAuthDeepLink(deepLink);
  else if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

function windowForEvent(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

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
  if (typeof url !== "string" || !isAllowedDingtalkExternalUrl(url)) return false;
  await shell.openExternal(url);
  return true;
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

ipcMain.handle("anttodo:app-version", () => app.getVersion());

ipcMain.handle("anttodo:check-for-update", async () => {
  return checkForDesktopUpdate({ currentVersion: app.getVersion() });
});

ipcMain.handle("anttodo:open-download-url", async (_event, url) => {
  if (typeof url !== "string" || !isAllowedDownloadUrl(url)) return false;
  await shell.openExternal(url);
  return true;
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
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    ...(isMac ? { titleBarStyle: "hidden" } : {}),
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
    if (process.platform === "darwin" && !isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => {
    aiTerminalManager.stopOwner(webContentsId);
    if (mainWindow === window) mainWindow = null;
  });
  window.webContents.on("render-process-gone", () => {
    aiTerminalManager.stopOwner(webContentsId);
  });
  window.webContents.on("did-finish-load", notifyAuthCallbackAvailable);

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

if (hasSingleInstanceLock) {
  app.whenReady().then(() => {
    createWindow();
    powerMonitor.on("resume", () => reminderScheduler.resume());
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  for (const window of BrowserWindow.getAllWindows()) {
    aiTerminalManager.stopOwner(window.webContents.id);
  }
  reminderScheduler.dispose();
});
