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
  })
});
