import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createElement, type CSSProperties } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { registry } from '@/contrib/registry'

import { usePaneLifecycle, usePaneVisible } from '../../pane-visibility'

import { KeepAlivePanes, KeepAlivePaneSlot } from './keep-alive-panes'
import { ToolTrackMotion } from './tool-track-motion'

interface AnimationProbe {
  animation: Animation
  cancel: ReturnType<typeof vi.fn>
  finish: () => void
  frames: Keyframe[]
  target: HTMLElement
}

const animations: AnimationProbe[] = []
const disconnected: HTMLElement[] = []
const disposers: (() => void)[] = []
const observers = new Set<ResizeObserverProbe>()
const pendingInitialObservations = new Set<Element>()

class ExitPaintGuest extends HTMLElement {
  disconnectedCallback() {
    disconnected.push(this)
  }
}

customElements.define('exit-paint-guest', ExitPaintGuest)

class ResizeObserverProbe {
  targets = new Set<Element>()
  constructor(readonly callback: ResizeObserverCallback) {
    observers.add(this)
  }
  observe(target: Element) {
    this.targets.add(target)
    pendingInitialObservations.add(target)

    // Slots receive the spec's pre-paint delivery after their visibility
    // context commits. Track/host probes retain their fixture size seeding.
    if (!target.parentElement?.hasAttribute('data-tree-track')) {
      this.callback([{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry], this)
    }
  }
  unobserve(target: Element) {
    this.targets.delete(target)
    pendingInitialObservations.delete(target)
  }
  disconnect() {
    this.targets.clear()
  }
}

// Native ResizeObserver delivers a new subscription's first measurement after
// layout effects, even when that element's size did not change while hidden.
function deliverInitialObservations() {
  const targets = [...pendingInitialObservations]
  pendingInitialObservations.clear()

  for (const observer of observers) {
    const entries = targets
      .filter(target => observer.targets.has(target))
      .map(target => ({ target, contentRect: target.getBoundingClientRect() }) as ResizeObserverEntry)

    if (entries.length) {
      observer.callback(entries, observer)
    }
  }
}

function resizeSlot(width: number) {
  const slot = globalThis.document.querySelector('[data-tree-track]')!.firstElementChild!

  for (const observer of observers) {
    if (observer.targets.has(slot)) {
      observer.callback(
        [{ target: slot, contentRect: new DOMRectReadOnly(0, 0, width, 240) } as ResizeObserverEntry],
        observer
      )
    }
  }
}

function registerPane(id: string) {
  function Body() {
    return createElement(
      'exit-paint-guest',
      { 'data-guest': id, 'data-visible': String(usePaneVisible()), 'data-lifecycle': usePaneLifecycle() },
      <input defaultValue="Keep this page" />
    )
  }

  disposers.push(
    registry.register({
      area: 'panes',
      id,
      data: { lifecycleKeepAlive: true, toolPanel: true },
      render: Body
    })
  )
}

beforeEach(() => {
  pendingInitialObservations.clear()
  vi.stubGlobal('ResizeObserver', ResizeObserverProbe)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const authoredWidth = this.style.width || this.closest<HTMLElement>('[data-tree-track]')?.style.width || ''
    const width = this.style.display === 'none' ? 0 : Number.parseFloat(authoredWidth) || 360
    const height = this.style.display === 'none' ? 0 : Number.parseFloat(this.style.height) || 240

    return { width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON: () => ({}) }
  })
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: function (this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
      let finish!: () => void
      let reject!: (reason: Error) => void

      const finished = new Promise<void>((resolve, rejectPromise) => {
        finish = resolve
        reject = rejectPromise
      })

      // Reveal animations do not consume their finished promise.
      void finished.catch(() => undefined)

      const animation = {
        playState: 'running',
        currentTime: 24,
        finished,
        effect: {
          target: this,
          getKeyframes: () => frames,
          getTiming: () => options,
          getComputedTiming: () => ({ progress: 0.25 })
        },
        cancel: vi.fn(() => {
          animation.playState = 'idle'
          reject(new Error('cancelled'))
        })
      }

      animations.push({
        animation: animation as unknown as Animation,
        cancel: animation.cancel,
        finish,
        frames,
        target: this
      })

      return animation
    }
  })
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: function (this: HTMLElement) {
      return animations
        .filter(probe => probe.target === this && probe.animation.playState !== 'idle')
        .map(probe => probe.animation)
    }
  })
  registerPane('browser')
  registerPane('background')
  disconnected.length = 0
})

