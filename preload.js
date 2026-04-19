const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vmsApi', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  getDesktopPath: () => ipcRenderer.invoke('paths:desktop'),
  probeMedia: (filePath) => ipcRenderer.invoke('media:probe', filePath),
  openVideoDialog: () => ipcRenderer.invoke('dialog:openVideo'),
  openInputFolderDialog: () => ipcRenderer.invoke('dialog:openInputFolder'),
  expandInputPaths: (paths) => ipcRenderer.invoke('input:expandPaths', paths),
  openDirDialog: () => ipcRenderer.invoke('dialog:openDir'),
  showInFolder: (fullPath) => ipcRenderer.invoke('shell:showItem', fullPath),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installDownloadedUpdate: () => ipcRenderer.invoke('update:install'),
  startJob: (payload) => ipcRenderer.invoke('job:start', payload),
  cancelJob: () => ipcRenderer.invoke('job:cancel'),
  onProgress: (fn) => {
    const ch = (_e, data) => fn(data);
    ipcRenderer.on('job:progress', ch);
    return () => ipcRenderer.removeListener('job:progress', ch);
  },
  onStage: (fn) => {
    const ch = (_e, data) => fn(data);
    ipcRenderer.on('job:stage', ch);
    return () => ipcRenderer.removeListener('job:stage', ch);
  },
  onUpdateStatus: (fn) => {
    const ch = (_e, data) => fn(data);
    ipcRenderer.on('update:status', ch);
    return () => ipcRenderer.removeListener('update:status', ch);
  }
});
