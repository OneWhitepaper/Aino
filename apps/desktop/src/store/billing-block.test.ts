import type { BillingBlock } from '@hermes/shared'
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('@/lib/external-link', () => ({ openExternalLink: vi.fn() }))
vi.mock('@/store/session', () => ({ setModelPickerOpen: vi.fn() }))

import { openExternalLink } from '@/lib/external-link'
import { setModelPickerOpen } from '@/store/session'

import {
  $billingBlock,
  clearBillingBlock,
  runBillingRecovery,
  setBillingBlock
} from './billing-block'

function makeBlock(overrides: Partial<BillingBlock> = {}): BillingBlock {
  return {
    billing_url: 'https://platform.openai.com/settings/organization/billing',
    is_nous: false,
    message: 'You are out of credits.',
    model: 'gpt-5',
    provider: 'openai',
    provider_label: 'OpenAI',
    ...overrides
  }
}

beforeEach(() => {
  $billingBlock.set(null)
  vi.clearAllMocks()
})

test('clearBillingBlock scoped to a session leaves a different session block intact', () => {
  setBillingBlock('s1', makeBlock())
  clearBillingBlock('s2')
  expect($billingBlock.get()).not.toBeNull()

  clearBillingBlock('s1')
  expect($billingBlock.get()).toBeNull()
})

test('clearBillingBlock with no arg clears any active block', () => {
  setBillingBlock('s1', makeBlock())
  clearBillingBlock()
  expect($billingBlock.get()).toBeNull()
})

test('runBillingRecovery sends managed account billing walls to model selection', () => {
  runBillingRecovery(makeBlock({ is_nous: true, provider: 'nous', provider_label: 'Nous Portal' }))
  expect(setModelPickerOpen).toHaveBeenCalledWith(true)
  expect(openExternalLink).not.toHaveBeenCalled()
})

test('runBillingRecovery deep-links a third-party provider to its billing page', () => {
  const block = makeBlock({ billing_url: 'https://openrouter.ai/settings/credits', provider: 'openrouter' })
  runBillingRecovery(block)
  expect(openExternalLink).toHaveBeenCalledWith('https://openrouter.ai/settings/credits')
  expect(setModelPickerOpen).not.toHaveBeenCalled()
})

test('runBillingRecovery returns to model selection when a provider has no billing URL', () => {
  runBillingRecovery(makeBlock({ billing_url: null, provider: 'custom' }))
  expect(openExternalLink).not.toHaveBeenCalled()
  expect(setModelPickerOpen).toHaveBeenCalledWith(true)
})
