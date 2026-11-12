import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $notifications, notify, resetNotifications } from '@/store/notifications'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

import { NotificationStack } from './notifications'

beforeAll(() => {
  stubMenuDomApis()
  stubResizeObserver()
})
beforeEach(() => {
  vi.useFakeTimers()
  resetNotifications()
})
afterEach(() => {
  cleanup()
  resetNotifications()
  vi.useRealTimers()
})

function openTimedList() {
  notify({
    id: 'undo',
    message: 'Removed from sidebar',
    durationMs: 2_000,
    action: { label: 'Undo', onClick: () => undefined }
  })
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <NotificationStack placement="toolbar" />
      <textarea aria-label="Draft" defaultValue="Keep editing" />
    </I18nProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Notifications and status (1)' }))
  const action = screen.getByRole('button', { name: 'Undo' })

  return { action, row: action.closest('li')!, title: screen.getByRole('button', { name: 'Removed from sidebar' }) }
}

it('keeps a list action available while the pointer or keyboard is reading its row', () => {
  const { action, row, title } = openTimedList()
  fireEvent.mouseEnter(row)
  fireEvent.focus(action)
  act(() => vi.advanceTimersByTime(3_000))
  expect($notifications.get()).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Undo' })).toBe(action)

  fireEvent.mouseLeave(row)
  fireEvent.blur(action, { relatedTarget: title })
  fireEvent.focus(title)
  act(() => vi.advanceTimersByTime(3_000))
  expect($notifications.get()).toHaveLength(1)

  fireEvent.blur(title, { relatedTarget: screen.getByRole('textbox', { name: 'Draft' }) })
  act(() => vi.advanceTimersByTime(2_001))
  expect($notifications.get()).toHaveLength(0)
  expect((screen.getByRole('textbox', { name: 'Draft' }) as HTMLTextAreaElement).value).toBe('Keep editing')
})

it('releases a list reader when the card closes so a hidden notice can expire', () => {
  const { row } = openTimedList()
  fireEvent.mouseEnter(row)
  act(() => vi.advanceTimersByTime(3_000))
  expect($notifications.get()).toHaveLength(1)

  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  act(() => vi.advanceTimersByTime(2_001))
  expect($notifications.get()).toHaveLength(0)
  expect((screen.getByRole('textbox', { name: 'Draft' }) as HTMLTextAreaElement).value).toBe('Keep editing')
})
