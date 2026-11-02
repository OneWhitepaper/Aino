import { expect, it } from 'vitest'

import { compactWalletBalance } from './wallet-balance'

it('rounds the compact balance across decimal carries without losing integer precision', () => {
  expect(compactWalletBalance('9007199254740993.99999999')).toBe('9007199254740994.00')
  expect(compactWalletBalance('808.36323334')).toBe('808.36')
  expect(compactWalletBalance('0.00500000')).toBe('0.01')
})

it('keeps already concise balances and negative zero readable', () => {
  expect(compactWalletBalance('41.00000000')).toBe('41')
  expect(compactWalletBalance('1.23000000')).toBe('1.23')
  expect(compactWalletBalance('-0.00100000')).toBe('0.00')
})
