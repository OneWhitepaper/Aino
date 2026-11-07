import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

import { PageLoader } from './page-loader'

describe('PageLoader', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 0)
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('localizes the default accessible label for the active locale', () => {
    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <PageLoader />
      </I18nProvider>
    )

    expect(screen.getByRole('status', { name: '加载中…' })).toBeTruthy()
  })
})
