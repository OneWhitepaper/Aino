import { act, cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import type { HermesConnection } from '@/global'
import { $connection } from '@/store/session'
import { $zoomPercent } from '@/store/zoom'

const fixture = vi.hoisted(() => ({ measuredWidth: null as number | null }))

vi.mock('../agents/collaboration-capsule', () => ({ CollaborationCapsule: () => null }))
vi.mock('../shell/titlebar-controls', () => ({ TitlebarControls: () => null }))
vi.mock('../shell/wslg-window-controls', () => ({ WslgWindowControls: () => null }))
vi.mock('../shell/use-touch-titlebar', () => ({ useTouchTitlebar: () => false }))
vi.mock('../shell/hooks/use-window-controls-overlay-width', () => ({
  useWindowControlsOverlayWidth: () => fixture.measuredWidth
}))
vi.mock('./panes', () => ({ useTitlebarToolContributions: () => [] }))

import { WiringTitlebar } from './wiring-titlebar'

const initialConnection = $connection.get()
const initialZoom = $zoomPercent.get()

afterEach(() => {
  cleanup()
  $connection.set(initialConnection)
  $zoomPercent.set(initialZoom)
  fixture.measuredWidth = null
})

it.each([
  { caption: 'native fallback', measured: null, custom: false, expected: '160px' },
  { caption: 'measured native captions', measured: 154, custom: false, expected: '154px' },
  { caption: 'renderer captions', measured: null, custom: true, expected: '144px' }
])('reserves the correct caption width for $caption at reduced UI zoom', ({ measured, custom, expected }) => {
  fixture.measuredWidth = measured
  $zoomPercent.set(90)
  $connection.set({
    baseUrl: 'http://localhost:3111',
    logs: [],
    token: '',
    wsUrl: '',
    nativeOverlayWidth: 144,
    windowButtonPosition: null,
    isFullscreen: false,
    customWindowControls: custom
  } satisfies HermesConnection)

  const { container } = render(
    <MemoryRouter>
      <WiringTitlebar>
        <span>Workspace</span>
      </WiringTitlebar>
    </MemoryRouter>
  )

  const chrome = container.firstElementChild as HTMLElement

  expect(chrome.style.getPropertyValue('--titlebar-tools-right')).toBe(expected)
  act(() => $connection.set({ ...$connection.get()!, isFullscreen: true }))
  expect(chrome.style.getPropertyValue('--titlebar-tools-right')).toBe('14px')
  act(() => $connection.set({ ...$connection.get()!, isFullscreen: false }))
  expect(chrome.style.getPropertyValue('--titlebar-tools-right')).toBe(expected)
})
