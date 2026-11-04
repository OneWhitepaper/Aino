import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { LocalFilePreview } from './preview-file'

const original = 'data:image/png;base64,b3JpZ2luYWw='

const target = {
  kind: 'file',
  label: 'wide.png',
  path: '/work/wide.png',
  previewKind: 'image',
  source: '/work/wide.png',
  url: 'file:///work/wide.png',
  dataUrl: original
} as const

// jsdom has no layout. Deliver actual stage/content measurements only after
// the production preview has loaded, like ResizeObserver after browser layout.
class LayoutObserver {
  static callbacks = new Set<ResizeObserverCallback>()
  constructor(private callback: ResizeObserverCallback) {
    LayoutObserver.callbacks.add(callback)
  }
  observe() {}
  disconnect() {
    LayoutObserver.callbacks.delete(this.callback)
  }
  static deliver() {
    act(() => {
      for (const callback of LayoutObserver.callbacks) {
        callback([], {} as ResizeObserver)
      }
    })
  }
}

function measure(image: HTMLElement, width = 400) {
  const content = image.parentElement!
  const stage = content.parentElement!.parentElement!
  Object.defineProperties(stage, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: 400 }
  })
  Object.defineProperties(content, {
    scrollWidth: { configurable: true, value: 1200 },
    scrollHeight: { configurable: true, value: 600 }
  })
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, width, 400))
  LayoutObserver.deliver()

  return { content, stage }
}

afterEach(() => {
  cleanup()
  LayoutObserver.callbacks.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('fits a file image, zooms around its centre, and restores actual size or panel fit without rereading the file', async () => {
  vi.stubGlobal('ResizeObserver', LayoutObserver)
  render(<LocalFilePreview reloadKey={0} target={target} />)
  const image = await screen.findByRole('img', { name: 'wide.png' })
  const zoomIn = screen.getByRole('button', { name: 'Zoom in' })
  const actualSize = screen.getByRole('button', { name: 'Actual size (100%)' })
  const fit = screen.getByRole('button', { name: 'Fit to panel' })
  const { content, stage } = measure(image)

  expect(content.style.transform).toBe('translate(0px, 0px) scale(0.28)')
  expect(actualSize.textContent).toBe('28%')
  fireEvent.click(zoomIn)
  expect(content.style.transform).toBe('translate(0px, 0px) scale(0.35000000000000003)')

  fireEvent.click(actualSize)
  expect(content.style.transform).toBe('translate(0px, 0px) scale(1)')
  measure(image, 600)
  expect(content.style.transform).toBe('translate(0px, 0px) scale(1)')

  const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 300, clientY: 200, deltaY: -100 })
  act(() => {
    stage.dispatchEvent(wheel)
  })
  expect(wheel.defaultPrevented).toBe(true)
  expect(content.style.transform).toBe('translate(0px, 0px) scale(1.1)')
  fireEvent.click(fit)
  expect(content.style.transform).toBe(`translate(0px, 0px) scale(${536 / 1200})`)
  expect(image.getAttribute('src')).toBe(original)
})

it('resets the viewer for a different file and keeps the new original bytes', async () => {
  vi.stubGlobal('ResizeObserver', LayoutObserver)
  const view = render(<LocalFilePreview reloadKey={0} target={target} />)
  const first = await screen.findByRole('img', { name: target.label })
  measure(first)
  fireEvent.click(screen.getByRole('button', { name: 'Actual size (100%)' }))

  const next = {
    ...target,
    label: 'next.png',
    path: '/work/next.png',
    url: 'file:///work/next.png',
    dataUrl: 'data:image/png;base64,bmV4dA=='
  }

  view.rerender(<LocalFilePreview reloadKey={1} target={next} />)
  const second = await screen.findByRole('img', { name: next.label })
  const { content } = measure(second)
  expect(content.style.transform).toBe('translate(0px, 0px) scale(0.28)')
  expect(second.getAttribute('src')).toBe(next.dataUrl)
})
