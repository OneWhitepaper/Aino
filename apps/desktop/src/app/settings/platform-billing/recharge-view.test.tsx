import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

import type { PlatformBillingBridge, PlatformOrder } from '../../../../shared/platform-contract'

import { createRechargeIntents } from './recharge-intent'
import { RechargeView } from './recharge-view'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  Object.defineProperty(window.document, 'visibilityState', { configurable: true, value: 'visible' })
})

it('expires checkout during a stalled poll and never lets that poll undo cancellation', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.stubGlobal('navigator', { ...navigator, locks: { request: async (_: string, task: () => unknown) => task() } })
  const scope = { origin: 'https://fixture.example.test', user_id: '17', generation: 1 }
  const deadline = new Date(Date.now() + 10000).toISOString()

  const order: PlatformOrder = {
    order_id: '431',
    client_order_id: null,
    out_trade_no: 'fixture-expiring',
    status: 'PENDING',
    payment_type: 'alipay',
    requested_amount: '20',
    pay_amount: '20.00',
    payment_currency: 'CNY',
    credit_amount: '20',
    credit_currency: 'USD',
    fee_amount: '0',
    created_at: new Date().toISOString(),
    expires_at: deadline,
    can_cancel: true,
    confirmation_required: false,
    payment_unknown: false,
    checkout: { pay_url: 'https://pay.example.test/fixture', qr_code: null, expires_at: deadline }
  }

  let release!: (value: PlatformOrder) => void

  const pending = new Promise<PlatformOrder>(resolve => {
    release = resolve
  })

  const getOrder = vi.fn().mockResolvedValueOnce(order).mockReturnValue(pending)

  const bridge = {
    scope: async () => scope,
    getOrder,
    cancelOrder: async () => ({ ...order, status: 'CANCELLED', can_cancel: false, checkout: null })
  } as unknown as PlatformBillingBridge

  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <RechargeView bridge={bridge} onOpenChange={() => {}} open orderId="431" scope={scope} />
    </I18nProvider>
  )
  await screen.findByRole('button', { name: '前往付款' })
  await waitFor(() => expect(getOrder).toHaveBeenCalledTimes(2))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(11000)
  })
  expect(screen.queryByRole('button', { name: '前往付款' })).toBeNull()
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '取消订单' }))
    await Promise.resolve()
    release(order)
  })
  expect(screen.getByText('订单已取消')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '取消订单' })).toBeNull()
})

it.each(['read', 'associate'])('opens a server order even when local recovery cannot %s', async failureStage => {
  const scope = { origin: 'https://fixture.example.test', user_id: '17', generation: 1 }

  const intent = await createRechargeIntents(scope, {
    storage: localStorage,
    lock: async (_, task) => task()
  }).begin({ amount: '20', payment_type: 'alipay', order_type: 'balance' })

  let locks = 0
  vi.stubGlobal('navigator', {
    ...navigator,
    locks: {
      request: async (_: string, task: () => Promise<unknown>) => {
        if (failureStage === 'read' || ++locks > 1) {
          throw Object.assign(new Error('storage unavailable'), { code: 'payment_recovery_unavailable' })
        }

        return task()
      }
    }
  })

  const order: PlatformOrder = {
    order_id: '431',
    client_order_id: intent.client_order_id,
    out_trade_no: 'server-order-recovery',
    status: 'CANCELLED',
    payment_type: 'alipay',
    requested_amount: '20',
    pay_amount: '20.00',
    payment_currency: 'CNY',
    credit_amount: '20',
    credit_currency: 'USD',
    fee_amount: '0',
    created_at: new Date().toISOString(),
    expires_at: new Date().toISOString(),
    can_cancel: false,
    confirmation_required: false,
    payment_unknown: false,
    checkout: null
  }

  const bridge = {
    scope: async () => scope,
    getOrder: async () => order,
    createOrder: vi.fn()
  } as unknown as PlatformBillingBridge

  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <RechargeView bridge={bridge} onOpenChange={() => {}} open orderId="431" scope={scope} />
    </I18nProvider>
  )
  expect(await screen.findByText('server-order-recovery')).toBeTruthy()
  expect(bridge.createOrder).not.toHaveBeenCalled()

  if (failureStage === 'associate') {
    expect((await screen.findByRole('alert')).textContent).toContain('订单')
  }
})

