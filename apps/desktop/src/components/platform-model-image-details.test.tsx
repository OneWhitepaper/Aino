import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'
import { platformModel } from '@/test/platform-model'

import { PlatformModelDetails } from './platform-model-details'

afterEach(cleanup)

it('opens localized image capabilities and billing rules without invented prices', () => {
  const image = {
    ...platformModel('image'),
    display_name: '图片模型',
    purpose: 'image' as const,
    api_mode: 'images_generations' as const,
    capabilities: { ...platformModel().capabilities, image_generation: true },
    pricing: { ...platformModel().pricing, unit: 'billing_rules', input: null, output: null }
  }

  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <details>
        <summary>价格与能力</summary>
        <PlatformModelDetails model={image} />
      </details>
    </I18nProvider>
  )
  fireEvent.click(screen.getByText('价格与能力'))
  expect(screen.getByText('按实际生图计费规则结算，可在我的账户查看用量。')).toBeTruthy()
  expect(screen.getByText('图像生成')).toBeTruthy()
  expect(screen.getByText('支持')).toBeTruthy()
  expect(screen.queryByText('输入')).toBeNull()
  expect(screen.queryByText('工具调用')).toBeNull()
  expect(screen.queryByText(/billing_rules/)).toBeNull()
})
