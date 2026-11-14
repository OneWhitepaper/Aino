import { afterEach, expect, it, vi } from 'vitest'

import { guardGuestPointers } from '@/lib/guest-pointer-guard'
import { deferred } from '@/test/deferred'

import type { NativePreviewBridge } from '../../../../shared/preview-native'

import { nativePreviewPlacement, watchNativePreviewPlacement } from './preview-native-placement'

const originalDesktop = window.hermesDesktop
const cleanups: Array<() => void> = []

function surface() {
  const pane = document.createElement('section')
  const element = document.createElement('div')
  pane.appendChild(element)
  document.body.appendChild(pane)
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(20.4, 70.2, 600.4, 400.2))

  return { element, pane }
}

afterEach(() => {
  cleanups.splice(0).forEach(stop => stop())
  document.body.replaceChildren()
  document.body.classList.remove('guest-pointer-lock')
  window.hermesDesktop = originalDesktop
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('places the native guest in zoomed window coordinates', () => {
  const { element } = surface()
  window.hermesDesktop = { ...originalDesktop, zoom: { factor: () => 1.25 } } as Window['hermesDesktop']
  expect(nativePreviewPlacement(element)).toEqual({
    bounds: { x: 26, y: 88, width: 751, height: 500 },
    visible: true,
    covered: false,
    blocking: false
  })
})

it.each(['data-pane-hidden', 'inert'])('keeps a retained native page off screen while its pane has %s', attribute => {
  const { element, pane } = surface()
  pane.setAttribute(attribute, '')
  expect(nativePreviewPlacement(element)).toMatchObject({ visible: false, covered: false })
  pane.removeAttribute(attribute)
  expect(nativePreviewPlacement(element).visible).toBe(true)
})

it.each([{ display: 'none' }, { visibility: 'hidden' }, { opacity: '0' }])(
  'honors hidden ancestor styles %j without destroying the retained surface', style => {
    const { element, pane } = surface()
    Object.assign(pane.style, style)
    expect(nativePreviewPlacement(element).visible).toBe(false)
    expect(element.isConnected).toBe(true)
    pane.removeAttribute('style')
    expect(nativePreviewPlacement(element).visible).toBe(true)
  }
)

it('yields native hit testing to overlapping dialogs and restores it when they close', () => {
  const { element } = surface()
  const overlay = document.createElement('div')
  overlay.setAttribute('role', 'dialog')
  vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 200, 200))
  document.body.appendChild(overlay)
  expect(nativePreviewPlacement(element)).toMatchObject({ visible: false, covered: true })
  overlay.dataset.state = 'closed'
  expect(nativePreviewPlacement(element)).toMatchObject({ visible: true, covered: false })
  overlay.dataset.state = 'open'
  overlay.style.display = 'none'
  expect(nativePreviewPlacement(element)).toMatchObject({ visible: true, covered: false })
  overlay.style.display = 'block'
  vi.mocked(overlay.getBoundingClientRect).mockReturnValue(new DOMRect(900, 100, 100, 100))
  expect(nativePreviewPlacement(element)).toMatchObject({ visible: true, covered: false })
})

it('lets a resize gesture pass over the native guest until the pointer guard is released', () => {
  const { element } = surface()
  const release = guardGuestPointers()

  try {
    expect(nativePreviewPlacement(element)).toMatchObject({ visible: false, covered: true })
  } finally {
    release()
  }

  expect(nativePreviewPlacement(element)).toMatchObject({ visible: true, covered: false })
  element.remove()
  expect(nativePreviewPlacement(element).visible).toBe(false)
})

