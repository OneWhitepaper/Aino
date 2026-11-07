import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'

import type { LocalSyncCall, LocalSyncReply } from './account-cloud-sync'
import { hiddenWindowsChildOptions } from './windows-child-options'

const LIMIT = 32 * 1024 * 1024

function parseLocalReply(raw: string, action: unknown, code: number | null): LocalSyncReply {
  let reply: any

  try {
    reply = JSON.parse(raw)
  } catch {
    throw new Error('sync_adapter_unavailable')
  }

  if (reply?.ok === false && ['invalid_request', 'sync_failed'].includes(reply.error?.code)) {
    throw new Error('sync_local_failed')
  }

  if (
    code !== 0 ||
    reply?.ok !== true ||
    (action !== 'read_blob' &&
      (!reply.status ||
        !['synced', 'pending', 'blocked'].includes(reply.status.state) ||
        !Array.isArray(reply.status.issues)))
  ) {
    throw new Error('sync_adapter_unavailable')
  }

  return reply
}

/** A short-lived private pipe; the adapter receives no platform credentials. */
export function createCloudSyncLocalAdapter(
  resolve: () => Promise<{ command: string; env?: NodeJS.ProcessEnv }>,
  cwd: () => string
): LocalSyncCall {
  return async (workspace, input, signal) => {
    let runtime: Awaited<ReturnType<typeof resolve>>

    try {
      runtime = await resolve()
    } catch {
      throw new Error('sync_adapter_unavailable')
    }

    if (signal.aborted) {
      throw new Error('sync_superseded')
    }
    const request = JSON.stringify({ ...input, version: 1, home: workspace.home, ui_root: workspace.ui })

    if (Buffer.byteLength(request) > LIMIT) {
      throw new Error('sync_request_too_large')
    }

    return new Promise<LocalSyncReply>((resolveReply, reject) => {
      const child = spawn(
        runtime.command,
        ['-P', '-u', '-m', 'hermes_cli.cloud_sync'],
        hiddenWindowsChildOptions({
          cwd: cwd(),
          env: {
            ...process.env,
            ...runtime.env,
            HERMES_HOME: workspace.home,
            PYTHONIOENCODING: 'utf-8',
            PYTHONUTF8: '1'
          },
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe']
        })
      ) as ChildProcessWithoutNullStreams

      const chunks: Buffer[] = []
      let bytes = 0
      let failure: string | null = null

      const abort = () => {
        failure ||= signal.aborted ? 'sync_superseded' : 'sync_adapter_failed'
        child.kill('SIGKILL')
      }
      signal.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(() => {
        failure = 'sync_adapter_timeout'
        abort()
      }, 60_000)
      child.stderr.resume()
      child.stdout.on('data', chunk => {
        bytes += chunk.length

        if (bytes > LIMIT) {
          failure = 'sync_response_too_large'
          abort()
        } else {
          chunks.push(chunk)
        }
      })
      child.stdin.on('error', abort)
      child.on('error', () => {
        failure = 'sync_adapter_unavailable'
      })
      child.on('close', code => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)

        if (failure) {
          reject(new Error(failure))

          return
        }

        try {
          resolveReply(parseLocalReply(Buffer.concat(chunks).toString('utf8'), input.action, code))
        } catch (error) {
          reject(error)
        }
      })
      child.stdin.end(request)
    })
  }
}
