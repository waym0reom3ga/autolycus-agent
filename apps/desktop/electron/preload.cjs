const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('hermesDesktop', {
  getConnection: () => ipcRenderer.invoke('hermes:connection'),
  getBootProgress: () => ipcRenderer.invoke('hermes:boot-progress:get'),
  getConnectionConfig: () => ipcRenderer.invoke('hermes:connection-config:get'),
  saveConnectionConfig: payload => ipcRenderer.invoke('hermes:connection-config:save', payload),
  applyConnectionConfig: payload => ipcRenderer.invoke('hermes:connection-config:apply', payload),
  testConnectionConfig: payload => ipcRenderer.invoke('hermes:connection-config:test', payload),
  api: request => ipcRenderer.invoke('hermes:api', request),
  notify: payload => ipcRenderer.invoke('hermes:notify', payload),
  requestMicrophoneAccess: () => ipcRenderer.invoke('hermes:requestMicrophoneAccess'),
  readFileDataUrl: filePath => ipcRenderer.invoke('hermes:readFileDataUrl', filePath),
  readFileText: filePath => ipcRenderer.invoke('hermes:readFileText', filePath),
  selectPaths: options => ipcRenderer.invoke('hermes:selectPaths', options),
  writeClipboard: text => ipcRenderer.invoke('hermes:writeClipboard', text),
  saveImageFromUrl: url => ipcRenderer.invoke('hermes:saveImageFromUrl', url),
  saveImageBuffer: (data, ext) => ipcRenderer.invoke('hermes:saveImageBuffer', { data, ext }),
  saveClipboardImage: () => ipcRenderer.invoke('hermes:saveClipboardImage'),
  getPathForFile: file => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },
  normalizePreviewTarget: (target, baseDir) => ipcRenderer.invoke('hermes:normalizePreviewTarget', target, baseDir),
  watchPreviewFile: url => ipcRenderer.invoke('hermes:watchPreviewFile', url),
  stopPreviewFileWatch: id => ipcRenderer.invoke('hermes:stopPreviewFileWatch', id),
  setPreviewShortcutActive: active => ipcRenderer.send('hermes:previewShortcutActive', Boolean(active)),
  openExternal: url => ipcRenderer.invoke('hermes:openExternal', url),
  readDir: dirPath => ipcRenderer.invoke('hermes:fs:readDir', dirPath),
  gitRoot: startPath => ipcRenderer.invoke('hermes:fs:gitRoot', startPath),
  onClosePreviewRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('hermes:close-preview-requested', listener)
    return () => ipcRenderer.removeListener('hermes:close-preview-requested', listener)
  },
  onPreviewFileChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('hermes:preview-file-changed', listener)
    return () => ipcRenderer.removeListener('hermes:preview-file-changed', listener)
  },
  onBackendExit: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('hermes:backend-exit', listener)
    return () => ipcRenderer.removeListener('hermes:backend-exit', listener)
  },
  onBootProgress: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('hermes:boot-progress', listener)
    return () => ipcRenderer.removeListener('hermes:boot-progress', listener)
  }
})
