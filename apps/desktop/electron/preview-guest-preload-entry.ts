// Preload for the preview pane's `<webview>` guests. main.ts installs this
// file via `will-attach-webview` on the `persist:hermes-preview` partition
// only (see `installPreviewGuestPreload`), so no other webview inherits it.
//
// The guest runs with contextIsolation, so this preload shares the guest's
// DOM but never its JavaScript world. A preview page's `target="_blank"`
// anchors (Streamlit traceback's "Ask Google" / "Ask …" buttons —
// #112941) are intercepted here in the DOM's capture phase and handed to the
// host renderer via `sendToHost`; the host admits the scheme and routes the
// URL through the audited `hermes:openExternal` channel. A guest URL never
// becomes an Electron popup and this side never opens anything by itself.
//
// Deliberate scope: only trusted anchor clicks are forwarded. A page's direct
// `window.open` calls stay blocked (the webview has no `allowpopups`): hooking
// them would mean reaching into the guest's JS world, and this preload exposes
// no host APIs there. The prompt-only restoration below keeps Blink's modal
// behavior available because Electron otherwise replaces prompt() with a throwing stub.

import { installGuestExternalHandoff } from './preview-guest-preload'
import { installPreviewGuestPrompt } from './preview-guest-prompt'

const electron = require('electron') as {
  contextBridge: { executeInMainWorld(options: { func: () => void }): void }
  ipcRenderer: {
    sendToHost(channel: string, ...args: unknown[]): void
    send(channel: string, ...args: unknown[]): void
  }
}

// This exposes no host APIs: the serialized function only restores a browser-native prompt.
electron.contextBridge.executeInMainWorld({ func: installPreviewGuestPrompt })

installGuestExternalHandoff({
  addEventListener: (type, listener, capture) => document.addEventListener(type, listener, capture),
  sendToHost: (channel, ...args) => {
    if (process.argv.includes('--aino-native-preview')) {
      electron.ipcRenderer.send('hermes:preview-native:external', channel, args)
    } else {
      electron.ipcRenderer.sendToHost(channel, ...args)
    }
  }
})
