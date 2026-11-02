import type { PaymentQuote, PlatformOrder } from '../../../../shared/platform-contract'

export function liveRechargeCheckout(order: PlatformOrder | null, expired: boolean) {
  return (
    order?.status === 'PENDING' && !order.confirmation_required && !order.payment_unknown && order.checkout && !expired
  )
}

export function finalRechargeQuote(order: PlatformOrder | null): PaymentQuote | null {
  return order?.requested_amount && order.fee_amount !== null
    ? {
        requested_amount: order.requested_amount,
        pay_amount: order.pay_amount,
        payment_currency: order.payment_currency,
        credit_amount: order.credit_amount,
        credit_currency: order.credit_currency,
        fee_amount: order.fee_amount
      }
    : null
}
