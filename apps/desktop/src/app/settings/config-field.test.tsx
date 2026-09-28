import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'

import { ConfigField } from './config-field'

afterEach(cleanup)

it('keeps distinct Chinese descriptions while hiding repeated labels or schema keys', () => {
  const schemaKey = 'custom.中文标题'

  const field = (description: string) => (
    <I18nProvider configClient={null} initialLocale="zh">
      <ConfigField onChange={() => {}} schema={{ type: 'string', description }} schemaKey={schemaKey} value="" />
    </I18nProvider>
  )

  const description = '这是与标题不同的中文说明。'
  const { rerender } = render(field(description))

  expect(screen.getByText(description)).toBeTruthy()
  expect(screen.getByText('中文标题')).toBeTruthy()

  rerender(field('中文标题。'))
  expect(screen.queryByText('中文标题。')).toBeNull()
  expect(screen.getAllByText('中文标题')).toHaveLength(1)

  rerender(field(schemaKey))
  expect(screen.queryByText(schemaKey)).toBeNull()
  expect(screen.getByText('中文标题')).toBeTruthy()
})
