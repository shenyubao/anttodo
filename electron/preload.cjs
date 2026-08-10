const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("anttodoDesktop", {
  platform: process.platform,
  versions: Object.freeze({
    electron: process.versions.electron,
    chrome: process.versions.chrome
  }),
  windowControls: Object.freeze({
    close: () => ipcRenderer.send("anttodo:window-close"),
    minimize: () => ipcRenderer.send("anttodo:window-minimize"),
    toggleFullScreen: () => ipcRenderer.send("anttodo:window-toggle-full-screen")
  }),
  auth: Object.freeze({
    openDingtalkUrl: (url) => ipcRenderer.invoke("anttodo:auth-open-dingtalk", url),
    takePendingCallback: () => ipcRenderer.invoke("anttodo:auth-take-pending"),
    onCallbackAvailable: (listener) => {
      const handler = () => listener();
      ipcRenderer.on("anttodo:auth-callback-available", handler);
      return () => ipcRenderer.removeListener("anttodo:auth-callback-available", handler);
    }
  }),
  reminders: Object.freeze({
    sync: (entries) => ipcRenderer.invoke("anttodo:reminders-sync", entries),
    acknowledge: (reminderId) => ipcRenderer.send("anttodo:reminders-acknowledge", reminderId),
    onOpenTask: (listener) => {
      const handler = (_event, target) => listener(target);
      ipcRenderer.on("anttodo:reminder-open-task", handler);
      return () => ipcRenderer.removeListener("anttodo:reminder-open-task", handler);
    }
  }),
  notifications: Object.freeze({
    show: (payload) => ipcRenderer.invoke("anttodo:notifications-show", payload)
  }),

  updates: Object.freeze({
    getAppVersion: () => ipcRenderer.invoke("anttodo:app-version"),
    check: () => ipcRenderer.invoke("anttodo:check-for-update"),
    openDownload: (url) => ipcRenderer.invoke("anttodo:open-download-url", url),
    downloadAndInstall: () => ipcRenderer.invoke("anttodo:download-and-install-update"),
    onDownloadProgress: (listener) => {
      const handler = (_event, progress) => listener(progress);
      ipcRenderer.on("anttodo:update-download-progress", handler);
      return () => ipcRenderer.removeListener("anttodo:update-download-progress", handler);
    },
    onDownloadError: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on("anttodo:update-download-error", handler);
      return () => ipcRenderer.removeListener("anttodo:update-download-error", handler);
    }
  }),
  aiWork: Object.freeze({
    selectDirectory: () => ipcRenderer.invoke("anttodo:ai-select-directory"),
    terminal: Object.freeze({
      start: (input) => ipcRenderer.invoke("anttodo:ai-terminal-start", input),
      write: (sessionId, data) =>
        ipcRenderer.invoke("anttodo:ai-terminal-write", sessionId, data),
      resize: (sessionId, cols, rows) =>
        ipcRenderer.invoke("anttodo:ai-terminal-resize", sessionId, cols, rows),
      stop: (sessionId) => ipcRenderer.invoke("anttodo:ai-terminal-stop", sessionId),
      onData: (sessionId, listener) => {
        const handler = (_event, payload) => {
          if (payload?.sessionId === sessionId) listener(payload.data);
        };
        ipcRenderer.on("anttodo:ai-terminal-data", handler);
        return () => ipcRenderer.removeListener("anttodo:ai-terminal-data", handler);
      },
      onExit: (sessionId, listener) => {
        const handler = (_event, payload) => {
          if (payload?.sessionId === sessionId) listener(payload);
        };
        ipcRenderer.on("anttodo:ai-terminal-exit", handler);
        return () => ipcRenderer.removeListener("anttodo:ai-terminal-exit", handler);
      }
    })
  }),
  tray: Object.freeze({
    setAuthenticated: (value) => ipcRenderer.send("anttodo:tray-set-authenticated", value),
    setTitle: (title) => ipcRenderer.send("anttodo:tray-set-title", title),
    hide: () => ipcRenderer.send("anttodo:tray-hide"),
    setIgnoreBlur: (value) => ipcRenderer.send("anttodo:tray-ignore-blur", value),
    showMainWindow: () => ipcRenderer.send("anttodo:tray-show-main"),
    openSettings: () => ipcRenderer.send("anttodo:tray-open-settings"),
    openTask: (target) => ipcRenderer.send("anttodo:tray-open-task", target),
    onOpenSettings: (listener) => {
      const handler = () => listener();
      ipcRenderer.on("anttodo:open-settings", handler);
      return () => ipcRenderer.removeListener("anttodo:open-settings", handler);
    },
    onOpenTask: (listener) => {
      const handler = (_event, target) => listener(target);
      ipcRenderer.on("anttodo:open-task", handler);
      return () => ipcRenderer.removeListener("anttodo:open-task", handler);
    }
  })
});
