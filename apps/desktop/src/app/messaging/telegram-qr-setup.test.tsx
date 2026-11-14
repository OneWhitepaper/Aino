import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import type { MessagingPlatformInfo, TelegramOnboardingStartResponse } from '@/types/hermes'

import { TelegramQrSetup } from './telegram-qr-setup'

const api = vi.hoisted(() => ({ start: vi.fn(), poll: vi.fn(), apply: vi.fn(), cancel: vi.fn() }))
vi.mock('@/hermes', () => ({
  startTelegramOnboarding: api.start,
  getTelegramOnboardingStatus: api.poll,
  applyTelegramOnboarding: api.apply,
  cancelTelegramOnboarding: api.cancel
}))
vi.mock('qrcode', () => ({ toDataURL: vi.fn(async () => 'data:image/png;base64,qr') }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('retires an unfinished Telegram start through the registered cancel action', async () => {
  let finish!: (result: TelegramOnboardingStartResponse) => void
  api.start.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  api.cancel.mockResolvedValue({ ok: true })

  const platform: MessagingPlatformInfo = {
    id: 'telegram',
    name: 'Telegram',
    configured: false,
    enabled: false,
    description: '',
    docs_url: '',
    env_vars: [],
    gateway_running: true
  }

  const controls: { cancel: (() => Promise<void> | void) | null } = { cancel: null }

  const onCancelChange = vi.fn((cancel: (() => Promise<void> | void) | null) => {
    controls.cancel = cancel
  })

  const onBusyChange = vi.fn()
  const onApplied = vi.fn()

  const view = render(
    <I18nProvider configClient={null} initialLocale="en">
      <TelegramQrSetup
        onApplied={onApplied}
        onBusyChange={onBusyChange}
        onCancelChange={onCancelChange}
        platform={platform}
        scopeProfile="robot"
      />
    </I18nProvider>
  )

  fireEvent.click(screen.getByRole('button', { name: 'Create with QR' }))
  expect(onBusyChange).toHaveBeenLastCalledWith(false)
  await act(async () => {
    await controls.cancel?.()
  })
  expect(screen.getByRole('button', { name: 'Create with QR' })).toBeTruthy()
  await act(async () => {
    finish({
      pairing_id: 'retired-start',
      qr_payload: 'qr',
      deep_link: 'https://t.me/test',
      expires_at: new Date(Date.now() + 120_000).toISOString(),
      suggested_username: 'test'
    })
  })
  await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('retired-start', 'robot'))
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.queryByText('Waiting for Telegram…')).toBeNull()
  expect(api.poll).not.toHaveBeenCalled()
  expect(api.apply).not.toHaveBeenCalled()
  expect(onApplied).not.toHaveBeenCalled()
  view.unmount()
  expect(onCancelChange).toHaveBeenLastCalledWith(null)
  expect(onBusyChange).toHaveBeenLastCalledWith(false)
})
