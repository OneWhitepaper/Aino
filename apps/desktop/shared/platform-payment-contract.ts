import type {
  PaymentQuote,
  PaymentQuoteInput,
  PlatformCreateOrderInput,
  PlatformOrder,
  PlatformOrderPage,
  PlatformOrderQuery,
  PlatformOrderStatus
} from './platform-contract'

function invalid(code = 'invalid_response'): never {
  throw Object.assign(new Error(code), { code })
}

function record(value: unknown, code = 'invalid_response'): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid(code)
}

function text(value: unknown, max = 1024): string {
  return typeof value === 'string' &&
    value.length <= max &&
    !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    ? value
    : invalid()
}

function decimal(value: unknown): string {
  const raw = text(value, 32)

  return /^\d{1,18}(\.\d{1,8})?$/.test(raw) ? raw : invalid()
}

function currency(value: unknown): string {
  const raw = text(value, 3)

  return /^[A-Z]{3}$/.test(raw) ? raw : invalid()
}

function date(value: unknown): string {
  const raw = text(value, 64)

  return Number.isFinite(Date.parse(raw)) ? raw : invalid()
}

function flag(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalid()
}

export function parsePaymentQuote(value: unknown): PaymentQuote {
  const data = record(value)

  if (data.credit_currency !== 'USD') {
    return invalid()
  }

  return {
    requested_amount: decimal(data.requested_amount),
    pay_amount: decimal(data.pay_amount),
    payment_currency: currency(data.payment_currency),
    credit_amount: decimal(data.credit_amount),
    credit_currency: 'USD',
    fee_amount: decimal(data.fee_amount)
  }
}

export function parsePaymentQuoteInput(value: unknown): PaymentQuoteInput {
  const data = record(value, 'invalid_platform_input')

  if (
    typeof data.amount !== 'string' ||
    !/^\d{1,12}(\.\d{1,8})?$/.test(data.amount) ||
    !/[1-9]/.test(data.amount) ||
    (data.payment_type !== 'alipay' && data.payment_type !== 'wxpay') ||
    data.order_type !== 'balance'
  ) {
    return invalid('invalid_platform_input')
  }

  return { amount: data.amount, payment_type: data.payment_type as 'alipay' | 'wxpay', order_type: 'balance' }
}

export function parsePlatformCreateOrderInput(value: unknown): PlatformCreateOrderInput {
  const data = record(value, 'invalid_platform_input')

  if (
    typeof data.client_order_id !== 'string' ||
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(data.client_order_id)
  ) {
    return invalid('invalid_platform_input')
  }

  let expectedQuote: PaymentQuote | undefined

  if (data.expected_quote !== undefined) {
    try {
      expectedQuote = parsePaymentQuote(data.expected_quote)
    } catch {
      return invalid('invalid_platform_input')
    }
  }

  return {
    ...parsePaymentQuoteInput(data),
    client_order_id: data.client_order_id,
    ...(expectedQuote ? { expected_quote: expectedQuote } : {})
  }
}

export function parsePlatformOrderId(value: unknown, code = 'invalid_platform_input'): string {
  const raw = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value

  return typeof raw === 'string' && /^[1-9]\d{0,18}$/.test(raw) ? raw : invalid(code)
}

export function parsePlatformOrderQuery(value: unknown): PlatformOrderQuery {
  const data = record(value, 'invalid_platform_input')

  if (
    !Number.isSafeInteger(data.page) ||
    Number(data.page) < 1 ||
    Number(data.page) > 1_000_000 ||
    !Number.isSafeInteger(data.page_size) ||
    Number(data.page_size) < 1 ||
    Number(data.page_size) > 100
  ) {
    return invalid('invalid_platform_input')
  }

  return { page: data.page as number, page_size: data.page_size as number }
}

const statuses = new Set<PlatformOrderStatus>([
  'PENDING',
  'PAID',
  'RECHARGING',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED',
  'FAILED',
  'REFUND_REQUESTED',
  'REFUNDING',
  'REFUND_PENDING',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'REFUND_FAILED'
])

export function parsePaymentCheckoutUrl(value: unknown): string {
  const raw = text(value, 16384)

  if (!raw.startsWith('https://') || /\s|\\/.test(raw)) {
    return invalid('checkout_unavailable')
  }

  let url: URL

  try {
    url = new URL(raw)
  } catch {
    return invalid('checkout_unavailable')
  }

  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    return invalid('checkout_unavailable')
  }

  return raw
}

export function parsePlatformOrder(value: unknown, now = Date.now()): PlatformOrder {
  const data = record(value)
  const status = text(data.status) as PlatformOrderStatus

  if (!statuses.has(status) || data.credit_currency !== 'USD') {
    return invalid()
  }

  const expiresAt = date(data.expires_at)
  const confirmation = flag(data.confirmation_required)
  const unknown = data.payment_unknown === undefined ? false : flag(data.payment_unknown)
  const pending = status === 'PENDING' && Date.parse(expiresAt) > now
  let checkout: PlatformOrder['checkout'] = null

  if (pending && !confirmation && !unknown && data.checkout != null) {
    const source = record(data.checkout)
    const checkoutExpires = date(source.expires_at)

    if (Date.parse(checkoutExpires) > now) {
      checkout = {
        qr_code: source.qr_code == null || source.qr_code === '' ? null : text(source.qr_code, 16384),
        pay_url: source.pay_url == null || source.pay_url === '' ? null : parsePaymentCheckoutUrl(source.pay_url),
        expires_at: checkoutExpires
      }
    }
  }

  return {
    order_id: parsePlatformOrderId(data.id, 'invalid_response'),
    out_trade_no: text(data.out_trade_no, 256),
    client_order_id:
      data.client_order_id == null || data.client_order_id === '' ? null : text(data.client_order_id, 128),
    status,
    payment_type: text(data.payment_type, 64),
    requested_amount: data.requested_amount_decimal == null ? null : decimal(data.requested_amount_decimal),
    pay_amount: decimal(data.pay_amount_decimal),
    payment_currency: currency(data.payment_currency),
    credit_amount: decimal(data.credit_amount_decimal),
    credit_currency: 'USD',
    fee_amount: data.fee_amount_decimal == null ? null : decimal(data.fee_amount_decimal),
    created_at: date(data.created_at),
    expires_at: expiresAt,
    can_cancel: pending,
    confirmation_required: confirmation,
    payment_unknown: unknown,
    checkout
  }
}

export function parsePlatformOrderPage(value: unknown, now = Date.now()): PlatformOrderPage {
  const data = record(value)

  if (
    !Array.isArray(data.items) ||
    data.items.length > 100 ||
    !Number.isSafeInteger(data.total) ||
    Number(data.total) < 0
  ) {
    return invalid()
  }

  let query: PlatformOrderQuery

  try {
    query = parsePlatformOrderQuery(data)
  } catch {
    return invalid()
  }

  return { ...query, total: data.total as number, items: data.items.map(item => parsePlatformOrder(item, now)) }
}
