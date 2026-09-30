import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { I18nProvider } from '@/i18n'
import { queryClient } from '@/lib/query-client'

import type {
  PlatformAccountBridge,
  PlatformBillingScope,
  PlatformWalletSummary
} from '../../../../shared/platform-contract'

import { PlatformWallet } from './wallet-view'

const original = window.hermesDesktop
afterEach(() => {
  cleanup()
  queryClient.clear()
  window.hermesDesktop = original
  vi.unstubAllGlobals()
})

it('loads devices alongside the wallet and keeps both visible across remounts and a failed background refresh', async () => {
  const account = { onChanged: () => () => {} } as unknown as PlatformAccountBridge
  const snapshot = platformAccountActions(account).snapshot
  snapshot.set({
    revision: 1,
    phase: 'signed_in',
    account: { id: '17', display_name: 'Fixture', phone_masked: '', email: '' },
    mode: 'development',
    remember_state: 'session_only',
    error: null
  })

  const wallet: PlatformWalletSummary = {
    currency: 'USD',
    balance: '41',
    available_balance: '41',
    frozen_balance: '0',
    payment_enabled: false,
    active_subscriptions: [],
    updated_at: '2026-09-16T00:00:00Z'
  }

  let resolveWallet!: (value: PlatformWalletSummary) => void
  let rejectWallet!: (error: unknown) => void

  const summary = vi.fn(
    () =>
      new Promise<PlatformWalletSummary>((resolve, reject) => {
        resolveWallet = resolve
        rejectWallet = reject
      })
  )

  let holdDevices = false

  const list = vi.fn(async () =>
    holdDevices
      ? new Promise<never>(() => {})
      : [
          {
            device_id: 'remembered-device',
            last_used_at: '2026-09-16T00:00:00Z',
            expires_at: '2099-01-01T00:00:00Z',
            revoked: false
          }
        ]
  )

  window.hermesDesktop = {
    platformAccount: account,
    platformBilling: {
      summary,
      scope: async () => ({ origin: 'https://billing.example', user_id: '17', generation: 1 })
    },
    platformDevices: { list, revoke: vi.fn() }
  } as unknown as typeof original

  const view = () => (
    <I18nProvider configClient={null} initialLocale="en">
      <PlatformWallet />
    </I18nProvider>
  )

  const first = render(view())
  // Device discovery must not wait for the unrelated wallet HTTP response.
  await screen.findByText('remembered-device')
  await act(async () => resolveWallet(wallet))
  await screen.findByText('41 USD')
  expect(list).toHaveBeenCalledTimes(1)
  first.unmount()
  holdDevices = true
  render(view())
  await waitFor(() => expect(summary).toHaveBeenCalledTimes(2))
  expect(screen.getByText('41 USD')).toBeTruthy()
  expect(screen.getByText('remembered-device')).toBeTruthy()
  await act(async () => rejectWallet({ code: 'network_error' }))
  await screen.findByRole('alert')
  expect(screen.getByText('41 USD')).toBeTruthy()
})

it('retires cached billing data on logout while unmounted and rejects a changed login generation', async () => {
  const account = { onChanged: () => () => {} } as unknown as PlatformAccountBridge
  const snapshot = platformAccountActions(account).snapshot

  const signedIn = {
    revision: 1,
    phase: 'signed_in' as const,
    account: { id: '17', display_name: 'Fixture', phone_masked: '', email: '' },
    mode: 'development' as const,
    remember_state: 'session_only' as const,
    error: null
  }

  snapshot.set(signedIn)
  let generation = 1
  let resolveWallet!: (value: PlatformWalletSummary) => void

  const wallet: PlatformWalletSummary = {
    currency: 'USD',
    balance: '17',
    available_balance: '17',
    frozen_balance: '0',
    payment_enabled: false,
    active_subscriptions: [],
    updated_at: '2026-09-16T00:00:00Z'
  }

  const summary = vi
    .fn()
    .mockResolvedValueOnce(wallet)
    .mockImplementation(
      () =>
        new Promise(resolve => {
          resolveWallet = resolve
        })
    )

  const scope = vi.fn(async (): Promise<PlatformBillingScope> => ({
    origin: 'https://billing.example',
    user_id: '17',
    generation
  }))

  window.hermesDesktop = {
    platformAccount: account,
    platformBilling: { summary, scope }
  } as unknown as typeof original

  const view = () => (
    <I18nProvider configClient={null} initialLocale="en">
      <PlatformWallet />
    </I18nProvider>
  )

  const first = render(view())
  await screen.findByText('17 USD')
  first.unmount()
  act(() => snapshot.set({ ...signedIn, revision: 2, phase: 'signed_out', account: null }))
  // Account events must clear resources even when no billing component is mounted.
  expect(queryClient.getQueriesData({ queryKey: ['billing', 'platform'] })).toHaveLength(0)
  generation = 2
  act(() => snapshot.set({ ...signedIn, revision: 3 }))
  const second = render(view())
  await waitFor(() => expect(summary).toHaveBeenCalledTimes(2))
  expect(screen.queryByText('17 USD')).toBeNull()
  const resolveOldLogin = resolveWallet
  generation = 3
  act(() => snapshot.set({ ...signedIn, revision: 4 }))
  await waitFor(() => expect(summary).toHaveBeenCalledTimes(3))
  await act(async () => resolveOldLogin({ ...wallet, balance: '22', available_balance: '22' }))
  expect(screen.queryByText('22 USD')).toBeNull()
  await act(async () => resolveWallet({ ...wallet, balance: '33', available_balance: '33' }))
  expect(await screen.findByText('33 USD')).toBeTruthy()
  second.unmount()

  let releaseScope!: (value: PlatformBillingScope) => void
  scope.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        releaseScope = resolve
      })
  )
  render(view())
  await waitFor(() => expect(releaseScope).toBeTypeOf('function'))
  generation = 4
  act(() => snapshot.set({ ...signedIn, revision: 5 }))
  await waitFor(() => expect(summary).toHaveBeenCalledTimes(4))
  await act(async () => releaseScope({ origin: 'https://billing.example', user_id: '17', generation: 3 }))
  expect(screen.queryByText('33 USD')).toBeNull()
  await act(async () => resolveWallet({ ...wallet, balance: '44', available_balance: '44' }))
  expect(await screen.findByText('44 USD')).toBeTruthy()
})

