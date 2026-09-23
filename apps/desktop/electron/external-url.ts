import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { spawn as spawnProcess } from 'node:child_process'

import type { Shell } from 'electron'

import { resolveRequestedPathForIpc } from './hardening'

export interface ExternalUrlDependencies {
  shell: Pick<Shell, 'openExternal' | 'openPath' | 'showItemInFolder'>
  isWsl: boolean
  log: (message: string) => void
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess
}

export function createExternalUrlOpener(dependencies: ExternalUrlDependencies) {
  const { shell, isWsl, log, spawn = spawnProcess } = dependencies

  return async function openExternalUrl(rawUrl: unknown): Promise<boolean> {
    const raw = String(rawUrl || '').trim()

    if (!raw) {
      return false
    }

    let parsed

    try {
      parsed = new URL(raw)
    } catch {
      return false
    }

    // `file://` URLs come from the artifacts panel (the renderer can't open
    // them itself because Chromium blocks file:// navigation from the app
    // origin). Hand them to `shell.openPath`, which dispatches to the OS
    // file association. If the OS can't open it (`error` is a non-empty
    // string), fall back to revealing the file in the system file manager.
    if (parsed.protocol === 'file:') {
      let localPath

      try {
        localPath = resolveRequestedPathForIpc(parsed.toString(), { purpose: 'Open external file' })
      } catch {
        return false
      }

      const error = await shell.openPath(localPath)

      if (error) {
        log(`[file] openPath failed: ${error}; revealing in folder instead`)
        shell.showItemInFolder(localPath)
      }

      return true
    }

    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      return false
    }

    const url = parsed.toString()

    if (isWsl) {
      log(`[link] opening via WSL→Windows: ${url}`)

      try {
        await new Promise<void>((resolve, reject) => {
          const proc = spawn('cmd.exe', ['/c', 'start', '""', url], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
          })

          proc.once('error', reject)
          proc.once('exit', (code, signal) => {
            if (code === 0) {
              resolve()
            } else {
              reject(new Error(`cmd.exe start exited with ${signal || code}`))
            }
          })
          proc.unref()
        })

        return true
      } catch (error) {
        log(`[link] cmd.exe start failed: ${error.message}; falling back to xdg-open`)
      }
    }

    await shell.openExternal(url)

    return true
  }
}
