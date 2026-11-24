import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { $pluginRecords, type PluginRecord } from '@/contrib/plugins-store'
import { $notifications } from '@/store/notifications'
import { $profiles } from '@/store/profile'
import { $profileRemoteOverrides } from '@/store/profile-remote-override'

import { GatewaySettings } from './gateway-settings'

vi.mock('./managed-updates-section', () => ({ ManagedUpdatesSection: () => null }))

const localConfig = { mode: 'local', profile: null, remoteUrl: '' }
const target = { plugin: 'sandbox', profile: 'work' }
let savedLaunchers: (typeof target)[]
const getConnectionConfig = vi.fn()
const clearProfileBackend = vi.fn()
const saveConnectionConfig = vi.fn()
let connectionApplied: (() => void) | undefined

beforeEach(() => {
  savedLaunchers = [target]
  $pluginRecords.set({})
  $profiles.set([])
  $profileRemoteOverrides.set({})
  $notifications.set([])
  getConnectionConfig.mockImplementation(async () => ({ ...localConfig, profileLaunchers: savedLaunchers }))
  clearProfileBackend.mockImplementation(async () => ({ applied: false }))
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      getConnectionConfig,
      saveConnectionConfig,
      setProfileBackend: vi.fn(),
      confirmSetProfileBackend: vi.fn(),
      confirmClearProfileBackend: vi.fn(),
      clearProfileBackend,
      onConnectionApplied: (callback: () => void) => {
        connectionApplied = callback

        return () => {
          connectionApplied = undefined
        }
      }
    }
  })
})

afterEach(() => {
  cleanup()
  $pluginRecords.set({})
  $profileRemoteOverrides.set({})
  $notifications.set([])
  Reflect.deleteProperty(window, 'hermesDesktop')
  vi.clearAllMocks()
})

it.each(['removed', 'disabled', 'error'] as const)(
  'offers exact local recovery in mounted Settings when its launcher is %s, without a live roster or rail',
  async status => {
    if (status !== 'removed') {
      $pluginRecords.set({ sandbox: { id: 'sandbox', name: 'Sandbox', kind: 'disk', status } })
    }

    render(<GatewaySettings subpage="connection" />)
    const recover = await screen.findByRole('button', { name: 'Run on this computer…' })
    const row = recover.closest('[data-settings-row]')!
    expect(within(row as HTMLElement).getByText('work')).toBeTruthy()
    expect(within(row as HTMLElement).getByText('sandbox')).toBeTruthy()
    expect(clearProfileBackend).not.toHaveBeenCalled()
    fireEvent.click(recover)

    await waitFor(() => expect(clearProfileBackend).toHaveBeenCalledExactlyOnceWith(target))
    // Native confirmation declined: the marked route remains recoverable, not silently local.
    expect(savedLaunchers).toEqual([target])
    expect(screen.getByRole('button', { name: 'Run on this computer…' })).toBeTruthy()
    expect(saveConnectionConfig).not.toHaveBeenCalled()

    clearProfileBackend.mockImplementationOnce(async () => {
      savedLaunchers = []

      return { applied: true }
    })
    await waitFor(() => expect((recover as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(recover)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Run on this computer…' })).toBeNull())
    expect(clearProfileBackend.mock.calls).toEqual([[target], [target]])
    expect(saveConnectionConfig).not.toHaveBeenCalled()
  }
)

it('updates recovery when the launcher unloads and when another window changes the saved route', async () => {
  const plugin: PluginRecord = { id: 'sandbox', name: 'Sandbox', kind: 'disk', status: 'loaded' }
  $pluginRecords.set({ sandbox: plugin })
  render(<GatewaySettings subpage="connection" />)
  await screen.findByText('Connection mode')
  expect(screen.queryByRole('button', { name: 'Run on this computer…' })).toBeNull()
  act(() => $pluginRecords.set({ sandbox: { ...plugin, status: 'disabled' } }))
  await screen.findByRole('button', { name: 'Run on this computer…' })
  savedLaunchers = []
  act(() => connectionApplied?.())
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Run on this computer…' })).toBeNull())
})

it('keeps an unsuccessful recovery visible and reports the native refusal', async () => {
  clearProfileBackend.mockRejectedValueOnce(new Error('This profile runs elsewhere.'))
  render(<GatewaySettings subpage="connection" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Run on this computer…' }))
  await waitFor(() => expect($notifications.get().some(item => item.message?.includes('runs elsewhere'))).toBe(true))
  expect(savedLaunchers).toEqual([target])
  expect(screen.getByRole('button', { name: 'Run on this computer…' })).toBeTruthy()
  expect(saveConnectionConfig).not.toHaveBeenCalled()
})

it('keeps default and named local launcher recoveries distinct even on a remote foreground connection', async () => {
  savedLaunchers = [target, { plugin: 'second', profile: 'default' }]
  getConnectionConfig.mockImplementation(async () => ({
    ...localConfig,
    mode: 'remote',
    remoteUrl: 'https://other.example',
    profileLaunchers: savedLaunchers
  }))
  render(<GatewaySettings subpage="connection" />)
  const recoveries = await screen.findAllByRole('button', { name: 'Run on this computer…' })
  expect(recoveries).toHaveLength(2)

  const defaultRecovery = recoveries.find(button =>
    within(button.closest('[data-settings-row]') as HTMLElement).queryByText('default')
  )!

  fireEvent.click(defaultRecovery)
  await waitFor(() =>
    expect(clearProfileBackend).toHaveBeenCalledExactlyOnceWith({ plugin: 'second', profile: 'default' })
  )
  expect(getConnectionConfig).toHaveBeenCalledWith(null)
  expect(savedLaunchers).toHaveLength(2)
  expect(saveConnectionConfig).not.toHaveBeenCalled()
})
