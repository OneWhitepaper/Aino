import type { PlatformAuth } from './platform-auth'
import { PlatformClientError } from './platform-client'
import { parsePaymentCheckoutUrl } from './platform-payment-contract'

export async function openPlatformCheckout({
  auth,
  orderId,
  owner,
  openBrowser,
  now = Date.now
}: {
  auth: PlatformAuth
  orderId: string
  owner: string
  openBrowser: (url: string) => Promise<void>
  now?: () => number
}): Promise<void> {
  const scope = auth.billingScope(owner)
  const order = await auth.getOrder(orderId, owner)
  const checkout = order.checkout

  if (
    order.status !== 'PENDING' ||
    order.confirmation_required ||
    order.payment_unknown ||
    !checkout?.pay_url ||
    Date.parse(order.expires_at) <= now() ||
    Date.parse(checkout.expires_at) <= now()
  ) {
    throw new PlatformClientError('checkout_unavailable')
  }

  // The API enforces the order's persisted provider origin; this boundary still
  // rejects schemes/credentials and never accepts renderer-selected destinations.
  const url = parsePaymentCheckoutUrl(checkout.pay_url)
  const current = auth.billingScope(owner)

  if (scope.generation !== current.generation || scope.origin !== current.origin) {
    throw new PlatformClientError('auth_attempt_superseded')
  }

  await openBrowser(url)
}