it('keeps an out-of-range amount editable and shows the corrective error without creating an order', async () => {
  vi.stubGlobal('navigator', { ...navigator, locks: { request: async (_: string, task: () => unknown) => task() } })
  const scope = { origin: 'https://fixture.example.test', user_id: '17', generation: 1 }

  const bridge = {
    scope: async () => scope,
    checkoutInfo: async () => ({
      payment_enabled: true,
      balance_disabled: false,
      methods: [
        { id: 'alipay', display_name: '支付宝', currency: 'CNY', min_amount: '10', max_amount: '50', available: true }
      ],
      help_text: ''
    }),
    quote: async () => {
      throw Object.assign(new Error('fixture'), { code: 'INVALID_AMOUNT' })
    },
    createOrder: vi.fn()
  } as unknown as PlatformBillingBridge

  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <RechargeView bridge={bridge} onOpenChange={() => {}} open scope={scope} />
    </I18nProvider>
  )
  fireEvent.change(await screen.findByLabelText('充值金额'), { target: { value: '1' } })
  expect((await screen.findByRole('alert')).textContent).toContain('限额')
  expect((screen.getByLabelText('充值金额') as HTMLInputElement).value).toBe('1')
  expect(bridge.createOrder).not.toHaveBeenCalled()
})

it('pauses order polling when hidden and hides checkout once the payment expires', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.stubGlobal('navigator', { ...navigator, locks: { request: async (_: string, task: () => unknown) => task() } })
  const scope = { origin: 'https://fixture.example.test', user_id: '17', generation: 1 }
  const deadline = new Date(Date.now() + 10000).toISOString()

  const order: PlatformOrder = {
    order_id: '431',
    client_order_id: null,
    out_trade_no: 'fixture-expiring',
    status: 'PENDING',
    payment_type: 'alipay',
    requested_amount: '20',
    pay_amount: '20.00',
    payment_currency: 'CNY',
    credit_amount: '20',
    credit_currency: 'USD',
    fee_amount: '0',
    created_at: new Date().toISOString(),
    expires_at: deadline,
    can_cancel: true,
    confirmation_required: false,
    payment_unknown: false,
    checkout: { pay_url: 'https://pay.example.test/fixture', qr_code: null, expires_at: deadline }
  }

  const getOrder = vi.fn().mockResolvedValue(order)
  const bridge = { scope: async () => scope, getOrder } as unknown as PlatformBillingBridge
  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <RechargeView bridge={bridge} onOpenChange={() => {}} open orderId="431" scope={scope} />
    </I18nProvider>
  )
  await screen.findByRole('button', { name: '前往付款' })
  Object.defineProperty(window.document, 'visibilityState', { configurable: true, value: 'hidden' })
  fireEvent(window.document, new Event('visibilitychange'))
  const calls = getOrder.mock.calls.length
  await act(async () => {
    await vi.advanceTimersByTimeAsync(11000)
  })
  expect(getOrder.mock.calls.length).toBe(calls)
  Object.defineProperty(window.document, 'visibilityState', { configurable: true, value: 'visible' })
  fireEvent(window.document, new Event('visibilitychange'))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(screen.queryByRole('button', { name: '前往付款' })).toBeNull()
})

