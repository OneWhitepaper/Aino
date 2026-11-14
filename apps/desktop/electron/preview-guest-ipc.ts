import { BrowserWindow, ipcMain, webContents } from 'electron'

import { notePreviewGuestHidden } from './preview-guest-offscreen'
import {
  armPreviewGuestApproval,
  beginPreviewGuestActivity,
  endPreviewGuestActivity,
  executePreviewGuestScript,
  sendPreviewGuestApprovedInput,
  validatePreviewGuestApproval
} from './preview-guest-throttle'

export function registerPreviewGuestIpc(holdWindow: (owner: BrowserWindow) => () => void): void {
  ipcMain.handle('hermes:preview-approval:arm', (event, token: number) => armPreviewGuestApproval(event.sender, token))
  ipcMain.handle('hermes:preview-approval:validate', (event, token: number) =>
    validatePreviewGuestApproval(event.sender, token)
  )
  ipcMain.handle(
    'hermes:preview-approval:input',
    (
      event,
      token: number,
      input: Electron.MouseInputEvent | Electron.KeyboardInputEvent | Electron.MouseWheelInputEvent
    ) => sendPreviewGuestApprovedInput(event.sender, token, input)
  )
  // Kept-alive, off-screen pages must not receive focused-guest gestures.
  ipcMain.on('hermes:preview-guest-hidden', (event, payload) => {
    notePreviewGuestHidden(event.sender, webContents.fromId(Number(payload?.webContentsId)), Boolean(payload?.hidden))
  })

  ipcMain.handle('hermes:preview-guest-activity:begin', (event, webContentsId: unknown) => {
    if (!Number.isSafeInteger(webContentsId)) {
      throw new Error('Invalid preview guest')
    }

    const owner = BrowserWindow.fromWebContents(event.sender)

    if (!owner) {
      throw new Error('Preview owner window is unavailable')
    }

    return beginPreviewGuestActivity(event.sender, webContents.fromId(webContentsId as number) ?? undefined, () =>
      holdWindow(owner)
    )
  })

  ipcMain.handle('hermes:preview-guest-activity:end', (event, token: unknown) => {
    if (Number.isSafeInteger(token)) {
      return endPreviewGuestActivity(event.sender, token as number)
    }
  })

  ipcMain.handle('hermes:preview-guest-activity:script', (event, token: unknown, code: unknown) => {
    if (!Number.isSafeInteger(token) || typeof code !== 'string') {
      throw new Error('Invalid preview script request')
    }

    return executePreviewGuestScript(event.sender, token as number, code)
  })
}