afterEach(() => {
  cleanup()
  disposers.splice(0).forEach(dispose => dispose())
  animations.length = 0
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
})

interface WorkspaceOptions {
  active?: string
  collapsed?: boolean
  scope?: string
  groupId?: string
  width?: number
  horizontal?: boolean
}

function workspace({
  active = 'browser',
  collapsed = false,
  scope = 'account-a',
  groupId = 'tools',
  width = 360,
  horizontal = true
}: WorkspaceOptions = {}) {
  const style: CSSProperties = collapsed
    ? { display: 'none' }
    : { ...(horizontal ? { width } : { height: 288 }), flex: '1 1 auto' }

  return (
    <KeepAlivePanes>
      <ToolTrackMotion
        collapsed={collapsed}
        enabled
        horizontal={horizontal}
        id="tools"
        minimized={false}
        scope={scope}
        style={style}
      >
        {['browser', 'background'].map(paneId => (
          <KeepAlivePaneSlot
            groupId={groupId}
            headerVisible
            key={paneId}
            paneId={paneId}
            visible={!collapsed && active === paneId}
          />
        ))}
      </ToolTrackMotion>
    </KeepAlivePanes>
  )
}

const host = (id = 'browser') => globalThis.document.querySelector<HTMLElement>(`[data-pane-host="${id}"]`)!
const guest = (id = 'browser') => globalThis.document.querySelector<HTMLElement>(`[data-guest="${id}"]`)!
const viewportWidth = (id = 'browser') => host(id).style.getPropertyValue('--pane-track-width')
const trackAnimation = () => animations.findLast(probe => probe.target.hasAttribute('data-tree-track'))!

it('keeps only the closing guest pixels while interaction and live subscriptions hide immediately', async () => {
  const view = render(workspace())
  const page = guest()
  const editor = page.querySelector('input')!
  const body = host()
  editor.value = 'Unsubmitted browser form'
  editor.focus()
  view.rerender(workspace({ collapsed: true }))

  expect(body.style.visibility).toBe('visible')
  expect(body.hasAttribute('data-pane-exit-paint')).toBe(true)
  expect(body.hasAttribute('inert')).toBe(true)
  expect(body.hasAttribute('data-pane-hidden')).toBe(true)
  expect(page.dataset.visible).toBe('false')
  expect(page.dataset.lifecycle).toBe('hot-hidden')
  expect(page.ownerDocument.activeElement).not.toBe(editor)
  expect(viewportWidth()).toBe('360px')
  expect(animations.findLast(probe => probe.target === body)!.frames.at(-1)?.clipPath).toBe('inset(0 360px 0 0)')

  await act(async () => trackAnimation().finish())
  expect(body.style.visibility).toBe('')
  expect(body.hasAttribute('data-pane-exit-paint')).toBe(false)
  expect(guest()).toBe(page)
  expect(editor.value).toBe('Unsubmitted browser form')
  expect(disconnected).not.toContain(page)
})

it('does not reveal another cached tab or an unrelated replacement placement on close', () => {
  const view = render(workspace({ active: 'background' }))
  view.rerender(workspace())
  const cached = host('background')
  view.rerender(workspace({ collapsed: true }))
  expect(host().style.visibility).toBe('visible')
  expect(cached.style.visibility).toBe('')
  expect(cached.hasAttribute('data-pane-exit-paint')).toBe(false)

  view.rerender(workspace({ collapsed: true, groupId: 'replacement' }))
  expect(host().style.visibility).toBe('')
  expect(host().hasAttribute('data-pane-exit-paint')).toBe(false)
})

