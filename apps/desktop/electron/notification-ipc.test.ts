import { EventEmitter } from 'node:events'

import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { beforeEach, expect, it, vi } from 'vitest'

import type { HermesNotification } from './notification-types'

const host = vi.hoisted(() => ({
  handle: vi.fn(),
  fromWebContents: vi.fn(),
  shown: [] as Array<EventEmitter & { close: () => void }>
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: host.fromWebContents },
  ipcMain: { handle: host.handle },
  Notification: class extends EventEmitter {
    static isSupported() {
      return true
    }

    show() {
      host.shown.push(this)
    }

    close() {
      this.emit('close')
    }
  }
}))

import { registerNativeNotifications } from './notification-ipc'

function windowStub(focused = true) {
  return Object.assign(new EventEmitter(), {
    flashFrame: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isFocused: vi.fn(() => focused),
    webContents: { isDestroyed: vi.fn(() => false), send: vi.fn() }
  })
}

beforeEach(() => {
  host.handle.mockReset()
  host.fromWebContents.mockReset()
  host.shown.length = 0
})

it('returns native clicks and approval actions to the emitting window, not the primary', async () => {
  const primary = windowStub()
  const source = windowStub()
  host.fromWebContents.mockReturnValue(source)
  const focusWindow = vi.fn()
  registerNativeNotifications({
    getMainWindow: () => primary as unknown as BrowserWindow,
    focusWindow,
    platform: 'darwin'
  })

  const notify = host.handle.mock.calls[0][1] as (
    event: IpcMainInvokeEvent,
    payload: HermesNotification
  ) => Promise<boolean>

  const payload = {
    kind: 'approval',
    sessionId: 'runtime-source',
    focusSessionId: 'stored-source',
    title: 'Approval',
    actions: [
      { id: 'approve', text: 'Approve' },
      { id: 'reject', text: 'Reject' }
    ]
  }

  expect(await notify({ sender: source.webContents } as unknown as IpcMainInvokeEvent, payload)).toBe(true)
  expect(focusWindow).not.toHaveBeenCalled()
  expect(primary.webContents.send).not.toHaveBeenCalled()
  host.shown[0].emit('click')
  expect(focusWindow).toHaveBeenCalledWith(source)
  expect(source.webContents.send).toHaveBeenCalledWith('hermes:focus-session', payload.focusSessionId)
  host.shown[0].emit('action', { actionIndex: 1 }, undefined)
  expect(source.webContents.send).toHaveBeenCalledWith('hermes:notification-action', {
    sessionId: payload.sessionId,
    actionId: 'reject'
  })
  expect(primary.webContents.send).not.toHaveBeenCalled()

  // A response must never jump to another window's gateway after its owner closes.
  source.isDestroyed.mockReturnValue(true)
  host.shown[0].emit('action', { actionIndex: 0 }, undefined)
  expect(primary.webContents.send).not.toHaveBeenCalled()
  host.shown[0].emit('click')
  expect(primary.webContents.send).toHaveBeenCalledWith('hermes:focus-session', payload.focusSessionId)
})

it('delivers plugin callbacks to their source and falls back only for navigation after it closes', async () => {
  const primary = windowStub()
  const source = windowStub()
  host.fromWebContents.mockReturnValue(source)
  const focusWindow = vi.fn()
  registerNativeNotifications({
    getMainWindow: () => primary as unknown as BrowserWindow,
    focusWindow,
    platform: 'darwin'
  })

  const notify = host.handle.mock.calls[0][1] as (
    event: IpcMainInvokeEvent,
    payload: HermesNotification
  ) => Promise<boolean>

  await notify({ sender: source.webContents } as unknown as IpcMainInvokeEvent, {
    kind: 'plugin',
    notifyId: 'source-callback',
    activate: '/plugin',
    actions: [{ id: 'open', text: 'Open', activate: '/plugin/detail' }]
  })
  host.shown[0].emit('action', { actionIndex: 0 }, undefined)
  expect(source.webContents.send).toHaveBeenCalledWith(
    'hermes:notification-activate',
    expect.objectContaining({
      actionId: 'open',
      notifyId: 'source-callback',
      activate: '/plugin/detail'
    })
  )
  expect(primary.webContents.send).not.toHaveBeenCalled()
  source.isDestroyed.mockReturnValue(true)
  host.shown[0].emit('click')
  expect(primary.webContents.send).toHaveBeenCalledWith(
    'hermes:notification-activate',
    expect.objectContaining({
      activate: '/plugin',
      notifyId: undefined
    })
  )
})

it('flashes an unfocused source window until it regains focus, and leaves a focused one alone', async () => {
  const source = windowStub(false)
  host.fromWebContents.mockReturnValue(source)
  registerNativeNotifications({ getMainWindow: () => null, focusWindow: vi.fn(), platform: 'win32' })

  const notify = host.handle.mock.calls[0][1] as (
    event: IpcMainInvokeEvent,
    payload: HermesNotification
  ) => Promise<boolean>

  const event = { sender: source.webContents } as unknown as IpcMainInvokeEvent

  await notify(event, { kind: 'turnDone', sessionId: 'a', title: 'Hermes finished' })
  await notify(event, { kind: 'turnDone', sessionId: 'b', title: 'Hermes finished' })
  expect(source.flashFrame.mock.calls).toEqual([[true]])

  source.emit('focus')
  expect(source.flashFrame.mock.calls).toEqual([[true], [false]])

  source.isFocused.mockReturnValue(true)
  await notify(event, { kind: 'turnDone', sessionId: 'c', title: 'Hermes finished' })
  expect(source.flashFrame).toHaveBeenCalledTimes(2)
})

it.each(['darwin', 'win32'] as const)('retires %s notifications before another account opens', async platform => {
  const previous = windowStub()
  const current = windowStub()
  let main = previous
  host.fromWebContents.mockReturnValue(previous)
  const focusWindow = vi.fn()

  const nativeNotifications = registerNativeNotifications({
    getMainWindow: () => main as unknown as BrowserWindow,
    focusWindow,
    platform
  })

  const notify = host.handle.mock.calls[0][1] as (
    event: IpcMainInvokeEvent,
    payload: HermesNotification
  ) => Promise<boolean>

  const payload: HermesNotification = {
    kind: 'plugin',
    sessionId: 'same-local-id',
    title: 'Private account event',
    activate: '/private-tool',
    actions: [{ id: 'open', text: 'Open', activate: '/private-tool/detail' }]
  }

  await notify({ sender: previous.webContents } as unknown as IpcMainInvokeEvent, payload)
  const retired = host.shown[0]
  const closeRetired = vi.spyOn(retired, 'close')
  previous.isDestroyed.mockReturnValue(true)
  main = current
  host.fromWebContents.mockReturnValue(current)

  nativeNotifications.dispose()
  retired.emit('click')
  retired.emit('action', { actionIndex: 0 }, undefined)

  expect(current.webContents.send).not.toHaveBeenCalled()
  expect(previous.webContents.send).not.toHaveBeenCalled()
  expect(focusWindow).not.toHaveBeenCalled()
  expect(closeRetired).toHaveBeenCalledOnce()

  // A fresh account may reuse a local event ID within the dedupe interval.
  expect(await notify({ sender: current.webContents } as unknown as IpcMainInvokeEvent, payload)).toBe(true)
  expect(host.shown).toHaveLength(2)
  host.shown[1].emit('click')
  expect(current.webContents.send).toHaveBeenCalledWith('hermes:focus-session', 'same-local-id')
  expect(focusWindow).toHaveBeenCalledWith(current)
  nativeNotifications.dispose()
})
