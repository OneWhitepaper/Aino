import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $notifications, notify, resetNotifications } from '@/store/notifications'

import { NotificationStack } from './notifications'

beforeEach(resetNotifications)
afterEach(() => {
  cleanup()
  resetNotifications()
  vi.useRealTimers()
})

describe('flow-owned notifications', () => {
  it('shows notices only in the foreground frame without remounting its workspace', () => {
    notify({ id: 'frame', message: 'A shared reminder', durationMs: 0 })

    const view = (workspaceActive: boolean) => (
      <>
        <NotificationStack active={workspaceActive}>
          <textarea aria-label="Workspace draft" defaultValue="Keep this draft" />
        </NotificationStack>
        <NotificationStack active={!workspaceActive}>
          <div>Settings content</div>
        </NotificationStack>
      </>
    )

    const { rerender } = render(view(true))
    const draft = screen.getByRole('textbox', { name: 'Workspace draft' })

    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    rerender(view(false))
    expect(screen.getAllByRole('button', { name: 'Notifications and status' })).toHaveLength(1)
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: 'Workspace draft' })).toBe(draft)
    expect((draft as HTMLTextAreaElement).value).toBe('Keep this draft')
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('releases an expiring notice when its reading frame is hidden', () => {
    vi.useFakeTimers()
    notify({ id: 'timed', message: 'Temporary feedback', durationMs: 1_000 })
    const { rerender } = render(<NotificationStack />)

    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    act(() => vi.advanceTimersByTime(1_500))
    expect($notifications.get()).toHaveLength(1)
    rerender(<NotificationStack active={false} />)
    act(() => vi.advanceTimersByTime(1_001))
    expect($notifications.get()).toHaveLength(0)
  })

  it('keeps one summary, stores all notices, and leaves the conversation draft mounted', () => {
    for (let index = 0; index < 7; index++) {
      notify({ id: `notice-${index}`, message: `Notice ${index}`, durationMs: 0 })
    }

    render(
      <NotificationStack>
        <textarea aria-label="Draft" defaultValue="Keep my draft" />
      </NotificationStack>
    )
    expect(screen.getAllByRole('status')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Notifications and status' }))
    expect(screen.getByRole('button', { name: 'Notice 0' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Notice 6' })).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Draft' }) as HTMLTextAreaElement).value).toBe('Keep my draft')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('complementary')).toBeNull()
    expect((screen.getByRole('textbox', { name: 'Draft' }) as HTMLTextAreaElement).value).toBe('Keep my draft')
  })

  it('keeps a selected long detail when another notice arrives; hiding a summary retains its recovery', () => {
    const onDismiss = vi.fn()
    const detail = '/workspace/' + 'long-path-without-spaces/'.repeat(100)
    notify({ id: 'reading', title: 'Read this', message: 'Short explanation', detail, durationMs: 0, onDismiss })
    render(<NotificationStack />)
    fireEvent.mouseEnter(screen.getByRole('status'))
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByText(detail)).toBeTruthy()
    act(() => {
      notify({ id: 'arrival', message: 'A new reminder', durationMs: 0 })
    })
    expect(screen.getByText(detail)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Read this' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('status').textContent).toContain('A new reminder')
    fireEvent.click(screen.getByRole('button', { name: 'Hide summary' }))
    expect($notifications.get()).toHaveLength(2)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('keeps a failed action and shows recovery in its original detail', async () => {
    const recover = vi.fn().mockRejectedValueOnce(new Error('Still offline')).mockResolvedValueOnce(undefined)
    notify({
      id: 'offline',
      title: 'Connection interrupted',
      message: 'Your draft is kept',
      action: { label: 'Reconnect', onClick: recover }
    })
    render(<NotificationStack />)
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Still offline'))
    expect(screen.getByRole('button', { name: 'Reconnect' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    await waitFor(() => expect($notifications.get()).toHaveLength(0))
  })

  it('retires visible account-owned details together with their callbacks', () => {
    notify({ id: 'old-owner', title: 'Private diagnostic', message: 'Account one', durationMs: 0 })
    render(<NotificationStack />)
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    act(() => {
      resetNotifications()
      notify({ id: 'old-owner', title: 'New account reminder', message: 'Account two', durationMs: 0 })
    })
    expect(screen.queryByText('Account one')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Private diagnostic' })).toBeNull()
  })
})
