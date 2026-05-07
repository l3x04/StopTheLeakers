const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  systemStatus: () => ipcRenderer.invoke('system:status'),
  pickInput: () => ipcRenderer.invoke('dialog:pickInput'),
  pickOutputDir: () => ipcRenderer.invoke('dialog:pickOutputDir'),
  pickScanFile: () => ipcRenderer.invoke('dialog:pickScanFile'),
  generate: (params) => ipcRenderer.invoke('watermark:generate', params),
  scan: (filePath) => ipcRenderer.invoke('scan:run', filePath),
  history: () => ipcRenderer.invoke('history:list'),
  reveal: (filePath) => ipcRenderer.invoke('shell:revealInFolder', filePath),
  onProgress: (cb) => ipcRenderer.on('watermark:progress', (_e, p) => cb(p)),
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximizeToggle: () => ipcRenderer.send('window:maximize-toggle'),
    close: () => ipcRenderer.send('window:close'),
    onStateChange: (cb) => ipcRenderer.on('window:state', (_e, state) => cb(state)),
  },
});
