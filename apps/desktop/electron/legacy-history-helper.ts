import { spawn } from 'node:child_process'
import path from 'node:path'

import { hiddenWindowsChildOptions } from './windows-child-options'

interface HistoryHelperRuntime {
  command: string
  cwd: string
  env?: NodeJS.ProcessEnv
}

/** Stdin keeps paths and account identity out of process arguments. Never log chat payloads. */
export function runLegacyHistoryHelper(runtime: HistoryHelperRuntime, input: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      runtime.command,
      ['-P', '-m', 'hermes_cli.desktop_history_recovery'],
      hiddenWindowsChildOptions({
        cwd: runtime.cwd,
        env: {
          ...process.env,
          ...runtime.env,
          HERMES_HOME: String(input.target_home),
          PYTHONIOENCODING: 'utf-8',
          PYTHONPATH: [runtime.cwd, runtime.env?.PYTHONPATH].filter(Boolean).join(path.delimiter)
        },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    )

    const chunks: Buffer[] = []
    let size = 0
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000)
    child.stderr.resume()
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length

      if (size > 256 * 1024 * 1024) {
        child.kill('SIGKILL')

        return
      }

      chunks.push(chunk)
    })
    child.on('error', () => {
      clearTimeout(timer)
      reject(new Error('history_helper_failed'))
    })
    child.stdin.on('error', () => {
      /* The close event reports a helper that exited before consuming input. */
    })
    child.on('close', code => {
      clearTimeout(timer)

      if (code !== 0) {
        reject(new Error('history_helper_failed'))

        return
      }

      try {
        const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))

        if (result.error) {
          reject(new Error(String(result.error)))

          return
        }

        resolve(result)
      } catch {
        reject(new Error('history_helper_failed'))
      }
    })
    child.stdin.end(JSON.stringify(input))
  })
}
