import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { deferred } from '@/test/deferred'

import type { NativePreviewBridge, NativePreviewEvent, NativePreviewSnapshot } from '../../../../shared/preview-native'

import type { PreviewInputEvent } from './preview-input'
import { watchNativePreviewPlacement } from './preview-native-placement'
import { connectNativePreviewSurface, createNativePreviewSurface } from './preview-native-surface'
import {
  isSamePreviewDocument,
  previewScriptRunnerFor,
  registerPreviewScriptRunner,
  watchPreviewDocumentLifecycle
} from './preview-script-runner'

vi.mock('./preview-native-placement', () => ({ watchNativePreviewPlacement: vi.fn(() => vi.fn()) }))

interface Surface extends HTMLElement {
  canGoBack: () => boolean
  canGoForward: () => boolean
  getTitle: () => string
  getURL: () => string
  getWebContentsId: () => number
  getZoomFactor: () => number
  getPageZoomMode: () => 'fit' | 'manual'
  setPageZoom: (value: 'fit' | number) => Promise<unknown>
  goBack: () => Promise<unknown>
  loadURL: (url: string) => Promise<unknown>
  sendInputEvent: (event: PreviewInputEvent) => Promise<unknown>
  settleInput: () => Promise<void>
}

const originalDesktop = window.hermesDesktop
const cleanups: Array<() => void> = []

const snapshot = (token = 'mount-1'): NativePreviewSnapshot => ({
  token,
  webContentsId: 81,
  url: 'https://example.com/form?existing=1',
  title: 'Unsaved form',
  back: true,
  forward: false,
  loading: false,
  ready: true,
  zoom: 1.25,
  muted: false
})

function setup() {
  const listeners = new Set<(event: NativePreviewEvent) => void>()

  const bridge = {
    mount: vi.fn(async () => snapshot()),
    layout: vi.fn(),
    command: vi.fn(async () => undefined),
    release: vi.fn(async () => {}),
    closeTab: vi.fn(async () => {}),
    onEvent: vi.fn((listener: (event: NativePreviewEvent) => void) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    })
  } satisfies NativePreviewBridge

  window.hermesDesktop = { ...originalDesktop, nativePreview: bridge }

  const surface = createNativePreviewSurface('tab-one', 'persist:hermes-preview-work', 'https://example.com') as Surface
  document.body.appendChild(surface)

  const connect = () => {
    const stop = connectNativePreviewSurface(surface)!
    let stopped = false

    const cleanup = () => {
      if (!stopped) {
        stopped = true
        stop()
      }
    }

    cleanups.push(cleanup)

    return cleanup
  }

  return {
    bridge,
    connect,
    listeners,
    surface,
    receive: (event: NativePreviewEvent) => listeners.forEach(fn => fn(event))
  }
}

beforeEach(() => vi.mocked(watchNativePreviewPlacement).mockClear())

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  document.body.replaceChildren()
  window.hermesDesktop = originalDesktop
})

it('attaches the existing native document snapshot without navigating it again', async () => {
  const { bridge, connect, surface } = setup()
  const ready = vi.fn()
  const navigation = vi.fn()
  const stopped = vi.fn()
  surface.addEventListener('dom-ready', ready)
  surface.addEventListener('did-navigate-in-page', navigation)
  surface.addEventListener('did-stop-loading', stopped)
  expect(bridge.mount).not.toHaveBeenCalled()
  connect()
  await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce())

  expect(bridge.mount).toHaveBeenCalledExactlyOnceWith({
    tabId: 'tab-one',
    partition: 'persist:hermes-preview-work',
    url: 'https://example.com',
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    visible: false
  })
  expect(surface.getWebContentsId()).toBe(81)
  expect(surface.getURL()).toBe('https://example.com/form?existing=1')
  expect(surface.getTitle()).toBe('Unsaved form')
  expect(surface.getZoomFactor()).toBe(1.25)
  expect(surface.canGoBack()).toBe(true)
  expect(surface.canGoForward()).toBe(false)
  expect(navigation).toHaveBeenCalledWith(expect.objectContaining({ url: surface.getURL() }))
  expect(stopped).toHaveBeenCalledOnce()
  expect(watchNativePreviewPlacement).toHaveBeenCalledWith(surface, bridge, 'mount-1')
  expect(bridge.command).not.toHaveBeenCalled()
})

