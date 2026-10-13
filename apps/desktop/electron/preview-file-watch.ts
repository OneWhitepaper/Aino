import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { isMissingFileError, missingFileResult, resolveReadableFileForIpc } from './hardening'
import { guardedWatch } from './watch-storm-breaker'

const PREVIEW_WATCH_DEBOUNCE_MS = 120
const previewWatchers = new Map()

/**
 * Owner-routed delivery for desktop preview/plugin file watches (#108189).
 *
 * Each watch is owned by the WebContents that registered it. Change events
 * must go back to THAT renderer — secondary windows filter
 * `hermes:preview-file-changed` by their own watch id, so delivering only to
 * the main window drops the event.
 */

export const PREVIEW_FILE_CHANGED_CHANNEL = 'hermes:preview-file-changed'

/** The events a watch needs from the WebContents that registered it. */
export type PreviewWatchOwner = Pick<Electron.WebContents, 'isDestroyed' | 'send'> & {
  once(event: 'destroyed', listener: () => void): unknown
  removeListener(event: 'destroyed', listener: () => void): unknown
}

export type PreviewFileChangedPayload = {
  id: string
  path: string
  url: string
}

/**
 * Deliver a change payload to the watch owner. Returns false when the owner
 * is missing or destroyed so callers can tear the watch down.
 */
export function sendPreviewFileChangedToOwner(
  owner: PreviewWatchOwner | null | undefined,
  payload: PreviewFileChangedPayload,
  onDestroyed?: () => void
): boolean {
  if (!owner || owner.isDestroyed()) {
    onDestroyed?.()

    return false
  }

  owner.send(PREVIEW_FILE_CHANGED_CHANNEL, payload)

  return true
}

/**
 * Tear `teardown` down the moment the owner window dies, not at the next
 * (never-arriving) change event: an fs.watch handle for a closed window
 * otherwise lingers until quit. Returns the unsubscribe for the watch's own
 * close().
 */
export function onPreviewWatchOwnerDestroyed(
  owner: PreviewWatchOwner | null | undefined,
  teardown: () => void
): () => void {
  if (!owner || typeof owner.once !== 'function') {
    return () => {}
  }

  owner.once('destroyed', teardown)

  return () => {
    owner.removeListener('destroyed', teardown)
  }
}

async function filePathFromPreviewUrl(rawUrl) {
  const { resolvedPath } = await resolveReadableFileForIpc(String(rawUrl || ''), { purpose: 'Preview file' })

  return resolvedPath
}

export async function watchPreviewFile(owner, rawUrl) {
  let filePath

  try {
    filePath = await filePathFromPreviewUrl(rawUrl)
  } catch (error) {
    // A restored tab probing a file that is gone is an expected outcome —
    // answer it like the read handlers do instead of rejecting (Electron logs
    // every rejected handler as a stack trace at startup).
    if (isMissingFileError(error)) {
      return missingFileResult(rawUrl, error)
    }

    throw error
  }

  const watchDir = path.dirname(filePath)
  const targetName = path.basename(filePath)
  const id = crypto.randomBytes(12).toString('base64url')
  let timer = null

  // Proactive teardown: the watch must not outlive the window that asked for
  // it by whole quit-cycles waiting on a change event that never comes.
  const offOwnerDestroyed = onPreviewWatchOwnerDestroyed(owner, () => stopPreviewFileWatch(id))

  const emit = () => {
    try {
      if (!fs.statSync(filePath).isFile()) {return}
    } catch {
      return
    }

    sendPreviewFileChangedToOwner(owner, { id, path: filePath, url: pathToFileURL(filePath).toString() }, () =>
      stopPreviewFileWatch(id)
    )
  }

  // guardedWatch: a win32 event storm closes the raw fs.watch and falls back
  // to a slow stat poll instead of pinning the main thread (#118974).
  const watcher = guardedWatch({
    platform: process.platform,
    watch: listener => fs.watch(watchDir, listener),
    onEvent: (_eventType, filename) => {
      const changedName = filename ? path.basename(String(filename)) : ''

      if (changedName && changedName !== targetName) {
        return
      }

      if (timer) {
        clearTimeout(timer)
      }

      timer = setTimeout(() => {
        timer = null
        emit()
      }, PREVIEW_WATCH_DEBOUNCE_MS)
    },
    snapshot: () => {
      const stat = fs.statSync(filePath)

      return `${stat.mtimeMs}:${stat.size}`
    },
    onPollChange: emit,
    onTrip: ({ events, windowMs }) =>
      console.warn(`[hermes] fs.watch storm on ${watchDir} (${events} events within ${windowMs}ms); polling instead`)
  })

  previewWatchers.set(id, {
    owner,
    close: () => {
      offOwnerDestroyed()

      if (timer) {
        clearTimeout(timer)
      }

      watcher.close()
    }
  })

  return { id, path: filePath }
}

export function stopPreviewFileWatch(id) {
  const watcher = previewWatchers.get(id)

  if (!watcher) {
    return false
  }

  watcher.close()
  previewWatchers.delete(id)

  return true
}

export function closePreviewWatchers() {
  for (const id of previewWatchers.keys()) {
    stopPreviewFileWatch(id)
  }
}

/** Watch a DIRECTORY for entry churn (folders appearing/vanishing) — the
 *  disk-plugin door's "new plugin folder" signal, replacing the renderer's 5s
 *  readdir poll. Same registry + change channel as the preview file watchers
 *  (the renderer reconciles on any tick; per-file edits stay on their own
 *  watches), so stopPreviewFileWatch/closePreviewWatchers manage these too. */
export function watchDirectory(owner, rawDir) {
  const watchDir = path.resolve(String(rawDir || ''))

  if (!fs.existsSync(watchDir) || !fs.statSync(watchDir).isDirectory()) {
    throw new Error(`Not a directory: ${watchDir}`)
  }

  const id = crypto.randomBytes(12).toString('base64url')
  let timer = null

  // Same proactive teardown as a file watch: a closed window's directory
  // watch must not keep polling the disk-plugin door until quit.
  const offOwnerDestroyed = onPreviewWatchOwnerDestroyed(owner, () => stopPreviewFileWatch(id))

  const emit = () => {
    sendPreviewFileChangedToOwner(owner, { id, path: watchDir, url: pathToFileURL(watchDir).toString() }, () =>
      stopPreviewFileWatch(id)
    )
  }

  // A win32 event storm here pinned a core at 100% (#118974): the breaker
  // closes the raw watch and falls back to the readdir poll it replaced.
  const watcher = guardedWatch({
    platform: process.platform,
    watch: listener => fs.watch(watchDir, listener),
    onEvent: () => {
      if (timer) {
        clearTimeout(timer)
      }

      timer = setTimeout(() => {
        timer = null
        emit()
      }, PREVIEW_WATCH_DEBOUNCE_MS)
    },
    snapshot: () => fs.readdirSync(watchDir).sort().join('\0'),
    onPollChange: emit,
    onTrip: ({ events, windowMs }) =>
      console.warn(`[hermes] fs.watch storm on ${watchDir} (${events} events within ${windowMs}ms); polling instead`)
  })

  previewWatchers.set(id, {
    owner,
    close: () => {
      offOwnerDestroyed()

      if (timer) {
        clearTimeout(timer)
      }

      watcher.close()
    }
  })

  return { id, path: watchDir }
}
