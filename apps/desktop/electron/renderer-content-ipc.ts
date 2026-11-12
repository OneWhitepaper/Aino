import path from 'node:path'

import { app, type BrowserWindow, clipboard, dialog, webContents as electronWebContents, type IpcMain } from 'electron'

import { readClipboardImagePng } from './clipboard-image'
import { registerClipboardTextIpc } from './clipboard-ipc'
import { saveImageFromUrl, writeComposerImage } from './composer-image-files'
import { writeComposerPaste } from './composer-paste'
import { capturePreviewContents } from './preview-capture'
import { createPreviewTargetResolver } from './preview-file-target'
import { stopPreviewFileWatch, watchDirectory, watchPreviewFile } from './preview-file-watch'
import { registerSaveDialogIpc } from './save-text-file'
import { selectPathsDialogProperties } from './select-paths-dialog'
import { registerSpellcheckDictionaryIpc } from './spellcheck-dictionary-ipc'
import { readWslWindowsClipboardImage } from './wsl-clipboard-image'
import { resolvePickerDefaultPath } from './wsl-path-bridge'

interface RendererContentIpcDeps {
  getMainWindow: () => BrowserWindow | null
  getHermesHome: () => string
  getAccountUiRoot: () => string
  getLastContextMenuPoint: (contentsId: number) => { x: number; y: number } | undefined
  saveGatewayFile: (payload: any) => unknown
  resolveHermesCwd: () => string
  fileExists: (filePath: string) => boolean
  directoryExists: (filePath: string) => boolean
  isWindows: boolean
  isWsl: boolean
}

/** Registers through the account-fenced IPC passed by main; mutable account paths stay live. */
export function registerRendererContentIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  {
    getMainWindow,
    getHermesHome,
    getAccountUiRoot,
    getLastContextMenuPoint,
    saveGatewayFile,
    resolveHermesCwd,
    fileExists,
    directoryExists,
    isWindows,
    isWsl
  }: RendererContentIpcDeps
): void {
  ipcMain.handle('hermes:selectPaths', async (_event, options: any = {}) => {
    const properties = selectPathsDialogProperties(options || {})

    let resolvedDefaultPath

    if (options?.defaultPath) {
      try {
        // On a Windows host with a WSL backend the cwd may be a POSIX/WSL path;
        // bridge it to a UNC/drive form the native dialog can actually open.
        const bridged = isWindows
          ? resolvePickerDefaultPath(String(options.defaultPath), undefined, options?.profile)
          : String(options.defaultPath)

        resolvedDefaultPath = bridged ? path.resolve(bridged) : undefined
      } catch {
        resolvedDefaultPath = undefined
      }
    }

    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: options?.title || 'Add context',
      defaultPath: resolvedDefaultPath,
      properties: properties as any,
      filters: Array.isArray(options?.filters) ? options.filters : undefined
    })

    if (result.canceled) {
      return []
    }

    return result.filePaths
  })

  // Clipboard text read/write for the renderer (clipboard-ipc.ts).
  registerClipboardTextIpc(ipcMain, clipboard)

  // Save dialogs: the path picker (profile export) and /save's main-process write (save-text-file.ts).
  registerSaveDialogIpc(ipcMain, {
    defaultDir: () => app.getPath('documents'),
    showSaveDialog: options => dialog.showSaveDialog(getMainWindow(), options)
  })

  ipcMain.handle('hermes:saveGatewayFile', (_event, payload) => saveGatewayFile(payload))

  ipcMain.handle('hermes:saveImageFromUrl', (_event, url) => saveImageFromUrl(String(url || ''), getMainWindow()))

  // The custom context menu's edit verbs. They act on the SENDER's focused
  // element, so the renderer restores focus to the editable before invoking.
  ipcMain.handle('hermes:context-menu:edit', (event, command) => {
    const contents = event.sender

    if (command === 'copy') {
      contents.copy()
    } else if (command === 'cut') {
      contents.cut()
    } else if (command === 'paste') {
      contents.paste()
    } else if (command === 'selectAll') {
      contents.selectAll()
    }
  })

  // Copy the image under the sender's LAST context-menu gesture. Chromium only
  // exposes image bytes through copyImageAt, and only main saw the coordinates.
  ipcMain.handle('hermes:context-menu:copy-image', event => {
    const point = getLastContextMenuPoint(event.sender.id)

    if (point) {
      event.sender.copyImageAt(point.x, point.y)
    }
  })

  registerSpellcheckDictionaryIpc(ipcMain, electronWebContents)

  ipcMain.handle('hermes:capturePreview', async (_event, payload) => {
    const guest = electronWebContents.fromId(Number(payload?.webContentsId))

    return capturePreviewContents(guest, payload?.rect, payload?.viewport)
  })

  ipcMain.handle('hermes:saveImageBuffer', async (_event, payload) => {
    const data = payload?.data

    if (!data) {
      throw new Error('saveImageBuffer: missing data')
    }

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)

    return writeComposerImage(buffer, payload?.ext || '.png', payload?.name, getAccountUiRoot())
  })

  ipcMain.handle('hermes:savePastedText', async (_event, payload) => {
    const text = typeof payload?.text === 'string' ? payload.text : ''

    if (!text) {
      throw new Error('savePastedText: missing text')
    }

    return writeComposerPaste(getHermesHome(), text)
  })

  ipcMain.handle('hermes:saveClipboardImage', async () => {
    // Electron 44 removed clipboard.readImage(); PNG bytes now arrive through
    // clipboard.read() + ClipboardItem.getType('image/png') as a Blob.
    const png = await readClipboardImagePng(clipboard)

    if (png) {
      return writeComposerImage(png, '.png', '', getAccountUiRoot())
    }

    // WSL2/WSLg doesn't bridge clipboard *images* from the Windows host to the
    // Linux clipboard Electron reads, so a host screenshot looks empty above.
    // Pull it straight off the Windows clipboard via PowerShell as a fallback.
    if (isWsl) {
      const png = readWslWindowsClipboardImage()

      if (png) {
        return writeComposerImage(png, '.png', '', getAccountUiRoot())
      }
    }

    return ''
  })

  const normalizePreviewTarget = createPreviewTargetResolver({
    hermesHome: getHermesHome,
    resolveHermesCwd,
    fileExists,
    directoryExists
  })

  ipcMain.handle('hermes:normalizePreviewTarget', (_event, target, baseDir) =>
    normalizePreviewTarget(String(target || ''), baseDir ? String(baseDir) : '')
  )

  ipcMain.handle('hermes:watchPreviewFile', (event, url) => watchPreviewFile(event.sender, String(url || '')))

  ipcMain.handle('hermes:watchDirectory', (event, dir) => watchDirectory(event.sender, String(dir || '')))

  ipcMain.handle('hermes:stopPreviewFileWatch', (_event, id) => stopPreviewFileWatch(String(id || '')))
}
