import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

import type {
  PaymentQuote,
  PlatformBillingBridge,
  PlatformBillingScope,
  PlatformOrder
} from '../../../../shared/platform-contract'

import { RechargeView } from './recharge-view'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function fixture() {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.stubGlobal('navigator', { ...navigator, locks: { request: async (_: string, task: () => unknown) => task() } })
  let current: PlatformBillingScope = { origin: 'https://fixture.example.test', user_id: '17', generation: 1 }
  const quote = vi.fn<PlatformBillingBridge['quote']>()

  const order: PlatformOrder = {
    order_id: '431',
    client_order_id: null,
    out_trade_no: 'explicit-recharge-order',
    status: 'CANCELLED',
    payment_type: 'alipay',
    requested_amount: '10',
    pay_amount: '10.20',
    payment_currency: 'CNY',
    credit_amount: '1.40',
    credit_currency: 'USD',
    fee_amount: '0.20',
    created_at: new Date().toISOString(),
    expires_at: new Date().toISOString(),
    can_cancel: false,
    confirmation_required: false,
    payment_unknown: false,
    checkout: null
  }

  const createOrder = vi.fn<PlatformBillingBridge['createOrder']>().mockResolvedValue(order)

  const bridge = {
    scope: async () => current,
    checkoutInfo: async () => ({
      payment_enabled: true,
      balance_disabled: false,
      help_text: '',
      methods: [
        { id: 'alipay', display_name: '支付宝', currency: 'CNY', min_amount: '1', max_amount: '500', available: true },
        { id: 'wxpay', display_name: '微信支付', currency: 'CNY', min_amount: '1', max_amount: '500', available: true }
      ]
    }),
    quote,
    createOrder
  } as unknown as PlatformBillingBridge

  const view = (open = true) => (
    <I18nProvider configClient={null} initialLocale="zh">
      <RechargeView bridge={bridge} onOpenChange={() => {}} open={open} scope={current} />
    </I18nProvider>
  )

  return {
    quote,
    createOrder,
    view,
    changeAccount: () => {
      current = { ...current, user_id: '18', generation: 2 }
    }
  }
}

const firstQuote: PaymentQuote = {
  requested_amount: '10',
  pay_amount: '10.20',
  payment_currency: 'CNY',
  credit_amount: '1.40',
  credit_currency: 'USD',
  fee_amount: '0.20'
}

const latestQuote: PaymentQuote = {
  requested_amount: '30',
  pay_amount: '30.30',
  payment_currency: 'CNY',
  credit_amount: '4.20',
  credit_currency: 'USD',
  fee_amount: '0.30'
}

async function settleInput() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
}

it('previews the settled amount automatically and only creates the displayed order after explicit payment', async () => {
  const f = fixture()
  f.quote.mockResolvedValue(firstQuote)
  render(f.view())
  const amount = await screen.findByLabelText('充值金额')
  fireEvent.change(amount, { target: { value: '1' } })
  fireEvent.change(amount, { target: { value: '10' } })
  expect(f.quote).not.toHaveBeenCalled()
  await settleInput()
  expect(f.quote).toHaveBeenCalledExactlyOnceWith({
    amount: '10',
    payment_type: 'alipay',
    order_type: 'balance',
    expected_user_id: '17'
  })
  expect(screen.getByText('10.2 CNY')).toBeTruthy()
  expect(screen.getByText('0.2 CNY')).toBeTruthy()
  expect(screen.getByText('1.4 USD')).toBeTruthy()
  expect(f.createOrder).not.toHaveBeenCalled()
  const pay = screen.getByRole('button', { name: '去支付' }) as HTMLButtonElement
  expect(pay.disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '支付宝' }))
  expect(screen.getByText('1.4 USD')).toBeTruthy()
  expect(pay.disabled).toBe(false)
  fireEvent.click(pay)
  await screen.findByText('explicit-recharge-order')
  expect(f.createOrder).toHaveBeenCalledExactlyOnceWith({
    amount: '10',
    payment_type: 'alipay',
    order_type: 'balance',
    expected_user_id: '17',
    client_order_id: expect.any(String),
    expected_quote: firstQuote
  })
})

it('keeps inputs editable and ignores outdated quote successes and failures after amount or channel changes', async () => {
  const f = fixture()
  let releaseOld!: (value: PaymentQuote) => void
  let rejectMiddle!: (error: Error) => void
  f.quote
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          releaseOld = resolve
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectMiddle = reject
        })
    )
    .mockResolvedValue(latestQuote)
  render(f.view())
  const amount = (await screen.findByLabelText('充值金额')) as HTMLInputElement
  fireEvent.change(amount, { target: { value: '10' } })
  await settleInput()
  expect(f.quote).toHaveBeenCalledTimes(1)
  expect(amount.disabled).toBe(false)
  fireEvent.change(amount, { target: { value: '30' } })
  expect((screen.getByRole('button', { name: '去支付' }) as HTMLButtonElement).disabled).toBe(true)
  await settleInput()
  expect(f.quote).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: '微信支付' }))
  await settleInput()
  expect(screen.getByText('4.2 USD')).toBeTruthy()
  expect(f.quote).toHaveBeenLastCalledWith({
    amount: '30',
    payment_type: 'wxpay',
    order_type: 'balance',
    expected_user_id: '17'
  })
  await act(async () => {
    releaseOld(firstQuote)
    rejectMiddle(Object.assign(new Error('old amount rejected'), { code: 'INVALID_AMOUNT' }))
  })
  expect(screen.queryByText('1.4 USD')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByText('4.2 USD')).toBeTruthy()
  expect(amount.value).toBe('30')
  expect((screen.getByRole('button', { name: '去支付' }) as HTMLButtonElement).disabled).toBe(false)
  expect(f.createOrder).not.toHaveBeenCalled()
})

it('discards a closed account preview when another account opens recharge', async () => {
  const f = fixture()
  let releaseOld!: (value: PaymentQuote) => void
  f.quote
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          releaseOld = resolve
        })
    )
    .mockResolvedValue(latestQuote)
  const rendered = render(f.view())
  fireEvent.change(await screen.findByLabelText('充值金额'), { target: { value: '10' } })
  await settleInput()
  expect(f.quote).toHaveBeenCalledTimes(1)
  rendered.rerender(f.view(false))
  f.changeAccount()
  rendered.rerender(f.view())
  fireEvent.change(await screen.findByLabelText('充值金额'), { target: { value: '30' } })
  await settleInput()
  await waitFor(() => expect(screen.getByText('4.2 USD')).toBeTruthy())
  expect(f.quote).toHaveBeenLastCalledWith({
    amount: '30',
    payment_type: 'alipay',
    order_type: 'balance',
    expected_user_id: '18'
  })
  await act(async () => releaseOld(firstQuote))
  expect(screen.queryByText('1.4 USD')).toBeNull()
  expect(screen.getByText('4.2 USD')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(f.createOrder).not.toHaveBeenCalled()
})
