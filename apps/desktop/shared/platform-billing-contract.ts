import type { PlatformCheckoutInfo, PlatformWalletSummary } from './platform-contract'

function invalid(): never {
  throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' })
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : invalid()
}

function text(value: unknown, max = 1024): string {
  return typeof value === 'string' && value.length <= max ? value : invalid()
}

function flag(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalid()
}

function date(value: unknown): string {
  const result = text(value, 64)

  return Number.isFinite(Date.parse(result)) ? result : invalid()
}

function decimal(value: unknown, signed = false): string {
  const result = text(value, 32)
  const pattern = signed ? /^-?\d{1,12}(\.\d{1,8})?$/ : /^\d{1,12}(\.\d{1,8})?$/

  return pattern.test(result) ? result : invalid()
}

function legacyLimit(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1e12) {
    return invalid()
  }

  const result = value.toFixed(8)

  return Number(result) === value ? result : invalid()
}

export function parsePlatformWalletSummary(value: unknown): PlatformWalletSummary {
  const data = record(value)

  if (data.currency !== 'USD' || !Array.isArray(data.active_subscriptions) || data.active_subscriptions.length > 1000) {
    return invalid()
  }

  return {
    currency: 'USD',
    balance: decimal(data.balance, true),
    frozen_balance: decimal(data.frozen_balance),
    available_balance: decimal(data.available_balance, true),
    payment_enabled: flag(data.payment_enabled),
    updated_at: date(data.updated_at),
    active_subscriptions: data.active_subscriptions.map(value => {
      const sub = record(value)

      return {
        id: text(sub.id, 128),
        name: text(sub.name),
        expires_at: date(sub.expires_at),
        remaining: sub.remaining === null ? null : decimal(sub.remaining),
        unit: text(sub.unit, 32)
      }
    })
  }
}

export function parsePlatformCheckoutInfo(value: unknown, paymentEnabled: boolean): PlatformCheckoutInfo {
  const data = record(value)
  const methods = record(data.methods)
  const disabled = flag(data.balance_disabled)

  const result: PlatformCheckoutInfo = {
    payment_enabled: paymentEnabled,
    balance_disabled: disabled,
    methods: [],
    help_text: text(data.help_text, 10000)
  }

  // The existing endpoint lists enabled instances; absent methods are not available.
  for (const id of ['alipay', 'wxpay'] as const) {
    if (methods[id] === undefined) {
      continue
    }

    const method = record(methods[id])
    const currency = text(method.currency, 3)

    if (method.payment_type !== id || !/^[A-Z]{3}$/.test(currency)) {
      return invalid()
    }

    const minAmount = legacyLimit(method.single_min)
    const maxAmount = legacyLimit(method.single_max)

    if (Number(maxAmount) !== 0 && Number(maxAmount) < Number(minAmount)) {
      return invalid()
    }

    result.methods.push({
      id,
      display_name: text(method.display_name ?? ''),
      currency,
      min_amount: minAmount,
      max_amount: maxAmount,
      available: paymentEnabled && !disabled
    })
  }

  return result
}