it('does not reopen a prior account recharge dialog for the next signed-in account', async () => {
  vi.stubGlobal('navigator', { ...navigator, locks: { request: async (_: string, task: () => unknown) => task() } })
  const account = { onChanged: () => () => {} } as unknown as PlatformAccountBridge
  const snapshot = platformAccountActions(account).snapshot
  snapshot.set({
    revision: 1,
    phase: 'signed_in',
    account: { id: '17', display_name: 'Fixture', phone_masked: '', email: '' },
    mode: 'development',
    remember_state: 'session_only',
    error: null
  })
  window.hermesDesktop = {
    platformAccount: account,
    platformBilling: {
      summary: async ({ expected_user_id }: { expected_user_id: string }) => ({
        currency: 'USD',
        balance: expected_user_id,
        available_balance: expected_user_id,
        frozen_balance: '0',
        payment_enabled: false,
        active_subscriptions: [],
        updated_at: new Date().toISOString()
      }),
      scope: async ({ expected_user_id }: { expected_user_id: string }) => ({
        origin: 'http://127.0.0.1:8080',
        user_id: expected_user_id,
        generation: Number(expected_user_id)
      }),
      checkoutInfo: async () => ({ payment_enabled: false, balance_disabled: false, methods: [], help_text: '' })
    }
  } as unknown as typeof original
  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <PlatformWallet />
    </I18nProvider>
  )
  fireEvent.click(await screen.findByRole('button', { name: /^充值$/ }))
  await screen.findByRole('dialog')
  act(() => snapshot.set({ ...snapshot.get()!, revision: 2, account: { ...snapshot.get()!.account!, id: '18' } }))
  await screen.findByText('18 USD')
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('shows authoritative cash separately from subscription quota and removes it immediately on account change', async () => {
  const account = { onChanged: () => () => {} } as unknown as PlatformAccountBridge
  const snapshot = platformAccountActions(account).snapshot

  const wallet: PlatformWalletSummary = {
    currency: 'USD',
    balance: '1.12345678',
    available_balance: '1.12345678',
    frozen_balance: '2.00000000',
    payment_enabled: false,
    updated_at: '2026-09-16T00:00:00Z',
    active_subscriptions: [
      { id: 's', name: 'Fixture subscription', expires_at: '2026-10-01T00:00:00Z', remaining: null, unit: 'USD' }
    ]
  }

  const summary = vi.fn().mockResolvedValue(wallet)
  window.hermesDesktop = {
    platformAccount: account,
    platformBilling: {
      summary,
      scope: async () => ({ origin: 'http://127.0.0.1:8080', user_id: '17', generation: 1 })
    }
  } as unknown as typeof original
  snapshot.set({
    revision: 1,
    phase: 'signed_in',
    account: { id: '17', display_name: 'Fixture', phone_masked: '', email: '' },
    mode: 'development',
    remember_state: 'session_only',
    error: null
  })
  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <PlatformWallet />
    </I18nProvider>
  )
  expect(await screen.findByText('1.12345678 USD')).toBeTruthy()
  expect(screen.getByText('2 USD')).toBeTruthy()
  expect(screen.getByText('Fixture subscription')).toBeTruthy()
  expect(screen.getByText('不限额')).toBeTruthy()
  expect(summary).toHaveBeenCalledWith({ expected_user_id: '17' })
  act(() => snapshot.set({ ...snapshot.get()!, phase: 'signed_out', account: null }))
  expect(screen.queryByText('1.12345678 USD')).toBeNull()
  expect(screen.queryByText('Fixture subscription')).toBeNull()
})

it('does not retry a failed wallet read whenever main broadcasts the same offline account', async () => {
  const account = { onChanged: () => () => {} } as unknown as PlatformAccountBridge
  const snapshot = platformAccountActions(account).snapshot
  snapshot.set({
    revision: 1,
    phase: 'signed_in',
    account: { id: '17', display_name: 'Fixture', phone_masked: '', email: '' },
    mode: 'development',
    remember_state: 'session_only',
    error: null
  })
  let attempts = 0

  const summary = vi.fn(async () => {
    attempts += 1

    // Bound the failing fixture too, so a regression cannot hang the runner.
    if (attempts < 3) {
      snapshot.set({ ...snapshot.get()!, revision: attempts + 1, phase: 'offline', error: { code: 'network_error' } })
    }

    throw Object.assign(new Error('network_error'), { code: 'network_error' })
  })

  window.hermesDesktop = {
    platformAccount: account,
    platformBilling: {
      summary,
      scope: async () => ({ origin: 'http://127.0.0.1:8080', user_id: '17', generation: 1 })
    }
  } as unknown as typeof original
  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <PlatformWallet />
    </I18nProvider>
  )
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  expect(summary).toHaveBeenCalledTimes(1)
})
