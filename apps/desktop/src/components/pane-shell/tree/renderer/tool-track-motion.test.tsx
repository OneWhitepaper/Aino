import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { type CSSProperties } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ToolTrackMotion } from './tool-track-motion'

interface CapturedAnimation {
  cancel: ReturnType<typeof vi.fn>
  finish: () => void
  frames: Keyframe[]
  options: KeyframeAnimationOptions
}

const animations: CapturedAnimation[] = []
let reduced = false
let visualSize: number | null = null

class TestResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(element: Element) {
    this.callback([{ target: element, contentRect: element.getBoundingClientRect() } as ResizeObserverEntry], this)
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  reduced = false
  visualSize = null
  const media = new EventTarget()
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reduced
    },
    addEventListener: media.addEventListener.bind(media),
    removeEventListener: media.removeEventListener.bind(media)
  }))
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const element = this
    const width = visualSize ?? (element.style.display === 'none' ? 0 : Number.parseFloat(element.style.width) || 360)
    const height = element.style.display === 'none' ? 0 : Number.parseFloat(element.style.height) || 240

    return { width, height, x: 0, y: 0, top: 0, left: 0, bottom: height, right: width, toJSON: () => ({}) }
  })
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: (frames: Keyframe[], options: KeyframeAnimationOptions) => {
      let finish!: () => void

      const finished = new Promise<void>(resolve => {
        finish = resolve
      })

      const animation = {
        cancel: vi.fn(() => {
          visualSize = null
        }),
        finish,
        frames,
        options
      }

      animations.push(animation)

      return { ...animation, finished }
    }
  })
})

afterEach(() => {
  cleanup()
  animations.length = 0
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(HTMLElement.prototype, 'animate')
})

interface TrackOptions {
  collapsed?: boolean
  enabled?: boolean
  horizontal?: boolean
  minimized?: boolean
  scope?: string
  size?: number
}

function track({
  collapsed = false,
  enabled = true,
  horizontal = true,
  minimized = false,
  scope = 'account-a',
  size = 360
}: TrackOptions = {}) {
  const style: CSSProperties = collapsed
    ? { display: 'none' }
    : horizontal
      ? { width: minimized ? 28 : size, flex: '1 1 auto' }
      : { height: minimized ? 36 : size, flex: '1 1 auto' }

  return (
    <ToolTrackMotion
      collapsed={collapsed}
      enabled={enabled}
      horizontal={horizontal}
      id="tools"
      minimized={minimized}
      scope={scope}
      style={style}
    >
      <button type="button">Hide panel</button>
      <textarea defaultValue="Keep this draft" />
    </ToolTrackMotion>
  )
}

it('animates explicit tool open and close while retaining the child and hiding logical interaction immediately', async () => {
  const view = render(track())
  const editor = view.container.querySelector('textarea')!
  const host = editor.parentElement!
  expect(animations).toHaveLength(0)

  view.rerender(track({ collapsed: true }))
  expect(animations[0].frames.map(frame => frame.width)).toEqual(['360px', '0px'])
  expect(animations[0].options.duration).toBe(160)
  expect(host.hasAttribute('data-pane-hidden')).toBe(true)
  expect(host.hasAttribute('inert')).toBe(true)
  expect(view.queryByRole('button', { name: 'Hide panel' })).toBeNull()
  expect(host.dataset.toolTrackMotion).toBe('closing')
  await act(async () => animations[0].finish())
  expect(animations[0].cancel).toHaveBeenCalledOnce()
  expect(host.dataset.toolTrackMotion).toBeUndefined()

  view.rerender(track())
  expect(animations[1].frames.map(frame => frame.width)).toEqual(['0px', '360px'])
  expect(animations[1].options.duration).toBe(220)
  expect(host.hasAttribute('inert')).toBe(false)
  expect(view.container.querySelector('textarea')).toBe(editor)
  expect(editor.value).toBe('Keep this draft')
})

