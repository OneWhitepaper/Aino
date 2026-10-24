import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { I18nProvider } from '@/i18n'
import type { TurnBilling } from '@/lib/turn-billing'

import type { PlatformAccountBridge, PlatformUsagePage } from '../../../../shared/platform-contract'

import { ReplyCost } from './reply-cost'

const original = window.hermesDesktop
afterEach(() => {
  cleanup()
  window.hermesDesktop = original
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function fixture() {
  const account = { onChanged: () => () => {} } as unknown as PlatformAccountBridge

  const billing: TurnBilling = {
    source: 'aino',
    user_id: '17',
    session_id: crypto.randomUUID(),
    turn_id: crypto.randomUUID(),
    calls: [
      { call_id: crypto.randomUUID(), purpose: 'chat' },
      { call_id: crypto.randomUUID(), purpose: 'title' }
    ],
    calls_complete: true,
    revision: 3,
    status: 'pending'
  }

  const page: PlatformUsagePage = {
    page: 1,
    page_size: 50,
    total: 1,
    items: [
      {
        id: '1',
        request_id: 'r',
        model: 'fixture',
        session_id: billing.session_id,
        desktop_turn_id: billing.turn_id,
        desktop_call_id: billing.calls[0].call_id,
        desktop_purpose: 'chat',
        actual_cost_decimal: '0.01000000',
        currency: 'USD',
        settlement_status: 'settled',
        created_at: '2026-09-16T00:00:00Z'
      }
    ]
  }

  const listUsage = vi.fn().mockResolvedValue(page)
  window.hermesDesktop = { platformAccount: account, platformBilling: { listUsage } } as unknown as typeof original
  platformAccountActions(account).snapshot.set({
    revision: 1,
    phase: 'signed_in',
    account: { id: '17', display_name: 'Fixture', phone_masked: '', email: '' },
    mode: 'development',
    remember_state: 'session_only',
    error: null
  })

  return { account, billing, page, listUsage, snapshot: platformAccountActions(account).snapshot }
}

it('shows partial ledger costs and stops automatic checks after a bounded number of attempts', async () => {
  vi.useFakeTimers()
  const { account, billing, listUsage } = fixture()

  const view = render(
    <I18nProvider configClient={null} initialLocale="zh">
      <ReplyCost billing={billing} />
    </I18nProvider>
  )

  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(screen.getByText(/部分费用已结算.*0.01 USD/)).toBeTruthy()
  view.rerender(
    <I18nProvider configClient={null} initialLocale="zh">
      <ReplyCost billing={structuredClone(billing)} />
    </I18nProvider>
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(listUsage).toHaveBeenCalledTimes(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120000)
  })
  expect(listUsage).toHaveBeenCalledTimes(6)
  expect(screen.getByRole('button', { name: '重新核对' })).toBeTruthy()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120000)
  })
  expect(listUsage).toHaveBeenCalledTimes(6)
  fireEvent.click(screen.getByRole('button', { name: '查看明细' }))
  const details = within(screen.getByRole('dialog'))
  expect(details.getByText('fixture')).toBeTruthy()
  expect(details.getByText('0.01 USD')).toBeTruthy()
  expect(details.getByText('对话')).toBeTruthy()
  act(() => platformAccountActions(account).snapshot.set(null))
  expect(screen.queryByText(/0.01 USD/)).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('recovers offline reads without asking for a new login and offers retry after terminal read errors', async () => {
  vi.useFakeTimers()
  const { billing, listUsage, snapshot } = fixture()
  snapshot.set({ ...snapshot.get()!, phase: 'offline' })
  listUsage.mockRejectedValue({ code: 'network_unavailable' })
  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <ReplyCost billing={billing} />
    </I18nProvider>
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120000)
  })
  expect(screen.queryByText('登录原账户后查看费用')).toBeNull()
  expect(listUsage).toHaveBeenCalledTimes(6)
  listUsage.mockRejectedValue({ code: 'not_authenticated' })
  fireEvent.click(screen.getByRole('button', { name: '重新核对' }))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120000)
  })
  expect(listUsage).toHaveBeenCalledTimes(7)
  expect(screen.getByRole('button', { name: '重新核对' })).toBeTruthy()
})