it.each(['resize', 'sash', 'scope'])('clears closing paint when %s takes over', async reason => {
  const view = render(workspace())
  view.rerender(workspace({ collapsed: true }))
  expect(host().style.visibility).toBe('visible')
  const closing = trackAnimation()

  await act(async () => {
    if (reason === 'scope') {
      view.rerender(workspace({ collapsed: true, scope: 'account-b' }))
    } else if (reason === 'resize') {
      fireEvent(window, new Event('resize'))
    } else {
      const sash = view.container.ownerDocument.createElement('div')
      sash.setAttribute('role', 'separator')
      view.container.ownerDocument.body.append(sash)
      fireEvent.pointerDown(sash)
      sash.remove()
    }
  })

  expect(closing.cancel).toHaveBeenCalledOnce()
  expect(host().style.visibility).toBe('')
  expect(host().hasAttribute('data-pane-exit-paint')).toBe(false)
})

it('reopening clears the old exit without disconnecting the guest or a late completion hiding it', async () => {
  const view = render(workspace())
  const page = guest()
  view.rerender(workspace({ collapsed: true }))
  const closing = trackAnimation()
  view.rerender(workspace())
  expect(host().style.visibility).toBe('')
  expect(host().hasAttribute('data-pane-exit-paint')).toBe(false)
  expect(page.dataset.visible).toBe('true')
  await act(async () => closing.finish())
  expect(host().classList.contains('invisible')).toBe(false)
  expect(guest()).toBe(page)
  expect(disconnected).not.toContain(page)
})

it('opens a guest at the final viewport width while only the visible clip follows the track', async () => {
  const view = render(workspace({ collapsed: true }))
  view.rerender(workspace({ width: 480 }))
  const body = host()
  const page = guest()
  const opening = trackAnimation()

  expect(opening.frames.map(frame => frame.clipPath)).toEqual(['inset(0 480px 0 0)', 'inset(0 0px 0 0)'])
  expect(viewportWidth()).toBe('480px')
  expect(page.dataset.visible).toBe('true')
  expect(body.hasAttribute('inert')).toBe(false)
  const paint = animations.findLast(probe => probe.target === body)!
  expect(paint.frames.map(frame => frame.clipPath)).toEqual(['inset(0 480px 0 0)', 'inset(0 0px 0 0)'])
  expect(paint.frames.every(frame => frame.opacity === undefined)).toBe(true)
  expect(paint.animation.currentTime).toBe(opening.animation.currentTime)

  view.rerender(workspace({ width: 480 }))
  expect(viewportWidth()).toBe('480px')
  expect(paint.cancel).not.toHaveBeenCalled()
  act(() => resizeSlot(14))
  expect(viewportWidth()).toBe('480px')

  await act(async () => opening.finish())
  expect(viewportWidth()).toBe('480px')
  expect(body.hasAttribute('data-pane-hidden')).toBe(false)
  expect(body.hasAttribute('inert')).toBe(false)
  expect(page.dataset.visible).toBe('true')
  expect(guest()).toBe(page)
  expect(disconnected).not.toContain(page)
})

it('reopens at the current track target instead of a stale kept width', async () => {
  const view = render(workspace())
  const page = guest()
  view.rerender(workspace({ collapsed: true }))
  await act(async () => trackAnimation().finish())
  expect(host().style.getPropertyValue('--pane-kept-width')).toBe('360px')

  view.rerender(workspace({ width: 520 }))
  expect(viewportWidth()).toBe('520px')
  expect(guest()).toBe(page)
  expect(disconnected).not.toContain(page)
})

it('closes an interrupted first opening at its final viewport without disconnecting the guest', () => {
  const view = render(workspace({ collapsed: true }))
  view.rerender(workspace({ width: 480 }))
  const page = guest()
  // The first observer delivery has not caught up with the final open width.
  host().style.setProperty('--pane-kept-width', '360px')
  view.rerender(workspace({ width: 480, collapsed: true }))
  const closing = trackAnimation()

  expect(closing.frames.map(frame => frame.width)).toEqual(['480px', '480px'])
  expect(closing.frames.map(frame => frame.clipPath)).toEqual(['inset(0 360px 0 0)', 'inset(0 480px 0 0)'])
  expect(viewportWidth()).toBe('480px')
  expect(host().style.width).toBe('480px')
  expect(animations.findLast(probe => probe.target === host())!.frames.map(frame => frame.clipPath)).toEqual([
    'inset(0 360px 0 0)',
    'inset(0 480px 0 0)'
  ])
  expect(guest()).toBe(page)
  expect(disconnected).not.toContain(page)
})

