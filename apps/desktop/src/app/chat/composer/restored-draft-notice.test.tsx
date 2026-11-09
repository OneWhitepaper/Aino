import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $restoredDraftNotice, clearSessionDraft, stashSessionDraft, takeSessionDraft } from '@/store/composer'

import { RestoredDraftNotice } from './restored-draft-notice'

afterEach(() => {
  cleanup()
  $restoredDraftNotice.set(null)
  clearSessionDraft(null)
  clearSessionDraft('gone-session')
})

function renderNotice(liveText: string) {
  const onUndone = vi.fn()
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <RestoredDraftNotice freshDraft onUndone={onUndone} readLiveText={() => liveText} />
    </I18nProvider>
  )

  return onUndone
}

it('restores an unchanged draft to its original scope when the user chooses Undo', () => {
  stashSessionDraft(null, 'Recovered message', [])
  $restoredDraftNotice.set({ fromKey: 'gone-session', text: 'Recovered message' })
  const onUndone = renderNotice('Recovered message')

  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

  expect(onUndone).toHaveBeenCalledOnce()
  expect(takeSessionDraft('gone-session').text).toBe('Recovered message')
  expect(takeSessionDraft(null).text).toBe('')
  expect(screen.queryByRole('status')).toBeNull()
})

it('dismisses the recovery notice without discarding a draft edited after restoration', () => {
  stashSessionDraft(null, 'Edited recovered message', [])
  $restoredDraftNotice.set({ fromKey: 'gone-session', text: 'Recovered message' })
  const onUndone = renderNotice('Edited recovered message')

  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

  expect(onUndone).not.toHaveBeenCalled()
  expect(takeSessionDraft(null).text).toBe('Edited recovered message')
  expect(screen.queryByRole('status')).toBeNull()
})