it('never paints a late old-account order into a new account recharge view', async () => {
  vi.stubGlobal('navigator', { ...navigator, locks: { request: async (_: string, task: () => unknown) => task() } })
  let release!: (value: unknown) => void

  const pending = new Promise(resolve => {
    release = resolve
  })

  const first = { origin: 'https://fixture.example.test', user_id: '17', generation: 1 }
  let current = first
  const getOrder = vi.fn(() => pending)

  const bridge = {
    scope: async () => current,
    getOrder,
    checkoutInfo: async () => ({ payment_enabled: false, balance_disabled: false, help_text: '', methods: [] })
  } as unknown as PlatformBillingBridge

  const view = (scope: typeof first, orderId?: string) => (
    <I18nProvider configClient={null} initialLocale="zh">
      <RechargeView bridge={bridge} onOpenChange={() => {}} open orderId={orderId} scope={scope} />
    </I18nProvider>
  )

  const rendered = render(view(first, '431'))
  await waitFor(() => expect(getOrder).toHaveBeenCalled())
  current = { ...first, user_id: '18', generation: 2 }
  rendered.rerender(view(current))
  await screen.findByText('当前没有可用充值渠道')
  await act(async () => release({ order_id: '431', out_trade_no: 'private-old-account-order', status: 'PENDING' }))
  expect(screen.queryByText('private-old-account-order')).toBeNull()
  expect(screen.getByText('当前没有可用充值渠道')).toBeTruthy()
})

it('keeps the original order across close and reopen and confirms wallet refresh before claiming credited', async () => {
  vi.stubGlobal('navigator', { ...navigator, locks: { request: async (_: string, task: () => unknown) => task() } })
  const scope = { origin: 'https://fixture.example.test', user_id: '17', generation: 1 }

  let order: PlatformOrder = {
    order_id: '431',
    client_order_id: null,
    out_trade_no: 'fixture-order',
    status: 'RECHARGING',
    payment_type: 'alipay',
    requested_amount: '20',
    pay_amount: '20.00',
    payment_currency: 'CNY',
    credit_amount: '20.00000000',
    credit_currency: 'USD',
    fee_amount: '0.00',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 900000).toISOString(),
    can_cancel: false,
    confirmation_required: false,
    payment_unknown: false,
    checkout: null
  }

  const quote = {
    requested_amount: '20',
    pay_amount: '20.00',
    payment_currency: 'CNY',
    credit_amount: '20.00000000',
    credit_currency: 'USD' as const,
    fee_amount: '0.00'
  }

  const createOrder = vi.fn(async input => {
    order = { ...order, client_order_id: input.client_order_id }

    return order
  })

  const getOrder = vi.fn(async () => order)
  const summary = vi.fn().mockRejectedValue(Object.assign(new Error('offline'), { code: 'network_error' }))

  const bridge = {
    scope: async () => scope,
    checkoutInfo: async () => ({
      payment_enabled: true,
      balance_disabled: false,
      help_text: '',
      methods: [
        { id: 'alipay', display_name: '支付宝', currency: 'CNY', min_amount: '1', max_amount: '500', available: true }
      ]
    }),
    quote: async () => quote,
    createOrder,
    getOrder,
    summary
  } as unknown as PlatformBillingBridge

  const close = vi.fn()
  const credited = vi.fn()

  const view = (open: boolean) => (
    <I18nProvider configClient={null} initialLocale="zh">
      <RechargeView bridge={bridge} onCredited={credited} onOpenChange={close} open={open} scope={scope} />
    </I18nProvider>
  )

  const rendered = render(view(true))
  fireEvent.change(await screen.findByLabelText('充值金额'), { target: { value: '20' } })
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '去支付' }) as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(screen.getByRole('button', { name: '去支付' }))
  expect(await screen.findByText('已支付，正在到账')).toBeTruthy()
  expect(screen.queryByText('充值成功')).toBeNull()
  expect(credited).not.toHaveBeenCalled()
  rendered.rerender(view(false))
  rendered.rerender(view(true))
  expect(await screen.findByText('已支付，正在到账')).toBeTruthy()
  expect(createOrder).toHaveBeenCalledTimes(1)
  expect(getOrder).toHaveBeenCalledWith({ order_id: '431', expected_user_id: '17' })
  order = { ...order, status: 'COMPLETED' }
  fireEvent.click(screen.getByRole('button', { name: '刷新订单' }))
  await waitFor(() => expect(summary).toHaveBeenCalled())
  expect(screen.queryByText('充值成功')).toBeNull()
  summary.mockResolvedValue({})
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '刷新订单' })))
  expect(await screen.findByText('充值成功')).toBeTruthy()
  expect(credited).toHaveBeenCalledTimes(1)
})
