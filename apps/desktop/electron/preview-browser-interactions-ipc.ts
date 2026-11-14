import { ipcMain, webContents } from 'electron'

import type { PreviewBrowserInteractionRequest } from '../shared/preview-browser-interactions'

import { runPreviewBrowserInteraction } from './preview-browser-interactions'

export function registerPreviewBrowserInteractionsIpc(): void {
  ipcMain.handle(
    'hermes:preview-browser-interaction',
    (event, id: unknown, request: PreviewBrowserInteractionRequest) => {
      if (!Number.isSafeInteger(id)) {throw new Error('Invalid Browser page')}
      const guest = webContents.fromId(id as number)

      if (!guest) {throw new Error('Browser page is no longer available')}

      return runPreviewBrowserInteraction(event.sender, guest, request)
    }
  )
}
