const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('previewFixtureBridge', {
  begin: guest => ipcRenderer.invoke('fixture:begin', guest),
  end: token => ipcRenderer.invoke('fixture:end', token),
  script: (token, code) => ipcRenderer.invoke('fixture:script', token, code),
  capture: guest => ipcRenderer.invoke('fixture:capture', guest),
  arm: token => ipcRenderer.invoke('fixture:approval-arm', token),
  validate: token => ipcRenderer.invoke('fixture:approval-validate', token),
  input: (token, input) => ipcRenderer.invoke('fixture:approval-input', token, input),
  native: (guest, request) => ipcRenderer.invoke('fixture:native', guest, request),
  onDialog: callback => {
    const receive = (_event, payload) => callback(payload)
    ipcRenderer.on('hermes:preview-browser-dialog', receive)
    return () => ipcRenderer.removeListener('hermes:preview-browser-dialog', receive)
  },
  onChooser: callback => {
    const receive = (_event, payload) => callback(payload)
    ipcRenderer.on('hermes:preview-file-chooser', receive)
    return () => ipcRenderer.removeListener('hermes:preview-file-chooser', receive)
  }
})
