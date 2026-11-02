// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $chatTextScale, setChatTextScale } from '@/store/chat-text-scale'
import { $zoomPercent } from '@/store/zoom'
import { stubMenuDomApis } from '@/test/jsdom'

import { AppearanceSettings } from './appearance-settings'

const originalScale = $chatTextScale.get()
const originalScroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')

beforeEach(() => {
  stubMenuDomApis()
  act(() => setChatTextScale(110))
})

afterEach(() => {
  cleanup()
  act(() => setChatTextScale(originalScale))

  if (originalScroll) {
    Object.defineProperty(Element.prototype, 'scrollIntoView', originalScroll)
  } else {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  }

  vi.restoreAllMocks()
})

function LocationProbe() {
  return <output aria-label="Settings location">{useLocation().search}</output>
}

function page(subpage?: string, path = '/settings?tab=config:appearance') {
  return (
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { enabled: false } } })}>
        <I18nProvider configClient={null} initialLocale="en">
          <AppearanceSettings subpage={subpage} />
          <LocationProbe />
        </I18nProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )
}

it('lets the appearance page change conversation text without resizing the window and retains the selection on return', async () => {
  const zoom = $zoomPercent.get()
  const first = render(page())
  const row = screen.getByText('Chat Text Size').closest<HTMLElement>('[data-settings-row]')!

  fireEvent.click(within(row).getByRole('combobox', { name: 'Chat Text Size' }))
  fireEvent.click(await screen.findByRole('option', { name: '125%' }))

  expect($chatTextScale.get()).toBe(125)
  expect(window.document.documentElement.style.getPropertyValue('--chat-text-scale')).toBe('1.25')
  expect(localStorage.getItem('hermes.desktop.chat-text-scale.v1')).toBe('125')
  expect($zoomPercent.get()).toBe(zoom)

  first.unmount()
  render(page('typography'))
  const restored = screen.getByText('Chat Text Size').closest<HTMLElement>('[data-settings-row]')!

  expect(within(restored).getByRole('combobox', { name: 'Chat Text Size' }).textContent).toContain('125%')
})

it('labels the shared 100 percent reading size as the default', async () => {
  render(page())
  const row = screen.getByText('Chat Text Size').closest<HTMLElement>('[data-settings-row]')!
  fireEvent.click(within(row).getByRole('combobox', { name: 'Chat Text Size' }))

  expect(await screen.findByRole('option', { name: '100% · Default' })).toBeTruthy()
  expect(screen.getByRole('option', { name: '110%' })).toBeTruthy()
})

it('opens a typography search link from a legacy theme entry and focuses the working control', async () => {
  const scroll = vi.fn()
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll })
  const path = '/settings?tab=config:appearance&setting=appearance.chat-text-scale'
  render(page('theme', path))

  expect(screen.getByRole('tab', { name: 'Theme & text' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('status', { name: 'Settings location' }).textContent).toContain('setting=')
  const target = screen.getByText('Chat Text Size').closest<HTMLElement>('[data-settings-row]')!

  await waitFor(() => {
    expect(window.document.activeElement).toBe(target)
    expect(screen.getByRole('status', { name: 'Settings location' }).textContent).not.toContain('setting=')
  })
  expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  fireEvent.click(within(target).getByRole('combobox', { name: 'Chat Text Size' }))
  fireEvent.click(await screen.findByRole('option', { name: '150%' }))
  expect(window.document.documentElement.style.getPropertyValue('--chat-text-scale')).toBe('1.5')
})