it('converges only after every call settles and the final call manifest arrives, then stops polling', async () => {
  vi.useFakeTimers()
  const { billing, listUsage, page } = fixture()
  const incomplete = { ...billing, calls_complete: false }
  const row = { ...page.items[0], actual_cost_decimal: '0.00010000' }
  listUsage.mockResolvedValue({ ...page, items: [row] })

  const view = render(
    <I18nProvider configClient={null} initialLocale="en">
      <ReplyCost billing={incomplete} />
    </I18nProvider>
  )

  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })

  expect(screen.getByText('Partially settled 0.0001 USD')).toBeTruthy()

  listUsage.mockResolvedValue({
    ...page,
    total: 2,
    items: [
      row,
      { ...row, id: '2', desktop_call_id: billing.calls[1].call_id, desktop_purpose: billing.calls[1].purpose }
    ]
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000)
  })
  expect(screen.getByText('Partially settled 0.0002 USD')).toBeTruthy()
  expect(screen.queryByText('Charged 0.0002 USD')).toBeNull()

  view.rerender(
    <I18nProvider configClient={null} initialLocale="en">
      <ReplyCost billing={{ ...billing, revision: billing.revision + 1 }} />
    </I18nProvider>
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(screen.getByText('Charged 0.0002 USD')).toBeTruthy()
  expect(screen.queryByText(/Partially settled/)).toBeNull()
  const settledReads = listUsage.mock.calls.length
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120000)
  })
  expect(listUsage).toHaveBeenCalledTimes(settledReads)
})

it('pauses hidden-window polling and discards ledger data that arrives after an account switch', async () => {
  vi.useFakeTimers()
  const visibility = vi.spyOn(window.document, 'visibilityState', 'get').mockReturnValue('hidden')
  const { billing, listUsage, snapshot, page } = fixture()
  let finish!: (value: PlatformUsagePage) => void
  listUsage.mockImplementation(
    () =>
      new Promise<PlatformUsagePage>(resolve => {
        finish = resolve
      })
  )
  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <ReplyCost billing={billing} />
    </I18nProvider>
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120000)
  })
  expect(listUsage).not.toHaveBeenCalled()
  visibility.mockReturnValue('visible')
  act(() => window.document.dispatchEvent(new Event('visibilitychange')))
  expect(listUsage).toHaveBeenCalledTimes(1)
  act(() => snapshot.set({ ...snapshot.get()!, account: { ...snapshot.get()!.account!, id: '18' } }))
  await act(async () => {
    finish(page)
    await vi.advanceTimersByTimeAsync(120000)
  })
  expect(screen.queryByText(/0.01 USD/)).toBeNull()
  expect(screen.queryByRole('button', { name: '查看明细' })).toBeNull()
  expect(listUsage).toHaveBeenCalledTimes(1)
})

it.each([
  ['an unmet total', { page: 1, page_size: 50, total: 2 }],
  ['a drifted page', { page: 2, page_size: 50, total: 1 }],
  ['a drifted page size', { page: 1, page_size: 25, total: 1 }]
])('keeps a matching settled row partial when pagination reports %s', async (_case, metadata) => {
  vi.useFakeTimers()
  const { billing, listUsage, page } = fixture()
  billing.calls = billing.calls.slice(0, 1)
  listUsage.mockResolvedValue({ ...page, ...metadata })

  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <ReplyCost billing={billing} />
    </I18nProvider>
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })

  expect(screen.getByText(/部分费用已结算.*0.01 USD/)).toBeTruthy()
  expect(screen.queryByText(/本回合费用.*0.01 USD/)).toBeNull()
})
