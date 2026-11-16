import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { TITLEBAR_HEIGHT } from '@/app/shell/titlebar'

import { OverlayView, RoutePageSurface } from './overlay-view'

const fixture = vi.hoisted(() => ({ auxiliary: false }))

vi.mock('@/store/windows', () => ({
  isAuxiliaryWindow: () => fixture.auxiliary
}))

afterEach(() => {
  cleanup()
  fixture.auxiliary = false
})

function renderPage(onClose = vi.fn()) {
  const { container } = render(
    <RoutePageSurface value={true}>
      <OverlayView closeLabel="Close page" onClose={onClose}>
        <p>Page content</p>
      </OverlayView>
    </RoutePageSurface>
  )

  return container.querySelector<HTMLElement>('[data-aino-route-page]')!
}

it('reserves the activity rail while a route page owns the main window', () => {
  const close = vi.fn()
  const page = renderPage(close)

  expect(page.style.left).toBe('var(--aino-activity-width)')
  expect(page.style.top).toBe(`${TITLEBAR_HEIGHT}px`)
  expect(screen.getByText('Page content')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Close page' }))
  expect(close).toHaveBeenCalledOnce()
})

it('fills an auxiliary window without reserving a missing activity rail', () => {
  fixture.auxiliary = true
  const close = vi.fn()
  const page = renderPage(close)

  expect(page.style.left).toBe('0px')
  expect(page.style.top).toBe(`${TITLEBAR_HEIGHT}px`)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(close).toHaveBeenCalledOnce()
})

it.each([false, true])('keeps ordinary dialogs independent of the activity rail (auxiliary=%s)', auxiliary => {
  fixture.auxiliary = auxiliary

  const close = vi.fn()

  const { container } = render(
    <OverlayView closeLabel="Close dialog" onClose={close}>
      <p>Dialog content</p>
    </OverlayView>
  )

  const dialog = container.querySelector<HTMLElement>('[data-aino-overlay]')!

  expect(dialog.hasAttribute('data-aino-route-page')).toBe(false)
  expect(dialog.style.left).toBe('')
  expect(dialog.style.top).toBe('')
  expect(screen.getByText('Dialog content')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
  expect(close).toHaveBeenCalledOnce()
})
