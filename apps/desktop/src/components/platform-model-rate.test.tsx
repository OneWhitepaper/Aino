import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'
import { platformModel } from '@/test/platform-model'

import { PlatformModelRate } from './platform-model-rate'

afterEach(cleanup)

it('does not invent multipliers for unknown prices or image-specific billing', () => {
  const unknown = platformModel()
  unknown.pricing.effective_user_rate = 'unknown'
  const negative = platformModel()
  negative.pricing.effective_user_rate = '-1'
  const image = { ...platformModel(), purpose: 'image' as const }

  const { container } = render(
    <>
      <PlatformModelRate model={unknown} />
      <PlatformModelRate model={negative} />
      <PlatformModelRate model={image} />
    </>
  )

  expect(container.textContent).toBe('')
})

it('preserves the exact server decimal and localizes its account-rate description', () => {
  const model = platformModel()
  model.pricing.effective_user_rate = '0.12345678901234567890'
  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <PlatformModelRate model={model} />
    </I18nProvider>
  )

  expect(screen.getByLabelText('账户倍率: 0.1234567890123456789×').textContent).toBe('0.1234567890123456789×')
})
