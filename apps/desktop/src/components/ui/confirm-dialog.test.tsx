import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmDialog } from './confirm-dialog'

afterEach(cleanup)

describe('ConfirmDialog secondary action', () => {
  function renderWithSecondary() {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    const onSecondary = vi.fn()

    render(
      <ConfirmDialog
        onClose={onClose}
        onConfirm={onConfirm}
        open
        secondaryAction={{ label: 'Remove from sidebar', onClick: onSecondary }}
        title="Remove worktree?"
      />
    )

    return { onClose, onConfirm, onSecondary }
  }

  it('runs the secondary action and closes without confirming', async () => {
    const { onClose, onConfirm, onSecondary } = renderWithSecondary()

    fireEvent.click(await screen.findByRole('button', { name: 'Remove from sidebar' }))

    expect(onSecondary).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('still opens focused on Confirm, so Enter confirms rather than picking the secondary', async () => {
    const { onConfirm, onSecondary } = renderWithSecondary()

    const dialog = await screen.findByRole('dialog')

    // eslint-disable-next-line no-restricted-globals -- asserting real focus requires the live document
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    // eslint-disable-next-line no-restricted-globals -- asserting real focus requires the live document
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' })

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    expect(onSecondary).not.toHaveBeenCalled()
  })

  it('opens destructive dialogs on Cancel and keeps Space from confirming', async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()

    render(
      <ConfirmDialog
        cancelLabel="Cancel"
        confirmLabel="Delete"
        destructive
        onClose={onClose}
        onConfirm={onConfirm}
        open
        title="Delete session?"
      />
    )

    const cancel = await screen.findByRole('button', { name: 'Cancel' })
    // eslint-disable-next-line no-restricted-globals -- focus ownership is the behavior under test
    await waitFor(() => expect(document.activeElement).toBe(cancel))
    fireEvent.keyDown(cancel, { key: ' ' })

    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('ConfirmDialog pending work and recovery', () => {
  it('locks both decisions while the secondary action runs and retains its failure for retry', async () => {
    let reject!: (error: Error) => void

    const onSecondary = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, fail) => {
            reject = fail
          })
      )
      .mockResolvedValueOnce(undefined)

    const onClose = vi.fn()
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        confirmLabel="Delete"
        destructive
        onClose={onClose}
        onConfirm={onConfirm}
        open
        secondaryAction={{ label: 'Remove from sidebar', onClick: onSecondary }}
        title="Delete session?"
      />
    )

    const secondary = screen.getByRole('button', { name: 'Remove from sidebar' })
    act(() => {
      secondary.click()
      secondary.click()
      screen.getByRole('button', { name: 'Delete' }).click()
    })
    expect(onSecondary).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await act(async () => reject(new Error('Archive refused')))
    expect(screen.getByRole('alert').textContent).toContain('Archive refused')
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove from sidebar' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('does not close a replacement decision when the previous secondary action settles', async () => {
    let resolve!: () => void
    const onClose = vi.fn()

    const view = (open: boolean) => (
      <ConfirmDialog
        onClose={onClose}
        onConfirm={vi.fn()}
        open={open}
        secondaryAction={{
          label: 'Remove from sidebar',
          onClick: () =>
            new Promise<void>(done => {
              resolve = done
            })
        }}
        title="Delete session?"
      />
    )

    const { rerender } = render(view(true))
    fireEvent.click(screen.getByRole('button', { name: 'Remove from sidebar' }))
    rerender(view(false))
    rerender(view(true))
    await act(async () => resolve())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirm' }).hasAttribute('disabled')).toBe(false)
  })

  it.each([false, true])(
    'locks every dismiss and repeated submit while pending (dismissOnConfirm: %s)',
    async dismissOnConfirm => {
      let resolve!: () => void

      const pending = new Promise<void>(yes => {
        resolve = yes
      })

      const onConfirm = vi.fn(() => pending)
      const onClose = vi.fn()
      const onSecondary = vi.fn()

      render(
        <ConfirmDialog
          cancelLabel="Cancel"
          confirmLabel="Delete"
          dismissOnConfirm={dismissOnConfirm}
          onClose={onClose}
          onConfirm={onConfirm}
          open
          secondaryAction={{ label: 'Keep in sidebar', onClick: onSecondary }}
          title="Delete session?"
        />
      )

      const submit = screen.getByRole('button', { name: 'Delete' })
      const cancel = screen.getByRole('button', { name: 'Cancel' })
      const secondary = screen.getByRole('button', { name: 'Keep in sidebar' })
      act(() => {
        submit.click()
        submit.click()
        cancel.click()
        secondary.click()
      })
      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)
      expect(screen.getByRole('button', { name: 'Keep in sidebar' }).hasAttribute('disabled')).toBe(true)
      const close = screen.getByRole('button', { name: 'Close' })
      expect(close.hasAttribute('disabled')).toBe(true)
      fireEvent.click(close)
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
      expect(onClose).not.toHaveBeenCalled()
      expect(onSecondary).not.toHaveBeenCalled()

      await act(async () => resolve())
      expect(onClose).toHaveBeenCalledTimes(dismissOnConfirm ? 1 : 0)
    }
  )

  it('keeps a failed confirmation visible and lets the user retry the same action', async () => {
    const failure = new Error(`Unable to remove /project/${'long-directory/'.repeat(30)}file.md`)
    const onConfirm = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined)
    const onClose = vi.fn()
    render(<ConfirmDialog confirmLabel="Delete" onClose={onClose} onConfirm={onConfirm} open title="Delete session?" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect((await screen.findByRole('alert')).textContent).toContain(failure.message)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2))
  })

  it('keeps the decision title and actions fixed while reading a long description or failure', async () => {
    const description = 'These files will be removed.\n'.repeat(100)
    const failure = new Error('Removal failed; the files are still available.')
    render(
      <ConfirmDialog
        confirmLabel="Delete"
        description={description}
        onClose={vi.fn()}
        onConfirm={() => Promise.reject(failure)}
        open
        title="Delete files?"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const alert = await screen.findByRole('alert')
    const dialog = screen.getByRole('dialog', { name: 'Delete files?' })
    const title = screen.getByRole('heading', { name: 'Delete files?' })
    const descriptionNode = screen.getByText(/These files will be removed\./)
    const body = alert.closest('[data-slot="dialog-body"]')
    expect(body).toBeTruthy()
    expect(descriptionNode.closest('[data-slot="dialog-body"]')).toBe(body)
    expect(descriptionNode.textContent).toBe(description)
    expect(title.closest('[data-slot="dialog-fixed-header"]')).toBeTruthy()
    expect(title.closest('[data-slot="dialog-body"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete' }).closest('[data-slot="dialog-fixed-footer"]')).toBeTruthy()
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id)
    expect(dialog.getAttribute('aria-describedby')).toBe(descriptionNode.id)
    expect(alert.textContent).toContain(failure.message)
  })
})