it('animates the size of a minimized bottom tool deck without animating its content tree', async () => {
  const view = render(track({ horizontal: false }))
  const editor = view.container.querySelector('textarea')!
  view.rerender(track({ horizontal: false, minimized: true }))
  expect(animations[0].frames.map(frame => frame.height)).toEqual(['360px', '36px'])
  await act(async () => animations[0].finish())
  view.rerender(track({ horizontal: false }))
  expect(animations[1].frames.map(frame => frame.height)).toEqual(['36px', '360px'])
  expect(view.container.querySelector('textarea')).toBe(editor)
})

it.each([false, true])(
  'releases collapsed track header focus without disturbing focus outside it (enabled=%s)',
  enabled => {
    const view = render(track({ enabled }))
    const headerButton = view.getByRole('button', { name: 'Hide panel' })
    const trackElement = headerButton.parentElement!
    const doc = view.container.ownerDocument
    headerButton.focus()
    expect(doc.activeElement).toBe(headerButton)

    view.rerender(track({ collapsed: true, enabled }))
    expect(trackElement.contains(doc.activeElement)).toBe(false)
    expect(trackElement.hasAttribute('inert')).toBe(true)
    expect(trackElement.querySelector('button')).toBe(headerButton)

    const outside = doc.createElement('button')
    doc.body.append(outside)
    outside.focus()
    view.rerender(track({ collapsed: true, enabled, size: 400 }))
    expect(doc.activeElement).toBe(outside)
    outside.remove()
  }
)

it('lets continuous size changes and sash gestures take over immediately', () => {
  const view = render(track({ collapsed: true }))
  view.rerender(track())
  expect(animations).toHaveLength(1)
  view.rerender(track({ size: 390 }))
  expect(animations[0].cancel).toHaveBeenCalledOnce()
  expect(animations).toHaveLength(1)
  view.rerender(track({ size: 420 }))
  expect(animations).toHaveLength(1)

  view.rerender(track({ collapsed: true }))
  view.rerender(track({ size: 420 }))
  const doc = view.container.ownerDocument
  const sash = doc.createElement('div')
  sash.setAttribute('role', 'separator')
  doc.body.append(sash)
  fireEvent.pointerDown(sash)
  expect(animations[1].cancel).toHaveBeenCalledOnce()
  sash.remove()
})

it('settles immediately when the window or owning account changes', () => {
  const view = render(track({ collapsed: true }))
  view.rerender(track())
  fireEvent(window, new Event('resize'))
  expect(animations[0].cancel).toHaveBeenCalledOnce()
  view.rerender(track({ collapsed: true, scope: 'account-b' }))
  expect(animations).toHaveLength(1)
  expect(view.container.querySelector('[data-tool-track-motion]')).toBeNull()
})

it('keeps reduced-motion and ordinary conversation tracks instant', () => {
  reduced = true
  const view = render(track({ collapsed: true }))
  view.rerender(track())
  expect(animations).toHaveLength(0)
  reduced = false
  view.rerender(track({ collapsed: true, enabled: false }))
  view.rerender(track({ enabled: false }))
  expect(animations).toHaveLength(0)
})

it.each([false, true])(
  'does not read motion APIs for an inactive or unsupported animation path (enabled=%s)',
  enabled => {
    vi.stubGlobal('matchMedia', undefined)
    Reflect.deleteProperty(HTMLElement.prototype, 'animate')
    const view = render(track({ enabled }))
    view.rerender(track({ collapsed: true, enabled }))
    expect(view.container.querySelector('[inert]')).toBeTruthy()
    view.rerender(track({ enabled }))
    expect(view.container.querySelector('[inert]')).toBeNull()
    expect(animations).toHaveLength(0)
  }
)

it('reverses an interrupted transition from its visible size and releases it on unmount', () => {
  const view = render(track())
  view.rerender(track({ collapsed: true }))
  visualSize = 140
  view.rerender(track())
  expect(animations[0].cancel).toHaveBeenCalledOnce()
  expect(animations[1].frames[0].width).toBe('140px')
  view.unmount()
  expect(animations[1].cancel).toHaveBeenCalledOnce()
})
