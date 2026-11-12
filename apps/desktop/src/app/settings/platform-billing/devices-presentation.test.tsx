import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { queryClient } from '@/lib/query-client'

import type { PlatformDevice, PlatformDevicesBridge } from '../../../../shared/platform-contract'

import { PlatformDevices } from './devices-view'

afterEach(() => {
  cleanup()
  queryClient.clear()
})

const currentId = '0cca83f9-f797-487d-9d6c-17c4958f3c60'
const otherId = '10bf0124-c53d-47d0-a124-3b6b97d626bf'
const historyId = '206d33ae-d8ee-4152-89e2-1acdfdef1b08'
const scope = { origin: 'http://127.0.0.1:8080', user_id: '17', generation: 1 }

function row(device_id: string, extra: Partial<PlatformDevice> = {}): PlatformDevice {
  return {
    device_id,
    last_used_at: '2026-11-10T08:00:00Z',
    expires_at: null,
    revoked: false,
    status: 'active',
    ...extra
  }
}

function view(bridge: PlatformDevicesBridge) {
  return (
    <I18nProvider configClient={null} initialLocale="en">
      <PlatformDevices bridge={bridge} scope={scope} />
    </I18nProvider>
  )
}

it('puts this installation before other active devices and keeps expired authorizations folded and revocable', async () => {
  const revoke = vi.fn(async () => ({ revoked: true as const }))

  const bridge = {
    list: async () => [
      row(otherId, {
        device_info: { installation_name: 'Aino', os: 'macos', client_type: 'desktop', client_version: '0.22.4' }
      }),
      row(historyId, { status: 'expired', expires_at: '2026-11-09T10:00:00Z' }),
      row(currentId, {
        is_current: true,
        device_info: {
          installation_name: '仔仔木头',
          os: 'macos',
          client_type: 'desktop_dev',
          client_version: '0.22.4'
        }
      })
    ],
    revoke
  }

  render(view(bridge))
  await screen.findByText('This device · 仔仔木头 development · macOS')
  fireEvent.click(screen.getByText('Device authorizations'))
  const active = screen.getByRole('list', { name: 'Active devices' })
  expect(within(active).getAllByRole('listitem')[0].textContent).toContain('This device')
  expect(within(active).getByText('In use')).toBeTruthy()
  expect(within(active).getByText('Aino release · macOS')).toBeTruthy()
  const history = screen.getByText('Authorization history (1)').closest('details')!
  expect(history.open).toBe(false)
  expect(screen.getByText(currentId).closest('details')!.open).toBe(false)
  fireEvent.click(screen.getByText('Authorization history (1)'))
  expect(history.open).toBe(true)
  fireEvent.click(within(history).getByRole('button', { name: 'Revoke' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke' }))
  await waitFor(() =>
    expect(revoke).toHaveBeenCalledWith({ device_id: historyId, expected_user_id: '17', expected_generation: 1 })
  )
})

it('keeps a revoked current installation in history and leaves unknown device information honest', async () => {
  render(
    view({
      list: async () => [row(currentId, { is_current: true, status: 'revoked', revoked: true }), row(otherId)],
      revoke: async () => ({ revoked: true })
    })
  )
  await screen.findByText('Unnamed device')
  fireEvent.click(screen.getByText('Device authorizations'))
  const active = screen.getByRole('list', { name: 'Active devices' })
  expect(within(active).getAllByRole('listitem')).toHaveLength(1)
  expect(within(active).queryByText('In use')).toBeNull()
  expect(within(active).queryByText(/macOS|development/)).toBeNull()
  fireEvent.click(screen.getByText('Authorization history (1)'))
  const history = screen.getByText('Authorization history (1)').closest('details')!
  expect(within(history).getByText('This device')).toBeTruthy()
  expect(within(history).getByRole<HTMLButtonElement>('button', { name: 'Revoke' }).disabled).toBe(true)
})