it.each(['resize', 'sash', 'scope', 'tab'])('releases the opening clip when %s takes over', async reason => {
  const view = render(workspace({ collapsed: true }))
  view.rerender(workspace({ width: 480 }))
  expect(viewportWidth()).toBe('480px')

  await act(async () => {
    if (reason === 'scope') {
      view.rerender(workspace({ width: 480, scope: 'account-b' }))
    } else if (reason === 'tab') {
      view.rerender(workspace({ width: 480, active: 'background' }))
    } else if (reason === 'resize') {
      fireEvent(window, new Event('resize'))
    } else {
      const sash = view.container.ownerDocument.createElement('div')
      sash.setAttribute('role', 'separator')
      view.container.ownerDocument.body.append(sash)
      fireEvent.pointerDown(sash)
      sash.remove()
    }
  })

  if (reason === 'tab') {
    expect(host().style.width).toBe('var(--pane-kept-width, 0px)')
  }

  expect(viewportWidth()).toBe('480px')
  expect(host().hasAttribute('data-pane-track-paint')).toBe(false)
  expect(host().style.visibility).toBe('')
})

it('follows real slot resizes in both directions without consuming hidden or zero sizes', async () => {
  const view = render(workspace({ collapsed: true }))
  view.rerender(workspace({ width: 480 }))
  const page = guest()
  await act(async () => trackAnimation().finish())
  act(() => resizeSlot(300))
  expect(viewportWidth()).toBe('300px')
  act(() => resizeSlot(620))
  expect(viewportWidth()).toBe('620px')
  act(() => resizeSlot(0))
  expect(viewportWidth()).toBe('620px')

  view.rerender(workspace({ width: 480, active: 'background' }))
  act(() => resizeSlot(210))
  expect(viewportWidth()).toBe('620px')
  expect(guest()).toBe(page)
  expect(disconnected).not.toContain(page)
})

it('uses the current slot width when returning to a tab resized while hidden', async () => {
  const view = render(workspace({ collapsed: true }))
  view.rerender(workspace({ width: 480 }))
  const page = guest()
  await act(async () => trackAnimation().finish())
  act(deliverInitialObservations)
  expect(viewportWidth()).toBe('480px')

  view.rerender(workspace({ width: 480, active: 'background' }))
  act(deliverInitialObservations)
  view.rerender(workspace({ width: 300, active: 'background' }))
  act(() => resizeSlot(300))
  expect(viewportWidth()).toBe('480px')

  view.rerender(workspace({ width: 300 }))
  act(deliverInitialObservations)
  expect(viewportWidth()).toBe('300px')
  expect(guest()).toBe(page)
  expect(disconnected).not.toContain(page)
})

it('retains the body viewport below a vertical track header while closing', async () => {
  const view = render(workspace({ horizontal: false }))
  const page = guest()
  const body = host()
  expect(body.style.getPropertyValue('--pane-kept-height')).toBe('240px')
  view.rerender(workspace({ collapsed: true, horizontal: false }))
  const closing = trackAnimation()

  expect(closing.frames.map(frame => frame.height)).toEqual(['288px', '0px'])
  expect(body.style.height).toBe('240px')
  expect(body.style.visibility).toBe('visible')
  expect(animations.findLast(probe => probe.target === body)!.frames.map(frame => frame.clipPath)).toEqual([
    'inset(0 0 0px 0)',
    'inset(0 0 240px 0)'
  ])
  expect(body.hasAttribute('inert')).toBe(true)
  await act(async () => closing.finish())
  expect(body.style.height).toBe('var(--pane-kept-height, 0px)')
  expect(guest()).toBe(page)
  expect(disconnected).not.toContain(page)
})