it('updates history and forwards document events only from the current mount token', async () => {
  const { bridge, connect, receive, surface } = setup()
  const ready = vi.fn()
  const navigation = vi.fn()
  surface.addEventListener('dom-ready', ready)
  surface.addEventListener('did-navigate-in-page', navigation)
  connect()
  await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce())
  receive({
    token: 'previous-mount',
    type: 'did-navigate-in-page',
    url: 'https://wrong.example',
    snapshot: { ...snapshot('previous-mount'), url: 'https://wrong.example', forward: true }
  })
  expect(surface.getURL()).toBe('https://example.com/form?existing=1')
  expect(navigation).toHaveBeenCalledOnce()

  receive({
    token: 'mount-1',
    type: 'did-navigate-in-page',
    url: 'https://example.com/back',
    snapshot: { ...snapshot(), url: 'https://example.com/back', title: 'Back page', back: false, forward: true }
  })
  receive({ token: 'mount-1', type: 'dom-ready' })
  expect(surface.getURL()).toBe('https://example.com/back')
  expect(surface.getTitle()).toBe('Back page')
  expect(surface.canGoBack()).toBe(false)
  expect(surface.canGoForward()).toBe(true)
  expect(navigation).toHaveBeenCalledTimes(2)
  expect(ready).toHaveBeenCalledTimes(2)
  await surface.goBack()
  await surface.loadURL('https://example.com/explicit-navigation')
  expect(bridge.command.mock.calls).toEqual([
    ['mount-1', 'goBack', []],
    ['mount-1', 'loadURL', ['https://example.com/explicit-navigation']]
  ])
})

it('sends page zoom to the existing native page and follows its applied scale', async () => {
  const { bridge, connect, receive, surface } = setup()
  connect()
  await vi.waitFor(() => expect(surface.getWebContentsId()).toBe(81))
  await surface.setPageZoom(0.75)
  expect(bridge.command).toHaveBeenLastCalledWith('mount-1', 'setPageZoom', [0.75])
  receive({ token: 'mount-1', type: 'page-zoom-changed', snapshot: { ...snapshot(), zoom: 0.75, zoomMode: 'manual' } })
  expect(surface.getZoomFactor()).toBe(0.75)
  expect(surface.getPageZoomMode()).toBe('manual')
  await surface.setPageZoom('fit')
  expect(bridge.command).toHaveBeenLastCalledWith('mount-1', 'setPageZoom', ['fit'])
  receive({ token: 'mount-1', type: 'page-zoom-changed', snapshot: { ...snapshot(), zoom: 0.67, zoomMode: 'fit' } })
  expect(surface.getZoomFactor()).toBe(0.67)
  expect(surface.getPageZoomMode()).toBe('fit')
  expect(bridge.mount).toHaveBeenCalledOnce()
  expect(bridge.release).not.toHaveBeenCalled()
})

it('restores the retained document runner after an attachment download without reviving its old binding', async () => {
  const { connect, receive, surface } = setup()
  cleanups.push(registerPreviewScriptRunner('tab-one', async () => undefined))
  cleanups.push(watchPreviewDocumentLifecycle(surface, 'tab-one'))
  const ready = vi.fn()
  surface.addEventListener('dom-ready', ready)
  connect()
  await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce())
  const before = previewScriptRunnerFor('tab-one')!

  receive({
    token: 'mount-1',
    type: 'did-start-navigation',
    isMainFrame: true,
    isInPlace: false,
    snapshot: { ...snapshot(), ready: false, loading: true }
  })
  expect(previewScriptRunnerFor('tab-one')).toBeNull()
  receive({ token: 'mount-1', type: 'did-stop-loading', snapshot: snapshot() })
  expect(previewScriptRunnerFor('tab-one')?.runner).toBe(before.runner)
  expect(isSamePreviewDocument(before)).toBe(false)
  expect(ready).toHaveBeenCalledTimes(2)
  receive({ token: 'mount-1', type: 'did-stop-loading', snapshot: snapshot() })
  expect(ready).toHaveBeenCalledTimes(2)

  receive({
    token: 'mount-1',
    type: 'did-start-navigation',
    isMainFrame: true,
    isInPlace: false,
    snapshot: { ...snapshot(), ready: false, loading: true }
  })
  receive({ token: 'mount-1', type: 'did-stop-loading', snapshot: { ...snapshot(), ready: false } })
  expect(previewScriptRunnerFor('tab-one')).toBeNull()
  expect(ready).toHaveBeenCalledTimes(2)
})

