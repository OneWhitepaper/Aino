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
  expect(screen.getByText('Device authorizations').closest('details')!.open).toBe(false)
  fireEvent.click(screen.getByText('Device authorizations'))
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
  fireEvent.click(screen.getByText('Device authorizations'))
  fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke' }))
  await screen.findByText('Sign out and sign in again before revoking this authorization.')
  expect(screen.queryByText('Authorization revoked')).toBeNull()
  expect(revoke).toHaveBeenCalledTimes(1)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Revoke' }).disabled).toBe(false)
})

it('distinguishes explicit and legacy expired devices from revoked ones and preserves history after revoke', async () => {
  const expiredAt = '2020-09-16T02:00:00Z'

  const cases = [
    { status: 'active', revoked: true, expires_at: device.expires_at, label: 'Active', revocable: true },
    { status: 'expired', revoked: false, expires_at: device.expires_at, label: 'Expired', revocable: true },
    { status: 'revoked', revoked: false, expires_at: expiredAt, label: 'Revoked', revocable: false },
    { revoked: true, expires_at: expiredAt, label: 'Expired', revocable: true },
    { revoked: true, expires_at: device.expires_at, label: 'Revoked', revocable: false },
    { revoked: false, expires_at: device.expires_at, label: 'Active', revocable: true }
  ] as const

  let rows = cases.map(({ label: _label, revocable: _revocable, ...state }, index) => ({
    ...device,
    ...state,
    device_id: `${device.device_id.slice(0, -1)}${index}`
  }))

  const expiredId = rows[3].device_id

  const revoke = vi.fn(async ({ device_id }: { device_id: string }) => {
    rows = rows.map(row =>
      row.device_id === device_id ? { ...row, revoked: true, last_used_at: '2026-11-04T02:00:00Z' } : row
    )

    return { revoked: true as const }
  })

  const list = vi.fn(async () => rows)
  const bridge = { list, revoke }
  const f = render(view(bridge))
  await screen.findByText(expiredId)
  fireEvent.click(screen.getByText('Device authorizations'))

  for (const [index, expected] of cases.entries()) {
    const row = within(screen.getByText(rows[index].device_id).closest('[role="listitem"]')!)
    expect(row.getByText(expected.label)).toBeTruthy()
    expect(row.getByRole<HTMLButtonElement>('button', { name: 'Revoke' }).disabled).toBe(!expected.revocable)
  }

  const expiredRow = within(screen.getByText(expiredId).closest('[role="listitem"]')!)
  fireEvent.click(expiredRow.getByRole('button', { name: 'Revoke' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke' }))
  await screen.findByText('Authorization revoked')
  expect(revoke).toHaveBeenCalledWith({ device_id: expiredId, expected_user_id: '17', expected_generation: 1 })
  expect(screen.getAllByRole('listitem')).toHaveLength(cases.length)
  await waitFor(() => expect(expiredRow.getByText('Revoked')).toBeTruthy())
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Refresh devices' }).disabled).toBe(false)
  )
  expect(expiredRow.getByRole<HTMLButtonElement>('button', { name: 'Revoke' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Refresh devices' }))
  await waitFor(() => expect(list).toHaveBeenCalledTimes(3))
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Refresh devices' }).disabled).toBe(false)
  )
  expect(expiredRow.getByText('Revoked')).toBeTruthy()
  expect(expiredRow.getByRole<HTMLButtonElement>('button', { name: 'Revoke' }).disabled).toBe(true)
  f.unmount()
  render(view(bridge))
  await waitFor(() => expect(list).toHaveBeenCalledTimes(4))
  fireEvent.click(screen.getByText('Device authorizations'))
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Refresh devices' }).disabled).toBe(false)
  )
  const restored = within(screen.getByText(expiredId).closest('[role="listitem"]')!)
  expect(restored.getByText('Revoked')).toBeTruthy()
  expect(restored.getByRole<HTMLButtonElement>('button', { name: 'Revoke' }).disabled).toBe(true)
})

it('lets explicit server state and renewed authorizations replace local revoke knowledge without leaking across owners', async () => {
  const expired: PlatformDevice = { ...device, expires_at: '2020-09-16T02:00:00Z', revoked: true }
  let current = expired
  const list = vi.fn(async () => [current])
  const revoke = vi.fn(async () => ({ revoked: true as const }))
  const bridge = { list, revoke }
  const f = render(view(bridge))
  await screen.findByText(device.device_id)
  fireEvent.click(screen.getByText('Device authorizations'))

  async function confirmRevoke() {
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke' }))
    await screen.findByText('Revoked')
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Refresh devices' }).disabled).toBe(false)
    )
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Revoke' }).disabled).toBe(true))
  }

  async function refresh(expected: string) {
    fireEvent.click(screen.getByRole('button', { name: 'Refresh devices' }))
    await screen.findByText(expected)
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Refresh devices' }).disabled).toBe(false)
    )
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Revoke' }).disabled).toBe(false)
  }

  await confirmRevoke()
  current = { ...expired, status: 'expired' }
  await refresh('Expired')
  current = expired
  await confirmRevoke()
  current = { ...expired, expires_at: '2021-09-16T02:00:00Z', last_used_at: '2021-09-16T01:00:00Z' }
  await refresh('Expired')
  await confirmRevoke()
  current = { ...device, last_used_at: '2026-11-04T02:00:00Z' }
  await refresh('Active')
  current = expired
  await refresh('Expired')
  await confirmRevoke()

  f.rerender(view(bridge, { ...scope, user_id: '18', generation: 2 }))
  await screen.findByText(device.device_id)
  fireEvent.click(screen.getByText('Device authorizations'))
  expect(screen.getByText('Expired')).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Revoke' }).disabled).toBe(false)
})

it('shows a concurrent new legacy authorization returned after revoke as active', async () => {
  let current: PlatformDevice = { ...device, expires_at: '2020-09-16T02:00:00Z', revoked: true }
  const list = vi.fn(async () => [current])

  const revoke = vi.fn(async () => {
    current = { ...device, last_used_at: '2026-11-04T02:00:00Z' }

    return { revoked: true as const }
  })

  render(view({ list, revoke }))
  await screen.findByText(device.device_id)
  fireEvent.click(screen.getByText('Device authorizations'))
  fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke' }))
  await screen.findByText('Active')
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Refresh devices' }).disabled).toBe(false)
  )
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Revoke' }).disabled).toBe(false)
})
