import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

import type { PaymentQuoteInput, PlatformBillingBridge, PlatformOrder } from '../../../../shared/platform-contract'

import { RechargeView } from './recharge-view'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function fixture() {
  let tail = Promise.resolve()
  vi.stubGlobal('navigator', {
    ...navigator,
    locks: {
      request: (_: string, task: () => Promise<unknown>) => {
        const next = tail.then(task)
        tail = next.then(
          () => undefined,
          () => undefined
        )

        return next
      }
    }
  })
  const scope = { origin: 'https://fixture.example.test', user_id: '17', generation: 1 }

  const order: PlatformOrder = {
    order_id: '431',
    client_order_id: null,
    out_trade_no: 'recovered-merchant-order',
    status: 'RECHARGING',
    payment_type: 'alipay',
    requested_amount: '10',
    pay_amount: '10',
    payment_currency: 'CNY',
    credit_amount: '10',
    credit_currency: 'USD',
    fee_amount: '0',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 900000).toISOString(),
    can_cancel: false,
    confirmation_required: false,
    payment_unknown: false,
    checkout: null
  }

  const quote = vi.fn(async (input: PaymentQuoteInput) => ({
    requested_amount: input.amount,
    pay_amount: input.amount,
    credit_amount: input.amount,
    payment_currency: 'CNY',
    credit_currency: 'USD' as const,
    fee_amount: '0'
  }))

  const createOrder = vi.fn<PlatformBillingBridge['createOrder']>()
  const getOrder = vi.fn(async () => order)

  const bridge = {
    scope: async () => scope,
    checkoutInfo: async () => ({
      payment_enabled: true,
      balance_disabled: false,
      help_text: '',
      methods: [
        { id: 'alipay', display_name: 'Alipay', currency: 'CNY', min_amount: '1', max_amount: '50', available: true }
      ]
    }),
    quote,
    createOrder,
    getOrder
  } as unknown as PlatformBillingBridge

  const mount = (orderId?: string) =>
    render(
      <I18nProvider configClient={null} initialLocale="en">
        <RechargeView bridge={bridge} onOpenChange={() => {}} open orderId={orderId} scope={scope} />
      </I18nProvider>
    )

  const submit = async (amount: string) => {
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: amount } })
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Proceed to payment' }) as HTMLButtonElement).disabled).toBe(false)
    )
    fireEvent.click(screen.getByRole('button', { name: 'Proceed to payment' }))
  }

  return { mount, submit, createOrder, getOrder, quote, order }
}

const failure = (code: string) => Object.assign(new Error(code), { code })

it('retries a failed corrected preview after the original amount was rejected', async () => {
  const f = fixture()
  f.createOrder.mockRejectedValueOnce(failure('INVALID_AMOUNT')).mockResolvedValue(f.order)
  f.mount()
  await f.submit('20')
  await screen.findByRole('alert')
  f.quote.mockRejectedValueOnce(failure('network_error'))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '10' } })
  await waitFor(() => expect(f.quote).toHaveBeenCalledTimes(2))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Proceed to payment' }) as HTMLButtonElement).disabled).toBe(false)
  )
  expect(f.createOrder).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Proceed to payment' }))
  await screen.findByText(f.order.out_trade_no)
  expect(f.createOrder.mock.calls.map(([input]) => input.amount)).toEqual(['20', '10'])
})

it('corrects a rejected create after restart and retains the corrected request through an unknown result', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const f = fixture()
  let rejectFirst!: (error: Error) => void
  f.createOrder
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectFirst = reject
        })
    )
    .mockRejectedValueOnce(failure('network_error'))
    .mockResolvedValue(f.order)
  const first = f.mount()
  await f.submit('20')
  await waitFor(() => expect(f.createOrder).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('textbox')).toBeNull()
  await act(async () => rejectFirst(failure('INVALID_AMOUNT')))
  await screen.findByRole('alert')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  expect(screen.getByRole('alert')).toBeTruthy()
  expect(f.quote).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('textbox')).toBeTruthy()
  first.unmount()
  const reopened = f.mount()
  await screen.findByRole('textbox')
  expect(f.createOrder).toHaveBeenCalledTimes(1)
  await f.submit('10')
  await screen.findByRole('alert')
  expect(screen.queryByRole('textbox')).toBeNull()
  reopened.unmount()
  f.mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Recover original order' }))
  await screen.findByText(f.order.out_trade_no)
  const requests = f.createOrder.mock.calls.map(([input]) => input)
  expect(requests.map(input => input.amount)).toEqual(['20', '10', '10'])
  expect(new Set(requests.map(input => input.client_order_id)).size).toBe(1)
  expect(requests[1].expected_quote?.requested_amount).toBe('10')
  expect(f.quote).toHaveBeenCalledTimes(2)
})

it('reconciles a permanently lost create through matching history without clearing an unrelated intent', async () => {
  const f = fixture()
  let loseOriginal!: (error: Error) => void
  let rejectStale!: (error: Error) => void
  f.createOrder
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          loseOriginal = reject
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectStale = reject
        })
    )
    .mockRejectedValueOnce(failure('INVALID_AMOUNT'))
    .mockRejectedValueOnce(failure('IDEMPOTENCY_KEY_CONFLICT'))
  const firstWindow = f.mount()
  await f.submit('20')
  await waitFor(() => expect(f.createOrder).toHaveBeenCalledTimes(1))
  const originalId = f.createOrder.mock.calls[0][0].client_order_id
  Object.assign(f.order, { client_order_id: originalId, requested_amount: '20', status: 'CANCELLED' })
  firstWindow.unmount()
  const staleWindow = f.mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Recover original order' }))
  await waitFor(() => expect(f.createOrder).toHaveBeenCalledTimes(2))
  staleWindow.unmount()
  const secondWindow = f.mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Recover original order' }))
  await screen.findByRole('alert')
  await f.submit('10')
  expect((await screen.findByRole('alert')).textContent).toContain('order history')
  expect(screen.queryByRole('textbox')).toBeNull()
  await act(async () => rejectStale(failure('INVALID_AMOUNT')))
  secondWindow.unmount()
  const restored = f.mount()
  await screen.findByRole('button', { name: 'Recover original order' })
  expect(screen.queryByRole('textbox')).toBeNull()
  await act(async () => loseOriginal(failure('network_error')))
  restored.unmount()

  // Viewing another terminal order must not retire the conflicted original intent.
  f.getOrder.mockResolvedValueOnce({ ...f.order, order_id: '432', client_order_id: crypto.randomUUID() })
  const unrelated = f.mount('432')
  fireEvent.click(await screen.findByRole('button', { name: 'New recharge' }))
  await f.submit('30')
  await screen.findByRole('button', { name: 'Recover original order' })
  expect(f.createOrder).toHaveBeenCalledTimes(4)
  unrelated.unmount()

  const history = f.mount(f.order.order_id)
  await screen.findByText(f.order.out_trade_no)
  history.unmount()
  f.mount()
  fireEvent.click(await screen.findByRole('button', { name: 'New recharge' }))
  f.createOrder.mockImplementationOnce(async input => ({
    ...f.order,
    order_id: '433',
    client_order_id: input.client_order_id,
    out_trade_no: 'next-merchant-order'
  }))
  await f.submit('30')
  await screen.findByText('next-merchant-order')
  const requests = f.createOrder.mock.calls.map(([input]) => input)
  expect(requests.map(input => input.amount)).toEqual(['20', '20', '20', '10', '30'])
  expect(new Set(requests.slice(0, 4).map(input => input.client_order_id)).size).toBe(1)
  expect(requests[4].client_order_id).not.toBe(originalId)
})
