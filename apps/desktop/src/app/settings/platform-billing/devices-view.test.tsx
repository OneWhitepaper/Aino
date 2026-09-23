import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { queryClient } from '@/lib/query-client'

import type {
  PlatformAccountBridge,
  PlatformBillingScope,
  PlatformDevice,
  PlatformDevicesBridge
} from '../../../../shared/platform-contract'

import { PlatformDevices } from './devices-view'

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
})

const scope = { origin: 'http://127.0.0.1:8080', user_id: '17', generation: 1 }

const device: PlatformDevice = {
  device_id: '67c7ac16-8bac-46c3-a3a8-ae8c11b390ad',
  last_used_at: '2026-09-16T01:00:00Z',
  expires_at: '2099-09-16T02:00:00Z',
  revoked: false
}

function view(
  bridge: PlatformDevicesBridge,
  owner: PlatformBillingScope = scope,
  accountBridge?: Pick<PlatformAccountBridge, 'submitStepUp'>
) {
  return (
    <I18nProvider configClient={null} initialLocale="en">
      <PlatformDevices accountBridge={accountBridge} bridge={bridge} scope={owner} />
    </I18nProvider>
  )
}

it('suppresses old account results and confirms a scoped revoke with explicit TOTP recovery before reloading', async () => {
  let release!: (rows: PlatformDevice[]) => void
  let current = [device]
  let secondFactor = false

  const list = vi.fn(async ({ expected_user_id }) =>
    expected_user_id === '17'
      ? new Promise<PlatformDevice[]>(resolve => {
          release = resolve
        })
      : current
  )

  const revoke = vi.fn(async () => {
    if (!secondFactor) {
      throw { code: 'STEP_UP_REQUIRED' }
    }

    current = [{ ...device, revoked: true }]

    return { revoked: true as const }
  })

  const submitStepUp = vi.fn(async () => {
    secondFactor = true

    return {} as never
  })

  const bridge = { list, revoke }
  const f = render(view(bridge, scope, { submitStepUp }))
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
  const next = { ...scope, user_id: '18', generation: 2 }
  f.rerender(view(bridge, next, { submitStepUp }))
  await screen.findByText(device.device_id)
  await act(async () => release([{ ...device, device_id: 'old-device-should-not-paint' }]))
  expect(screen.queryByText('old-device-should-not-paint')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
  expect(revoke).not.toHaveBeenCalled()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke' }))
  const code = await screen.findByRole('textbox', { name: 'Authenticator code' })
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.change(code, { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
  await screen.findByRole('dialog')
  expect(submitStepUp).toHaveBeenCalledWith({ totp_code: '123456', expected_user_id: '18', expected_generation: 2 })
  expect(revoke).toHaveBeenCalledTimes(1)
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke' }))
  await screen.findByText('Authorization revoked')
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Revoke' }).disabled).toBe(true))
  expect(revoke).toHaveBeenLastCalledWith({
    device_id: device.device_id,
    expected_user_id: '18',
    expected_generation: 2
  })
})

it('loads only while visible and leaves recent-auth failures recoverable without claiming revocation', async () => {
  let visible = false
  vi.spyOn(window.document, 'visibilityState', 'get').mockImplementation(() => (visible ? 'visible' : 'hidden'))
  const list = vi.fn(async () => [device])

  const revoke = vi.fn(async () => {
    throw { code: 'RECENT_AUTH_REQUIRED' }
  })

  render(view({ list, revoke }))
  expect(list).not.toHaveBeenCalled()
  visible = true
  fireEvent(window.document, new Event('visibilitychange'))
  await screen.findByText(device.device_id)
  fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke' }))
  await screen.findByText('Sign out and sign in again before revoking this authorization.')
  expect(screen.queryByText('Authorization revoked')).toBeNull()
  expect(revoke).toHaveBeenCalledTimes(1)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Revoke' }).disabled).toBe(false)
})
