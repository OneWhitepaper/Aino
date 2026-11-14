import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      common: { cancel: 'Cancel', confirm: 'Confirm', delete: 'Delete', done: 'Done', loading: 'Working' },
      errors: { genericFailure: 'Something failed' }
    }
  })
}))

test.each(['unmount', 'reopen', 'stay open'] as const)('owns the done beat until %s', async leave => {
  const onClose = vi.fn()
  const onConfirm = vi.fn()

  const dialog = (open: boolean) => (
    <ConfirmDialog confirmLabel="Delete" onClose={onClose} onConfirm={onConfirm} open={open} title="Delete session" />
  )

  const view = render(dialog(true))

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete' })))
  expect(screen.getByRole('button', { name: 'Done' }).hasAttribute('disabled')).toBe(true)
  act(() => vi.advanceTimersByTime(599))
  expect(onClose).not.toHaveBeenCalled()

  if (leave === 'unmount') {
    view.unmount()
  } else if (leave === 'reopen') {
    view.rerender(dialog(false))
    view.rerender(dialog(true))
  }

  act(() => vi.advanceTimersByTime(1))
  expect(onClose).toHaveBeenCalledTimes(leave === 'stay open' ? 1 : 0)
})

const settlements = [
  { dismissOnConfirm: false, outcome: 'success' },
  { dismissOnConfirm: false, outcome: 'error' },
  { dismissOnConfirm: true, outcome: 'success' },
  { dismissOnConfirm: true, outcome: 'error' }
] as const

test.each(settlements.flatMap(settlement => (['unmount', 'reopen'] as const).map(leave => ({ ...settlement, leave }))))(
  'ignores $outcome after $leave (dismissOnConfirm: $dismissOnConfirm)',
  async ({ dismissOnConfirm, leave, outcome }) => {
    let resolve!: () => void
    let reject!: (error: Error) => void

    const pending = new Promise<void>((yes, no) => {
      resolve = yes
      reject = no
    })

    const onClose = vi.fn()
    const onConfirm = () => pending

    const dialog = (open: boolean) => (
      <ConfirmDialog
        dismissOnConfirm={dismissOnConfirm}
        onClose={onClose}
        onConfirm={onConfirm}
        open={open}
        title="Delete session"
      />
    )

    const view = render(dialog(true))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    if (leave === 'unmount') {
      view.unmount()
    } else {
      view.rerender(dialog(false))
      view.rerender(dialog(true))
    }

    // A caller may remove the dialog before its confirmation promise settles.
    await act(async () => {
      if (outcome === 'success') {
        resolve()
      } else {
        reject(new Error('Old confirmation failed'))
      }
    })
    act(() => vi.advanceTimersByTime(600))
    expect(onClose).not.toHaveBeenCalled()

    if (leave === 'reopen') {
      expect(screen.getByRole('button', { name: 'Confirm' }).hasAttribute('disabled')).toBe(false)
      expect(screen.queryByText('Old confirmation failed')).toBeNull()
    }
  }
)

// The confirm action itself can unmount the dialog's owner (disbanding a group
// room closes the room view). The await in run() then resolves after cleanup
// already ran, so a timer armed at that point had nobody left to clear it.
test('a confirm that unmounts the dialog before it resolves never arms the close timer', async () => {
  vi.useFakeTimers()
  const onClose = vi.fn()

  let finish: () => void = () => {}
  const onConfirm = vi.fn(
    () =>
      new Promise<void>(resolve => {
        finish = resolve
      })
  )

  render(<ConfirmDialog confirmLabel="Delete" onClose={onClose} onConfirm={onConfirm} open title="Delete session" />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  expect(onConfirm).toHaveBeenCalled()

  cleanup()
  finish()
  await Promise.resolve()
  await Promise.resolve()
  vi.advanceTimersByTime(1000)

  expect(onClose).not.toHaveBeenCalled()
  vi.useRealTimers()
})