it('releases only its own late mount token after unmount without publishing stale page events', async () => {
  const { bridge, connect, listeners, surface } = setup()
  const mounted = deferred<NativePreviewSnapshot>()
  bridge.mount.mockReturnValueOnce(mounted.promise)
  const ready = vi.fn()
  surface.addEventListener('dom-ready', ready)
  const stop = connect()
  expect(listeners.size).toBe(1)
  stop()
  expect(listeners.size).toBe(0)
  expect(surface.isConnected).toBe(false)
  expect(bridge.release).not.toHaveBeenCalled()
  mounted.resolve(snapshot('late-old-mount'))
  await vi.waitFor(() => expect(bridge.release).toHaveBeenCalledExactlyOnceWith('late-old-mount'))
  expect(ready).not.toHaveBeenCalled()
  expect(watchNativePreviewPlacement).not.toHaveBeenCalled()
  expect(bridge.command).not.toHaveBeenCalled()
})

it('waits for native input and propagates a rejected stale mount command to its next observation', async () => {
  const { bridge, connect, surface } = setup()
  connect()
  await vi.waitFor(() => expect(surface.getWebContentsId()).toBe(81))
  const input = deferred<undefined>()
  bridge.command.mockReturnValueOnce(input.promise)
  const key: PreviewInputEvent = { type: 'keyDown', keyCode: 'Enter' }
  void surface.sendInputEvent(key)
  let finished = false
  const settling = surface.settleInput().then(() => {
    finished = true
  })
  await Promise.resolve()
  expect(finished).toBe(false)
  input.resolve(undefined)
  await settling
  expect(bridge.command).toHaveBeenLastCalledWith('mount-1', 'sendInputEvent', [key])

  const transferred = new Error('Native Browser attachment does not belong to this window')
  bridge.command.mockRejectedValueOnce(transferred)
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

  try {
    void surface.sendInputEvent(key)
    await expect(surface.settleInput()).rejects.toBe(transferred)
    // The failed action has been reported; a later fresh observation may proceed.
    await expect(surface.settleInput()).resolves.toBeUndefined()
  } finally {
    logged.mockRestore()
  }
})

it('restores the failed page snapshot with its error details instead of announcing a ready document', async () => {
  const { bridge, connect, surface } = setup()
  const failure = { code: -118, description: 'ERR_CONNECTION_TIMED_OUT', url: 'https://unreachable.example/' }
  bridge.mount.mockResolvedValueOnce({ ...snapshot(), ready: false, url: failure.url, loadFailure: failure })
  const ready = vi.fn()
  const failed = vi.fn()
  const order: string[] = []
  surface.addEventListener('dom-ready', ready)
  surface.addEventListener('did-navigate-in-page', () => order.push('navigate'))
  surface.addEventListener('did-stop-loading', () => order.push('stop'))
  surface.addEventListener('did-fail-load', event => {
    failed(event)
    order.push('failure')
  })
  connect()
  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce())

  expect(failed).toHaveBeenCalledWith(
    expect.objectContaining({
      errorCode: failure.code,
      errorDescription: failure.description,
      validatedURL: failure.url,
      isMainFrame: true
    })
  )
  expect(order).toEqual(['navigate', 'stop', 'failure'])
  expect(surface.getURL()).toBe(failure.url)
  expect(ready).not.toHaveBeenCalled()
  expect(bridge.command).not.toHaveBeenCalled()
})
