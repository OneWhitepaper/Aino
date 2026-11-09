import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './dialog'

afterEach(cleanup)

describe('DialogContent close button', () => {
  it('closes the dialog when clicked', () => {
    const onOpenChange = vi.fn()
    render(
      <Dialog onOpenChange={onOpenChange} open>
        <DialogContent>
          <DialogTitle>Test dialog</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('DialogContent fixed actions', () => {
  it.each([false, true])('keeps its optional title outside the reading area and preserves accessible description (banner %s)', banner => {
    render(
      <Dialog open>
        <DialogContent
          banner={banner ? 'Additional information' : undefined}
          footer={<button>Continue</button>}
          header={<DialogTitle>Read before continuing</DialogTitle>}
        >
          <DialogDescription>{'Long description. '.repeat(100)}</DialogDescription>
        </DialogContent>
      </Dialog>
    )

    const dialog = screen.getByRole('dialog', { name: 'Read before continuing' })
    const title = screen.getByRole('heading', { name: 'Read before continuing' })
    const description = screen.getByText(/Long description\./)
    const body = description.closest('[data-slot="dialog-body"]')
    expect(title.closest('[data-slot="dialog-fixed-header"]')).toBeTruthy()
    expect(title.closest('[data-slot="dialog-body"]')).toBeNull()
    expect(body).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue' }).closest('[data-slot="dialog-body"]')).toBeNull()
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id)
    expect(dialog.getAttribute('aria-describedby')).toBe(description.id)
  })

  it('keeps fixed actions associated with their body form', () => {
    const submit = vi.fn(event => event.preventDefault())
    render(
      <Dialog open>
        <DialogContent
          footer={
            <DialogFooter>
              <button form="dialog-form" type="submit">
                Save
              </button>
            </DialogFooter>
          }
        >
          <DialogTitle>Edit workspace</DialogTitle>
          <form id="dialog-form" onSubmit={submit}>
            <label>
              Workspace name
              <input defaultValue="Project" name="name" />
            </label>
          </form>
        </DialogContent>
      </Dialog>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(submit).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('textbox', { name: 'Workspace name' }).getAttribute('name')).toBe('name')
  })

  it('locks shared dismissal chrome and restores Escape after work settles', () => {
    const onOpenChange = vi.fn()

    const dialog = (busy: boolean) => (
      <Dialog onOpenChange={onOpenChange} open>
        <DialogContent dismissDisabled={busy}>
          <DialogTitle>Save workspace</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    const view = render(dialog(true))
    const close = screen.getByRole('button', { name: /close/i })
    expect(close.hasAttribute('disabled')).toBe(true)
    fireEvent.click(close)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onOpenChange).not.toHaveBeenCalled()

    view.rerender(dialog(false))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
