import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { expect, test, vi } from 'vitest'

import { accountWorkspace, createAccountWorkspaceIpc, createAccountWorkspaceSwitch } from './account-workspace'

function deferred() {
  let release!: () => void
  const promise = new Promise<void>(resolve => {
    release = resolve
  })

  return { promise, release }
}

class NativeIpc extends EventEmitter {
  handlers = new Map<string, (...args: any[]) => unknown>()
  handle(channel: string, listener: (...args: any[]) => unknown) {
    this.handlers.set(channel, listener)
  }
  invoke(channel: string, senderId: number) {
    return this.handlers.get(channel)!({ sender: { id: senderId } })
  }
}

test('switch blocks old data immediately and publishes only the final requested account after draining', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aino-account-switch-'))
  const resolve = (id: string | null) => accountWorkspace(userData, 'https://platform.invalid', id)
  const held = deferred()
  const activate = vi.fn()
  const ready = vi.fn()
  const retire = vi.fn(() => held.promise)
  const switching = createAccountWorkspaceSwitch({ initial: resolve('A'), resolve, retire, activate, ready })

  try {
    const first = switching.change('B')
    expect(switching.ready()).toBe(false)
    expect(switching.change('A')).toBe(first)
    expect(activate).not.toHaveBeenCalled()
    expect(ready).not.toHaveBeenCalled()
    held.release()
    await first
    expect(retire).toHaveBeenCalledTimes(1)
    expect(activate).toHaveBeenCalledExactlyOnceWith(resolve('A'))
    expect(switching.current().userId).toBe('A')
    expect(switching.ready()).toBe(true)
    expect(ready).toHaveBeenCalledOnce()
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
})

test('native IPC registration also fences sibling registrations and drains old async work', async () => {
  const ipc = new NativeIpc()
  let activeSender = 1
  const guard = createAccountWorkspaceIpc(
    ipc,
    id => id === activeSender,
    () => true
  )
  const held = deferred()
  const read = vi.fn(() => held.promise)
  const sync = vi.fn(event => {
    event.returnValue = 'old-private-data'
  })
  ipc.handle('hermes:api', read)
  ipc.on('hermes:skin:snapshot', sync)
  const relay = vi.fn()
  ipc.on('hermes:window:relay', relay)
  const oldRead = ipc.invoke('hermes:api', 1)
  activeSender = 2
  expect(() => ipc.invoke('hermes:api', 1)).toThrow('account_workspace_unavailable')
  const oldEvent = { sender: { id: 1 }, returnValue: undefined as unknown }
  expect(() => ipc.emit('hermes:skin:snapshot', oldEvent)).not.toThrow()
  expect(oldEvent.returnValue).toBeNull()
  expect(sync).not.toHaveBeenCalled()
  ipc.emit('hermes:window:relay', oldEvent, { private: 'A-session' })
  expect(relay).not.toHaveBeenCalled()
  const drained = vi.fn()
  const drain = guard.drain().then(drained)
  await Promise.resolve()
  expect(drained).not.toHaveBeenCalled()
  held.release()
  await oldRead
  await drain
  expect(drained).toHaveBeenCalledOnce()
  expect(read).toHaveBeenCalledTimes(1)
})

test('a failed retirement stays closed and can retry the original account', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aino-account-retry-'))
  const resolve = (id: string | null) => accountWorkspace(userData, 'https://platform.invalid', id)
  const retire = vi.fn().mockRejectedValueOnce(new Error('not drained')).mockResolvedValue(undefined)
  const switching = createAccountWorkspaceSwitch({
    initial: resolve('A'),
    resolve,
    retire,
    activate: vi.fn(),
    ready: vi.fn()
  })

  try {
    await expect(switching.change('B')).rejects.toThrow('not drained')
    expect(switching.ready()).toBe(false)
    await switching.change('A')
    expect(switching.ready()).toBe(true)
    expect(retire).toHaveBeenCalledTimes(2)
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
})
