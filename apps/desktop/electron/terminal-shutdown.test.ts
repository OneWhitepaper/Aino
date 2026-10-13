import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'

import { beforeEach, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  shells: [] as Array<{ killed: boolean; exit: (event: { exitCode: number; signal?: number }) => void }>
}))

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => 'test' },
  ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => native.handlers.set(name, handler) }
}))
vi.mock('./spawn-helper-perms', () => ({ ensureSpawnHelperExecutable: () => ({ fixed: [], errors: [] }) }))
vi.mock('node-pty', () => ({
  default: {
    spawn: () => {
      const shell = { killed: false, exit: (_event: { exitCode: number; signal?: number }) => undefined }
      native.shells.push(shell)

      return {
        onData: () => undefined,
        onExit: (handler: typeof shell.exit) => {
          shell.exit = handler
        },
        kill: () => {
          shell.killed = true
          // Real node-pty does not emit a second exit when closing the reaped master FD.
        }
      }
    }
  }
}))

import { registerTerminalIpc } from './terminal-ipc'

beforeEach(() => {
  native.handlers.clear()
  native.shells.length = 0
})

it('keeps persisted tabs on app shutdown while ordinary shell exits still notify their renderer', async () => {
  const host = registerTerminalIpc({
    activeSshTerminalTarget: () => null,
    ensureBackend: async () => undefined,
    findOnPath: () => null,
    sshBinary: () => 'ssh',
    getSshConnectionState: () => undefined,
    isWindows: process.platform === 'win32',
    rememberLog: () => undefined
  })

  const sent: Array<{ channel: string; payload: unknown }> = []

  const sender = Object.assign(new EventEmitter(), {
    id: 1,
    isDestroyed: () => false,
    send: (channel: string, payload: unknown) => sent.push({ channel, payload })
  })

  const start = native.handlers.get('hermes:terminal:start')!
  const attach = native.handlers.get('hermes:terminal:attach')!
  const first = await start({ sender }, { cwd: tmpdir() })
  attach({ sender }, first.id)
  native.shells[0]!.exit({ exitCode: 0 })
  expect(sent).toEqual([{ channel: `hermes:terminal:${first.id}:exit`, payload: { code: 0, signal: null } }])
  sent.length = 0
  const second = await start({ sender }, { cwd: tmpdir() })
  attach({ sender }, second.id)
  host.disposeAllTerminalSessions()
  expect(native.shells[1]!.killed).toBe(true)
  expect(sent).toEqual([])
  expect(attach({ sender }, second.id)).toBe(false)
})
