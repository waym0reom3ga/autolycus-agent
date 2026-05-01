const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hermesDesktop', {
  getConnection: () => ipcRenderer.invoke('hermes:connection'),
  api: request => ipcRenderer.invoke('hermes:api', request),
  notify: payload => ipcRenderer.invoke('hermes:notify', payload),
  requestMicrophoneAccess: () => ipcRenderer.invoke('hermes:requestMicrophoneAccess'),
  readFileDataUrl: filePath => ipcRenderer.invoke('hermes:readFileDataUrl', filePath),
  selectPaths: options => ipcRenderer.invoke('hermes:selectPaths', options),
  writeClipboard: text => ipcRenderer.invoke('hermes:writeClipboard', text),
  saveImageFromUrl: url => ipcRenderer.invoke('hermes:saveImageFromUrl', url),
  openExternal: url => ipcRenderer.invoke('hermes:openExternal', url),
  onBackendExit: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('hermes:backend-exit', listener)
    return () => ipcRenderer.removeListener('hermes:backend-exit', listener)
  }
})
