import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $previewTabs, openPreview } from '@/store/preview'
import { $pendingPreviewClose, cancelPreviewClose, registerPreviewSaver, setPreviewDirty } from '@/store/preview-edit'

import { PreviewCloseConfirm } from './preview-close-confirm'

afterEach(() => {
  cleanup()
  cancelPreviewClose()
  $previewTabs.set([])
})

it('disables cancel and discard while the owning editor save is pending', async () => {
  const target = {
    kind: 'file',
    label: 'pending.ts',
    path: '/pending.ts',
    source: '/pending.ts',
    url: 'file:///pending.ts'
  } as const

  openPreview(target)
  const id = $previewTabs.get()[0]!.id
  setPreviewDirty(target.url, true, id)
  let finish!: (saved: boolean) => void
  registerPreviewSaver(
    id,
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  $pendingPreviewClose.set(id)
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <PreviewCloseConfirm />
    </I18nProvider>
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Save and close' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Discard changes' }).hasAttribute('disabled')).toBe(true)
  )
  expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)
  expect($previewTabs.get()).toHaveLength(1)
  await act(async () => {
    finish(false)
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Discard changes' }).hasAttribute('disabled')).toBe(false)
  )
  expect($pendingPreviewClose.get()).toBe(id)
})
