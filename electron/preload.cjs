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
  updates: Object.freeze({
    getAppVersion: () => ipcRenderer.invoke("anttodo:app-version"),
    check: () => ipcRenderer.invoke("anttodo:check-for-update"),
    openDownload: (url) => ipcRenderer.invoke("anttodo:open-download-url", url)
  })
});
