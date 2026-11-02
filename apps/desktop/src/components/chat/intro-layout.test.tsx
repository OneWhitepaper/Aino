// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

import { Intro } from './intro'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('home composer slot positioning', () => {
  it('follows only its owning viewport scroll and stops publishing after unmount', () => {
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrame = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback)

      return nextFrame
    })
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame))

    const flushFrames = () => {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach(callback => callback(0))
    }

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('aino-home-composer-slot')) {
        const viewport = this.closest<HTMLElement>('[data-slot="aui_thread-viewport"]')!

        return new DOMRect(0, 240 - viewport.scrollTop, 400, 200)
      }

      return new DOMRect(0, 40, 400, 600)
    })

    const { container, unmount } = render(
      <I18nProvider configClient={null} initialLocale="en">
        <div data-chat-surface="">
          <div data-slot="aui_thread-viewport">
            <Intro home personality="none" seed={0} />
          </div>
        </div>
        <div data-chat-surface="">
          <div data-slot="aui_thread-viewport" />
        </div>
      </I18nProvider>
    )

    const surface = container.querySelector<HTMLElement>('[data-chat-surface]')!
    const [viewport, otherViewport] = container.querySelectorAll<HTMLElement>('[data-slot="aui_thread-viewport"]')

    expect(surface.style.getPropertyValue('--aino-home-composer-top')).toBe('200px')
    otherViewport.scrollTop = 85
    fireEvent.scroll(otherViewport)
    flushFrames()
    expect(surface.style.getPropertyValue('--aino-home-composer-top')).toBe('200px')

    viewport.scrollTop = 85
    fireEvent.scroll(viewport)
    flushFrames()
    expect(surface.style.getPropertyValue('--aino-home-composer-top')).toBe('115px')

    viewport.scrollTop = 100
    fireEvent.scroll(viewport)
    unmount()
    expect(frames.size).toBe(0)
    expect(surface.style.getPropertyValue('--aino-home-composer-top')).toBe('')
    fireEvent.scroll(viewport)
    flushFrames()
    expect(frames.size).toBe(0)
    expect(surface.style.getPropertyValue('--aino-home-composer-top')).toBe('')
  })

  it('republishes the slot offset when only its layout box changes size', () => {
    const observers: Array<{ onResize: () => void; targets: Set<Element> }> = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        readonly targets = new Set<Element>()
        constructor(readonly onResize: () => void) {
          observers.push(this)
        }
        observe(target: Element) {
          this.targets.add(target)
        }
        disconnect() {
          this.targets.clear()
        }
      }
    )

    let slotTop = 240
    let layoutHeight = 600
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('aino-home-composer-slot')) {
        return new DOMRect(0, slotTop, 400, 200)
      }

      if (this.classList.contains('aino-home-layout')) {
        return new DOMRect(0, 40, 400, layoutHeight)
      }

      // The surrounding chat surface and intrinsic home content do not resize.
      return new DOMRect(0, 40, 400, 700)
    })

    const { container, unmount } = render(
      <I18nProvider configClient={null} initialLocale="en">
        <div data-chat-surface="">
          <Intro home personality="none" seed={0} />
        </div>
      </I18nProvider>
    )

    const surface = container.querySelector<HTMLElement>('[data-chat-surface]')!
    const layout = container.querySelector<HTMLElement>('.aino-home-layout')!
    const slot = container.querySelector<HTMLElement>('.aino-home-composer-slot')!
    const expectedOffset = () => `${slot.getBoundingClientRect().top - surface.getBoundingClientRect().top}px`

    expect(surface.style.getPropertyValue('--aino-home-composer-top')).toBe(expectedOffset())

    layoutHeight -= 170
    slotTop += 85

    for (const observer of observers) {
      if (observer.targets.has(layout)) {
        observer.onResize()
      }
    }

    expect(surface.style.getPropertyValue('--aino-home-composer-top')).toBe(expectedOffset())
    unmount()
    expect(surface.style.getPropertyValue('--aino-home-composer-top')).toBe('')
  })
})
