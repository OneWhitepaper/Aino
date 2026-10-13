import fs from 'node:fs'
import path from 'node:path'

import { app, ipcMain } from 'electron'

import {
  ATTACHMENT_UPLOAD_DEFAULT_MAX_BYTES,
  clampDataUrlReadMaxMb,
  DATA_URL_READ_DEFAULT_MAX_MB,
  dataUrlReadMaxBytesFromMb,
  isMissingFileError,
  missingFileResult,
  readFileDataUrlForIpc,
  resolveReadableFileForIpc,
  resolveRequestedPathForIpc,
  TEXT_PREVIEW_SOURCE_MAX_BYTES
} from './hardening'
import { resolveIpcFileReadPath } from './local-read-path'
import { looksBinary, mimeTypeForPath, PREVIEW_LANGUAGE_BY_EXT, TEXT_PREVIEW_MAX_BYTES } from './preview-file-metadata'

export function registerPreviewFileReadIpc({ rememberLog }: { rememberLog: (message: string) => void }) {
  // Data-URL file load cap (composer attach + local previews). Main owns the
  // persisted MB value so every IPC read honours Settings → Chat without the
  // renderer having to pass maxBytes on each call. Default is 16 MB; clamp
  // lives in hardening.ts.
  const DATA_URL_READ_MAX_CONFIG_PATH = path.join(app.getPath('userData'), 'data-url-read-max.json')

  function readPersistedDataUrlReadMaxMb() {
    try {
      return clampDataUrlReadMaxMb(JSON.parse(fs.readFileSync(DATA_URL_READ_MAX_CONFIG_PATH, 'utf8')).maxMb)
    } catch {
      return DATA_URL_READ_DEFAULT_MAX_MB
    }
  }

  let dataUrlReadMaxMb = readPersistedDataUrlReadMaxMb()

  function persistDataUrlReadMaxMb(maxMb) {
    const next = clampDataUrlReadMaxMb(maxMb)
    dataUrlReadMaxMb = next

    try {
      fs.mkdirSync(path.dirname(DATA_URL_READ_MAX_CONFIG_PATH), { recursive: true })
      fs.writeFileSync(DATA_URL_READ_MAX_CONFIG_PATH, JSON.stringify({ maxMb: next }, null, 2), 'utf8')
    } catch (error) {
      rememberLog(`[data-url-read-max] write failed: ${error.message}`)
    }

    return next
  }

  ipcMain.handle('hermes:data-url-read-max:get', () => ({
    maxMb: dataUrlReadMaxMb,
    // Keep the default bytes constant visible for tests / diagnostics.
    defaultMaxMb: DATA_URL_READ_DEFAULT_MAX_MB,
    maxBytes: dataUrlReadMaxBytesFromMb(dataUrlReadMaxMb)
  }))

  ipcMain.handle('hermes:data-url-read-max:set', (_event, maxMb) => {
    const next = persistDataUrlReadMaxMb(maxMb)

    return {
      maxMb: next,
      defaultMaxMb: DATA_URL_READ_DEFAULT_MAX_MB,
      maxBytes: dataUrlReadMaxBytesFromMb(next)
    }
  })

  ipcMain.handle('hermes:readFileDataUrl', async (_event, filePath) => {
    // Backend-reported paths are WSL/POSIX (`/home/...`, `/mnt/c/...`); on a
    // Windows host bridge them to a UNC/drive form, same as directory reads.
    const bridgedPath = resolveIpcFileReadPath(filePath)

    try {
      return await readFileDataUrlForIpc(bridgedPath, {
        maxBytes: dataUrlReadMaxBytesFromMb(dataUrlReadMaxMb),
        mimeType: mimeTypeForPath(resolveRequestedPathForIpc(bridgedPath, { purpose: 'File preview' })),
        purpose: 'File preview'
      })
    } catch (error) {
      if (isMissingFileError(error)) {
        return missingFileResult(filePath, error)
      }

      throw error
    }
  })

  // Remote attachment transfer is independent of the preview / Settings path.
  // Keep a finite cap so Electron + base64 memory stays bounded while archives
  // can exceed the default 16 MiB preview ceiling (and still fit the gateway
  // WebSocket frame limit after base64 expansion).
  ipcMain.handle('hermes:readFileDataUrlForAttach', async (_event, filePath) => {
    const bridgedPath = resolveIpcFileReadPath(filePath)

    try {
      return await readFileDataUrlForIpc(bridgedPath, {
        maxBytes: ATTACHMENT_UPLOAD_DEFAULT_MAX_BYTES,
        mimeType: mimeTypeForPath(resolveRequestedPathForIpc(bridgedPath, { purpose: 'Attachment upload' })),
        purpose: 'Attachment upload'
      })
    } catch (error) {
      if (isMissingFileError(error)) {
        return missingFileResult(filePath, error)
      }

      throw error
    }
  })

  ipcMain.handle('hermes:readFileText', async (_event, filePath) => {
    try {
      const { resolvedPath, stat } = await resolveReadableFileForIpc(resolveIpcFileReadPath(filePath), {
        maxBytes: TEXT_PREVIEW_SOURCE_MAX_BYTES,
        purpose: 'Text preview'
      })

      const ext = path.extname(resolvedPath).toLowerCase()
      const handle = await fs.promises.open(resolvedPath, 'r')
      const bytesToRead = Math.min(stat.size, TEXT_PREVIEW_MAX_BYTES)

      try {
        const buffer = Buffer.alloc(bytesToRead)
        const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0)

        return {
          binary: looksBinary(buffer.subarray(0, Math.min(bytesRead, 4096))),
          byteSize: stat.size,
          language: PREVIEW_LANGUAGE_BY_EXT[ext] || 'text',
          mimeType: mimeTypeForPath(resolvedPath),
          path: resolvedPath,
          text: buffer.subarray(0, bytesRead).toString('utf8'),
          truncated: stat.size > TEXT_PREVIEW_MAX_BYTES
        }
      } finally {
        await handle.close()
      }
    } catch (error) {
      // A preview probing a file that is gone (deleted, moved, or cleared from
      // /tmp since the tab/transcript reference was written) is an expected
      // outcome. Return a structured error instead of rejecting — Electron logs
      // every rejected handler with a stack trace even though the renderer shows
      // "preview unavailable" either way.
      if (isMissingFileError(error)) {
        return missingFileResult(filePath, error)
      }

      throw error
    }
  })

  // Runtime desktop plugins load their FULL source through this door.
  // `hermes:readFileText` is the *preview* read and silently truncates at
  // TEXT_PREVIEW_MAX_BYTES (512 KiB) — for a plugin that means evaluating half a
  // file. Dedicated generous cap, full read, and a hard EFBIG (via maxBytes)
  // instead of truncation when the source exceeds it.
  const PLUGIN_SOURCE_MAX_BYTES = 16 * 1024 * 1024

  ipcMain.handle('hermes:readPluginSource', async (_event: unknown, filePath: unknown) => {
    const { resolvedPath, stat } = await resolveReadableFileForIpc(filePath, {
      maxBytes: PLUGIN_SOURCE_MAX_BYTES,
      purpose: 'Plugin source'
    })

    return {
      byteSize: stat.size,
      path: resolvedPath,
      text: await fs.promises.readFile(resolvedPath, 'utf8'),
      truncated: false
    }
  })
}