function placementWatcher() {
  const { element } = surface()
  Object.assign(element, {getWebContentsId: () => 41})
  const captures = [deferred<string>(), deferred<string>()]
  const decoded: Array<ReturnType<typeof deferred<void>>> = []
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)

    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {frames.delete(id)})
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('Image', class {
    src = ''
    decode = () => {
      const ready = deferred<void>()
      decoded.push(ready)

      return ready.promise
    }
  })
  const capturePreview = vi.fn().mockReturnValueOnce(captures[0].promise).mockReturnValueOnce(captures[1].promise)
  window.hermesDesktop = {...originalDesktop, capturePreview}
  const bridge = {layout: vi.fn()} as unknown as NativePreviewBridge
  const stop = watchNativePreviewPlacement(element, bridge, 'current-token')
  cleanups.push(stop)

  const flush = async () => {
    await Promise.resolve()
    const waiting = [...frames.values()]
    frames.clear()
    waiting.forEach(callback => callback(0))
    await Promise.resolve()
  }

  const overlay = (slot: 'tooltip-content' | 'dialog-overlay') => {
    const node = document.createElement('div')
    node.dataset.slot = slot
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 200, 40))
    document.body.appendChild(node)

    return node
  }

  return {element, bridge, capturePreview, captures, decoded, flush, overlay, stop}
}

it('keeps the live native page until a tooltip backdrop is captured and decoded, then retains it while restoring', async () => {
  const {element, bridge, captures, decoded, flush, overlay} = placementWatcher()
  await flush()
  const tip = overlay('tooltip-content')
  await flush()
  expect(bridge.layout).toHaveBeenCalledOnce()
  expect(bridge.layout).toHaveBeenLastCalledWith('current-token', expect.anything(), true)
  captures[0].resolve('data:image/png;base64,first')
  await flush()
  expect(decoded).toHaveLength(1)
  expect(bridge.layout).toHaveBeenCalledOnce()
  decoded[0].resolve()
  await flush()
  await flush()
  expect(element.style.backgroundImage).toContain('first')
  expect(bridge.layout).toHaveBeenLastCalledWith('current-token', expect.anything(), false)
  tip.remove()
  await flush()
  expect(bridge.layout).toHaveBeenLastCalledWith('current-token', expect.anything(), true)
  expect(element.style.backgroundImage).toContain('first')
})

it('does not hide the page or publish a stale capture when a tooltip closes before its capture returns', async () => {
  const {element, bridge, captures, decoded, flush, overlay} = placementWatcher()
  await flush()
  const tip = overlay('tooltip-content')
  await flush()
  tip.remove()
  await flush()
  captures[0].resolve('data:image/png;base64,obsolete')
  await flush()
  expect(decoded).toHaveLength(0)
  expect(element.style.backgroundImage).toBe('')
  expect(bridge.layout).toHaveBeenCalledOnce()
})

it('hides immediately for a blocking modal even while its replacement image is still unavailable', async () => {
  const {bridge, captures, flush, overlay} = placementWatcher()
  await flush()
  overlay('dialog-overlay')
  await flush()
  expect(bridge.layout).toHaveBeenLastCalledWith('current-token', expect.anything(), false)
  captures[0].reject(new Error('Capture unavailable'))
  await flush()
  expect(bridge.layout).toHaveBeenLastCalledWith('current-token', expect.anything(), false)
})

it('ignores an old decode after tooltip replacement and never paints after watcher disposal', async () => {
  const {element, bridge, captures, decoded, flush, overlay, stop} = placementWatcher()
  await flush()
  const first = overlay('tooltip-content')
  await flush()
  captures[0].resolve('data:image/png;base64,old')
  await flush()
  first.remove()
  await flush()
  overlay('tooltip-content')
  await flush()
  decoded[0].resolve()
  await flush()
  expect(element.style.backgroundImage).toBe('')
  expect(bridge.layout).toHaveBeenCalledOnce()
  captures[1].resolve('data:image/png;base64,new')
  await flush()
  expect(decoded).toHaveLength(2)
  stop()
  decoded[1].resolve()
  await flush()
  expect(element.style.backgroundImage).toBe('')
  expect(bridge.layout).toHaveBeenCalledOnce()
})
