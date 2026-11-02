import { formatUsageAmount } from './usage-view'

/** Presentation only: round the decimal string without converting the ledger value to a float. */
export function compactWalletBalance(amount: string): string {
  const exact = formatUsageAmount(amount)
  const [whole, fraction = ''] = exact.split('.')

  if (fraction.length <= 2) {
    return exact
  }

  const negative = whole.startsWith('-')
  const cents = BigInt(whole.replace(/^-/, '')) * 100n + BigInt(fraction.slice(0, 2))
  const rounded = cents + (fraction[2] >= '5' ? 1n : 0n)

  return `${negative && rounded !== 0n ? '-' : ''}${rounded / 100n}.${String(rounded % 100n).padStart(2, '0')}`
}
