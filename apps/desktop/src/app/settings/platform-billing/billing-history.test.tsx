import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

import type { PlatformBillingBridge, PlatformUsagePage, PlatformUsageQuery } from '../../../../shared/platform-contract'

import { BillingHistory } from './billing-history'

afterEach(cleanup)

// Radix Select uses browser layout and pointer capture APIs absent in jsdom.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

it('opens an existing order by its id without creating another and keeps usage separate', async () => {
  const scope = { origin: 'https://fixture.example.test', user_id: '17', generation: 1 }
  const openOrder = vi.fn()
  const createOrder = vi.fn()

  const bridge = {
    scope: async () => scope,
    createOrder,
    listOrders: vi.fn().mockResolvedValue({
      items: [
        {
          order_id: '431',
          out_trade_no: 'original-merchant-order',
          status: 'RECHARGING',
          pay_amount: '20.00',
          payment_currency: 'CNY',
          created_at: new Date().toISOString()
        }
      ],
      page: 1,
      page_size: 20,
      total: 1
    }),
    listUsage: vi.fn().mockResolvedValue({
      items: [
        {
          id: 'receipt',
          model: 'fixture-model',
          desktop_purpose: 'chat',
          actual_cost_decimal: '0.00000001',
          currency: 'USD',
          settlement_status: 'settled'
        }
      ],
      page: 1,
      page_size: 20,
      total: 1
    })
  } as unknown as PlatformBillingBridge

  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <BillingHistory bridge={bridge} onOpenOrder={openOrder} scope={scope} />
    </I18nProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: '充值订单' }))
  fireEvent.click(await screen.findByRole('button', { name: /original-merchant-order/ }))
  expect(openOrder).toHaveBeenCalledWith('431')
  expect(createOrder).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '消费记录' }))
  expect(await screen.findByText('0.00000001 USD')).toBeTruthy()
  expect(screen.queryByText('original-merchant-order')).toBeNull()
})

it('queries the full ledger with filters and preserves them across numbered pages and page sizes', async () => {
  const scope = { origin: 'https://fixture.example.test', user_id: '17', generation: 1 }
  const queries: PlatformUsageQuery[] = []

  const bridge = {
    scope: async () => scope,
    listUsage: async (query: PlatformUsageQuery) => {
      queries.push(query)

      return { items: [], page: query.page, page_size: query.page_size, total: 1765 }
    }
  } as unknown as PlatformBillingBridge

  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <BillingHistory bridge={bridge} onOpenOrder={() => {}} scope={scope} />
    </I18nProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: '消费记录' }))
  fireEvent.click(await screen.findByRole('button', { name: '前往第 89 页' }))
  await waitFor(() => expect(queries.at(-1)?.page).toBe(89))
  fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'grok-4.6' } })
  fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-09-20' } })
  fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-09-22' } })
  fireEvent.click(screen.getByRole('button', { name: '查询' }))
  await waitFor(() =>
    expect(queries.at(-1)).toMatchObject({
      page: 1,
      page_size: 20,
      model: 'grok-4.6',
      start_date: '2026-09-20',
      end_date: '2026-09-22',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    })
  )
  fireEvent.click(await screen.findByRole('button', { name: '前往第 2 页' }))
  await waitFor(() => expect(queries.at(-1)).toMatchObject({ page: 2, model: 'grok-4.6' }))
  fireEvent.change(screen.getByLabelText('跳转页码'), { target: { value: '40' } })
  fireEvent.click(screen.getByRole('button', { name: '跳转' }))
  await waitFor(() => expect(queries.at(-1)).toMatchObject({ page: 40, model: 'grok-4.6' }))
  fireEvent.keyDown(await screen.findByRole('combobox', { name: '每页条数' }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('option', { name: '50' }))
  await waitFor(() => expect(queries.at(-1)).toMatchObject({ page: 1, page_size: 50, model: 'grok-4.6' }))
  fireEvent.click(screen.getByRole('button', { name: '重置' }))
  await waitFor(() => expect(queries.at(-1)).toMatchObject({ page: 1 }))
  expect(queries.at(-1)).not.toHaveProperty('model')
  const count = queries.length
  fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-09-23' } })
  fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-09-22' } })
  fireEvent.click(screen.getByRole('button', { name: '查询' }))
  expect(screen.getByRole('alert')).toBeTruthy()
  expect(queries).toHaveLength(count)
})

it('does not publish late records after the account scope changes', async () => {
  let resolve!: (value: PlatformUsagePage) => void
  let scope = { origin: 'https://fixture.example.test', user_id: '17', generation: 1 }

  const bridge = {
    scope: async () => scope,
    listUsage: () =>
      new Promise<PlatformUsagePage>(done => {
        resolve = done
      })
  } as unknown as PlatformBillingBridge

  const { rerender } = render(
    <I18nProvider configClient={null} initialLocale="zh">
      <BillingHistory bridge={bridge} onOpenOrder={() => {}} scope={scope} />
    </I18nProvider>
  )

  fireEvent.click(screen.getByRole('button', { name: '消费记录' }))
  const finishOld = resolve
  scope = { ...scope, user_id: '18', generation: 2 }
  rerender(
    <I18nProvider configClient={null} initialLocale="zh">
      <BillingHistory bridge={bridge} onOpenOrder={() => {}} scope={scope} />
    </I18nProvider>
  )
  await act(async () =>
    finishOld({
      items: [
        {
          id: '1',
          request_id: 'r',
          model: 'old-account-private-model',
          session_id: null,
          desktop_turn_id: null,
          desktop_call_id: null,
          desktop_purpose: 'chat',
          actual_cost_decimal: '0.1',
          currency: 'USD',
          settlement_status: 'settled',
          created_at: '2026-09-22T00:00:00Z'
        }
      ],
      total: 1,
      page: 1,
      page_size: 20
    })
  )
  expect(screen.queryByText('old-account-private-model')).toBeNull()
})
