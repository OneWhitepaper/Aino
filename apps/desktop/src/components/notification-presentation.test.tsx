import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $notifications, notify, resetNotifications } from '@/store/notifications'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

import { NotificationStack } from './notifications'

beforeAll(() => {
  stubMenuDomApis()
  stubResizeObserver()
})
beforeEach(resetNotifications)
afterEach(() => {
  cleanup()
  resetNotifications()
  vi.useRealTimers()
})

function mount() {
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <NotificationStack placement="toolbar" />
      <textarea aria-label="Draft" defaultValue="Keep this" />
    </I18nProvider>
  )
}

it('shows source, receipt time, repeated count and supplied facts without inventing measurements', () => {
  const input = {
    id: 'source',
    title: 'Disk low',
    message: 'Check system storage',
    source: 'Research workspace',
    sourceKey: 'sessions.auto_prune',
    durationMs: 0,
    facts: [{ label: 'Available space', value: '700 MiB' }]
  }

  notify(input)
  notify(input)
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Notifications and status (1)' }))
  expect(screen.getByText('Research workspace')).toBeTruthy()
  const time = screen.getByLabelText(/^Received:/)
  expect(time.getAttribute('datetime')).toBe(new Date($notifications.get()[0].createdAt).toISOString())
  expect(screen.getByText('Repeated 2 times')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Disk low\s*Check system storage/ }))
  expect(screen.getByText('700 MiB')).toBeTruthy()
  expect(screen.queryByText('12.2 GB')).toBeNull()
})

it('retains an acknowledged snooze as readable history and removes it from the pending count and list action', async () => {
  const defer = vi.fn().mockResolvedValue(undefined)

  notify({
    title: 'Disk low',
    message: 'Check storage',
    source: 'Workspace one',
    durationMs: 0,
    secondaryAction: { label: 'Remind in 7 days', onClick: defer, deferForMs: 7 * 86400_000 }
  })

  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Notifications and status (1)' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remind in 7 days' })))
  expect($notifications.get()).toHaveLength(1)
  expect($notifications.get()[0].deferredUntil).toBeGreaterThan(Date.now())
  expect(screen.getByRole('button', { name: 'Notifications and status' })).toBeTruthy()
  expect(screen.getByText(/Deferred until/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Remind in 7 days' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Disk low\s*Check storage/ }))
  expect(screen.getByRole('heading', { name: 'Disk low' })).toBeTruthy()
  expect(screen.getByText('Workspace one')).toBeTruthy()
})

it('makes a short Undo visible at the bell and pauses its expiry while it is being read', async () => {
  vi.useFakeTimers()
  const undo = vi.fn()
  notify({
    id: 'undo',
    kind: 'success',
    message: 'Removed from sidebar',
    durationMs: 8000,
    action: { label: 'Undo', onClick: undo }
  })
  mount()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(window.document.querySelector('.notification-bar')).toBeNull()
  const action = screen.getByRole('button', { name: 'Undo' })
  const feedback = action.closest('article')!
  act(() => {
    fireEvent.mouseEnter(feedback)
    vi.advanceTimersByTime(9000)
  })
  expect($notifications.get()).toHaveLength(1)
  await act(async () => fireEvent.click(within(feedback).getByRole('button', { name: 'Undo' })))
  expect(undo).toHaveBeenCalledOnce()
  expect($notifications.get()).toHaveLength(0)
})

it('states that a legacy disk notice has no measurements instead of parsing technical prose', () => {
  notify({
    id: 'legacy',
    message: 'Disk low',
    sourceKey: 'sessions.auto_prune',
    detail: 'Free 12.2 GB; estimated reclaim 1 MB',
    durationMs: 0
  })
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Notifications and status (1)' }))
  fireEvent.click(screen.getByRole('button', { name: 'Disk low' }))
  expect(screen.getByText(/has not supplied storage measurements/)).toBeTruthy()
  expect(window.document.querySelector('.notification-facts')).toBeNull()
})
