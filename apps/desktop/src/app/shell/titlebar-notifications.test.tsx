import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, useNavigate } from 'react-router'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $notifications, notify, resetNotifications } from '@/store/notifications'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

import { TitlebarControls } from './titlebar-controls'

beforeAll(() => {
  stubResizeObserver()
  stubMenuDomApis()
})
beforeEach(resetNotifications)
afterEach(() => {
  cleanup()
  resetNotifications()
  vi.useRealTimers()
})

function mountToolbar() {
  let navigate!: ReturnType<typeof useNavigate>

  function Navigation() {
    const current = useNavigate()

    useEffect(() => {
      navigate = current
    }, [current])

    return null
  }

  render(
    <I18nProvider configClient={null} initialLocale="en">
      <MemoryRouter>
        <Navigation />
        <TitlebarControls />
        <textarea aria-label="Conversation draft" defaultValue="Keep this draft" />
      </MemoryRouter>
    </I18nProvider>
  )

  return (path: string) => act(() => navigate(path))
}

it('keeps one top-bar notification card and its current detail when navigating to Settings', () => {
  notify({
    id: 'offline',
    title: 'Offline',
    message: 'Your draft is kept',
    detail: '/work/'.repeat(100),
    durationMs: 0
  })
  const navigate = mountToolbar()
  const draft = screen.getByRole('textbox', { name: 'Conversation draft' })
  const trigger = screen.getByRole('button', { name: 'Notifications and status (1)' })
  expect(trigger.closest('[data-titlebar-cluster="right"]')).toBeTruthy()
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: /Offline\s*Your draft is kept/ }))
  const heading = screen.getByRole('heading', { name: 'Offline' })
  expect(screen.getByRole('dialog', { name: 'Notifications and status' })).toBeTruthy()
  expect(window.document.querySelector('.notification-bar')).toBeNull()

  navigate('/settings')
  expect(screen.getAllByRole('button', { name: 'Notifications and status (1)' })).toHaveLength(1)
  expect(screen.getByRole('heading', { name: 'Offline' })).toBe(heading)
  expect(screen.getByRole('textbox', { name: 'Conversation draft' })).toBe(draft)
  expect((draft as HTMLTextAreaElement).value).toBe('Keep this draft')
  expect(draft.closest('[inert]')).toBeNull()
})

it('pauses the selected notice while reading and returns keyboard focus on Escape', () => {
  vi.useFakeTimers()
  notify({ id: 'timed', title: 'Saved', message: 'Temporary feedback', durationMs: 1_000 })
  mountToolbar()
  const trigger = screen.getByRole('button', { name: 'Notifications and status (1)' })
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: /Saved\s*Temporary feedback/ }))
  act(() => vi.advanceTimersByTime(1_500))
  expect($notifications.get()).toHaveLength(1)

  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Notifications and status' }), { key: 'Escape' })
  act(() => vi.advanceTimersByTime(0))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(window.document.activeElement).toBe(trigger)
  act(() => vi.advanceTimersByTime(1_001))
  expect($notifications.get()).toHaveLength(0)
})

it('retires an old owner detail even when a new account reuses the notice ID', () => {
  notify({ id: 'account', title: 'Private diagnostic', message: 'Account one', durationMs: 0 })
  mountToolbar()
  fireEvent.click(screen.getByRole('button', { name: 'Notifications and status (1)' }))
  fireEvent.click(screen.getByRole('button', { name: /Private diagnostic\s*Account one/ }))
  act(() => {
    resetNotifications()
    notify({ id: 'account', title: 'New account reminder', message: 'Account two', durationMs: 0 })
  })
  expect(screen.queryByText('Account one')).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Private diagnostic' })).toBeNull()
  expect(screen.getByRole('button', { name: /New account reminder\s*Account two/ })).toBeTruthy()
  expect(screen.getByRole('status').textContent).toBe('New account reminder: Account two')
})

it('announces new notifications and exposes their count without opening the card or stealing focus', () => {
  mountToolbar()
  const draft = screen.getByRole('textbox', { name: 'Conversation draft' })
  draft.focus()
  expect(screen.getByRole('button', { name: 'Notifications and status' })).toBeTruthy()

  act(() => {
    notify({ title: 'Saved', message: 'Workspace updated', durationMs: 0 })
  })
  expect(screen.getByRole('button', { name: 'Notifications and status (1)' })).toBeTruthy()
  expect(screen.getByRole('status').textContent).toBe('Saved: Workspace updated')

  act(() => {
    notify({ kind: 'error', title: 'Connection failed', message: 'Reconnect to continue', durationMs: 0 })
  })
  expect(screen.getByRole('button', { name: 'Notifications and status (2)' })).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toBe('Connection failed: Reconnect to continue')
  expect(screen.getByRole('status').textContent).toBe('')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(window.document.activeElement).toBe(draft)
})

it('preserves focus moved outside the notification card', async () => {
  notify({ id: 'focus', message: 'Reminder', durationMs: 0 })
  mountToolbar()
  fireEvent.click(screen.getByRole('button', { name: 'Notifications and status (1)' }))
  await act(async () => {
    await new Promise(resolve => window.setTimeout(resolve, 0))
  })

  const draft = screen.getByRole('textbox', { name: 'Conversation draft' })
  await act(async () => draft.focus())

  expect(screen.queryByRole('dialog')).toBeNull()
  expect(window.document.activeElement).toBe(draft)
})

it('preserves focus on an outside click and returns to the bell when explicitly closed', async () => {
  notify({ id: 'focus', message: 'Reminder', durationMs: 0 })
  mountToolbar()
  const trigger = screen.getByRole('button', { name: 'Notifications and status (1)' })
  fireEvent.click(trigger)
  await act(async () => {
    await new Promise(resolve => window.setTimeout(resolve, 0))
  })

  const draft = screen.getByRole('textbox', { name: 'Conversation draft' })
  await act(async () => {
    fireEvent.pointerDown(draft)
    draft.focus()
    fireEvent.click(draft)
  })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(window.document.activeElement).toBe(draft)

  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(window.document.activeElement).toBe(trigger)
})
