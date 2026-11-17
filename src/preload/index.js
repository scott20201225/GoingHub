const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  copyToClipboard: (text) => clipboard.writeText(text),
  onStatusUpdate: (callback) => {
    ipcRenderer.on('backend-status', (_event, status) => callback(status));
  }
});
