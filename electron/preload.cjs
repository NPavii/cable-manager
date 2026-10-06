const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('cableFile', {
  isElectron: true,
  save: (json, filePath) => ipcRenderer.invoke('cm:save', { json, filePath }),
  saveExport: (payload) => ipcRenderer.invoke('cm:save-export', payload),
  open: () => ipcRenderer.invoke('cm:open'),
  onMenu: (cb) => ipcRenderer.on('cm:menu', (_e, action) => cb(action)),
  confirmClose: () => ipcRenderer.send('cm:close-confirm'),
  setDirty: (d) => ipcRenderer.send('cm:dirty', d),
})
