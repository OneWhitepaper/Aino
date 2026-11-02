// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { registry } from '@/contrib/registry'
import { I18nProvider } from '@/i18n'
import { $chatTextScale, setChatTextScale } from '@/store/chat-text-scale'
import { $sessionListDensity, setSessionListDensity } from '@/store/session-list-density'
import { $hideThreadTimeline, setHideThreadTimeline } from '@/store/thread-timeline'
import { $tipsEnabled, setTipsEnabled } from '@/store/tips'
import { stubMenuDomApis } from '@/test/jsdom'

import { APPEARANCE_AREAS } from './appearance-contrib'
import { AppearanceSettings } from './appearance-settings'

const original = {
  textScale: $chatTextScale.get(),
  density: $sessionListDensity.get(),
  hideTimeline: $hideThreadTimeline.get(),
  tips: $tipsEnabled.get()
}

const originalScroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
const disposers: Array<() => void> = []

beforeEach(() => {
  stubMenuDomApis()
  act(() => {
    setChatTextScale(110)
    setSessionListDensity('compact')
    setHideThreadTimeline(false)
    setTipsEnabled(true)
  })
})

afterEach(() => {
  cleanup()
  disposers.splice(0).forEach(dispose => dispose())
  act(() => {
    setChatTextScale(original.textScale)
    setSessionListDensity(original.density)
    setHideThreadTimeline(original.hideTimeline)
    setTipsEnabled(original.tips)
  })

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

function renderPage(path = '/settings?tab=config:appearance', subpage?: string) {
  return render(
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

async function select(label: string, value: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }))
  fireEvent.click(await screen.findByRole('option', { name: value }))
}

function openCategory(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 })
  expect(screen.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('tabpanel', { name })).toBeTruthy()
}

it('keeps appearance choices when moving through all five categories', async () => {
  renderPage()
  expect(screen.getAllByRole('tab')).toHaveLength(5)
  await select('Chat Text Size', '125%')

  openCategory('Window & layout')
  await select('Session List Density', 'Detailed')

  openCategory('Chat display')
  fireEvent.click(screen.getByRole('switch', { name: 'Hide thread timeline bars' }))

  openCategory('Habits & guidance')
  fireEvent.click(screen.getByRole('switch', { name: 'In-App Tips' }))

  openCategory('Desktop pets')
  openCategory('Theme & text')
  expect(screen.getByRole('combobox', { name: 'Chat Text Size' }).textContent).toContain('125%')

  openCategory('Window & layout')
  expect(screen.getByRole('combobox', { name: 'Session List Density' }).textContent).toContain('Detailed')
  openCategory('Chat display')
  expect(screen.getByRole('switch', { name: 'Hide thread timeline bars' }).getAttribute('aria-checked')).toBe('true')
  openCategory('Habits & guidance')
  expect(screen.getByRole('switch', { name: 'In-App Tips' }).getAttribute('aria-checked')).toBe('false')
  expect($chatTextScale.get()).toBe(125)
  expect($sessionListDensity.get()).toBe('detailed')
  expect($hideThreadTimeline.get()).toBe(true)
  expect($tipsEnabled.get()).toBe(false)
})

it.each([
  { target: 'appearance.terminal-font', category: 'Theme & text', disclosure: 'Terminal Font' },
  { target: 'appearance.hide-code-diffs', category: 'Chat display', disclosure: 'Tool & file results' }
])('opens the category and disclosure for a search link to $target', async ({ target, category, disclosure }) => {
  const scroll = vi.fn()
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll })
  renderPage(`/settings?tab=config:appearance&setting=${target}`)

  await waitFor(() => {
    expect(screen.getByRole('tab', { name: category }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('button', { name: disclosure }).getAttribute('aria-expanded')).toBe('true')
    expect(window.document.activeElement?.id).toBe(`setting-field-${target}`)
    expect(screen.getByRole('status', { name: 'Settings location' }).textContent).not.toContain('setting=')
  })
  expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
})

it('keeps plugin appearance controls reachable from Habits & guidance', () => {
  act(() => {
    disposers.push(
      registry.register({
        area: APPEARANCE_AREAS.extra,
        id: 'navigation-extra-controls',
        render: () => <button type="button">Plugin appearance preference</button>,
        source: 'disk'
      })
    )
  })
  renderPage()
  expect(screen.queryByRole('button', { name: 'Plugin appearance preference' })).toBeNull()
  openCategory('Habits & guidance')
  expect(screen.getByRole('button', { name: 'Plugin appearance preference' })).toBeTruthy()
})

it('opens a legacy chat display entry and still lets the user move between categories', () => {
  renderPage('/settings?tab=config:appearance', 'chat-display')

  expect(screen.getByRole('tab', { name: 'Chat display' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('switch', { name: 'Hide thread timeline bars' })).toBeTruthy()
  openCategory('Window & layout')
  expect(screen.getByRole('combobox', { name: 'Session List Density' })).toBeTruthy()
})

it('switches appearance categories with the arrow keys while retaining keyboard focus', async () => {
  renderPage()
  const first = screen.getByRole('tab', { name: 'Theme & text' })

  act(() => first.focus())
  fireEvent.keyDown(first, { key: 'ArrowRight' })

  await waitFor(() => {
    const next = screen.getByRole('tab', { name: 'Window & layout' })

    expect(window.document.activeElement).toBe(next)
    expect(next.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel', { name: 'Window & layout' })).toBeTruthy()
  })
})
