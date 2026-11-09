import type { BillingBlock } from '@hermes/shared'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { openExternalLink } from '@/lib/external-link'
import { $billingBlock, setBillingBlock } from '@/store/billing-block'

import { BillingBanner } from './billing-banner'

vi.mock('@/lib/external-link', () => ({ openExternalLink: vi.fn() }))

afterEach(() => {
  cleanup()
  $billingBlock.set(null)
  vi.clearAllMocks()
})

const block: BillingBlock = {
  billing_url: 'https://provider.example.test/billing',
  is_nous: false,
  message: 'Your provider account has no credits.\nOriginal diagnostic stays in the notification.',
  model: 'provider-model',
  provider: 'provider',
  provider_label: `Provider ${'long-name-'.repeat(12)}`
}

it('only offers the owning session its original billing recovery and dismisses that session notice', () => {
  setBillingBlock('session-a', block)

  const content = (sessionId: string) => (
    <I18nProvider configClient={null} initialLocale="en">
      <BillingBanner sessionId={sessionId} />
    </I18nProvider>
  )

  const view = render(content('session-b'))
  expect(screen.queryByRole('button', { name: 'Add credits' })).toBeNull()

  view.rerender(content('session-a'))
  expect(screen.getByText(/Your provider account has no credits/)).toBeTruthy()
  expect(screen.getByText(text => text.includes(block.provider_label))).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Add credits' }))
  expect(openExternalLink).toHaveBeenCalledExactlyOnceWith(block.billing_url)
  expect($billingBlock.get()?.sessionId).toBe('session-a')

  fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
  expect($billingBlock.get()).toBeNull()
})
