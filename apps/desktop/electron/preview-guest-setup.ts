import type { App, BrowserWindow, Session, WebContents } from 'electron'

import { previewGuestInputAction } from './preview-guest-escape'
import { nativePreviewOwner } from './preview-guest-owner'
import { applyPreviewGuestAttachPrefs, isPreviewPartition } from './preview-guest-throttle'

interface EscapeDeps {
  app: App
  fromWebContents: (contents: WebContents) => BrowserWindow | null
  onClose: () => void
}

/** Guest key events never reach the host renderer, including while fullscreen. */
export function installPreviewGuestEscapeHatch({ app, fromWebContents, onClose }: EscapeDeps): void {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview' && contents.getType() !== 'browserView') {
      return
    }

    contents.on('before-input-event', (event, input) => {
      const nativeOwner = nativePreviewOwner(contents) as WebContents | null | undefined

      if (contents.getType() !== 'webview' && !nativeOwner) {
        return
      }

      const owner = fromWebContents(nativeOwner ?? contents.hostWebContents ?? contents)

      switch (previewGuestInputAction(input, Boolean(owner?.isFullScreen()))) {
        case 'exit-fullscreen':
          event.preventDefault()

          if (owner && !owner.isDestroyed()) {
            owner.setFullScreen(false)
          }

          break

        case 'close-preview':
          event.preventDefault()
          onClose()

          break

        default:
          break
      }
    })
  })
}

interface PreloadDeps {
  app: App
  accountPartition: (partition: string) => string
  preloadPath: string
  sessionFor: (partition: string) => Session
}

/** Legacy file/HTML webviews keep the same partition-scoped, popup-denying preload. */
export function installPreviewGuestPreload({ app, accountPartition, preloadPath, sessionFor }: PreloadDeps): void {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'window') {
      return
    }

    contents.on('will-attach-webview', (_attachEvent, webPreferences, params) => {
      const partition = params.partition && isPreviewPartition(params.partition)
        ? accountPartition(params.partition) : params.partition

      applyPreviewGuestAttachPrefs(webPreferences, partition, preloadPath, sessionFor)

      if (partition !== params.partition) {
        webPreferences.partition = partition
      }
    })
  })
}
