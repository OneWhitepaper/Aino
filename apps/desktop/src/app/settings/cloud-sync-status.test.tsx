import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $cloudSync } from '@/store/cloud-sync'

import { CloudSyncStatusView } from './cloud-sync-status'

const disabled = $cloudSync.get()

afterEach(() => {
  cleanup()
  $cloudSync.set(disabled)
  Reflect.deleteProperty(window, 'hermesDesktop')
})

function renderStatus() {
  return render(
    <I18nProvider configClient={null} initialLocale="en">
      <CloudSyncStatusView />
    </I18nProvider>
  )
}

it('keeps failed local history visible and retries through the native sync bridge', () => {
  const retry = vi.fn().mockResolvedValue(disabled)
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { cloudSync: { retry } } })
  $cloudSync.set({ ...disabled, state: 'failed', error: 'DESKTOP_SYNC_QUOTA', pending: 3 })
  renderStatus()

  expect(screen.getByRole('status').textContent).toContain('Cloud storage is full. Your local history is retained.')
  fireEvent.click(screen.getByRole('button', { name: 'Retry sync' }))
  expect(retry).toHaveBeenCalledOnce()
  expect($cloudSync.get()).toMatchObject({ state: 'failed', error: 'DESKTOP_SYNC_QUOTA', pending: 3 })
})

it('uses backend sync transitions without offering a duplicate retry while syncing', () => {
  renderStatus()
  expect(screen.queryByRole('status')).toBeNull()

  act(() => $cloudSync.set({ ...disabled, state: 'syncing', pending: 3 }))
  expect(screen.getByRole('status').textContent).toContain('Synchronizing history')
  expect(screen.queryByRole('button', { name: 'Retry sync' })).toBeNull()

  act(() => $cloudSync.set({ ...disabled, state: 'synced' }))
  expect(screen.getByRole('status').textContent).toContain('History is synchronized')
})
