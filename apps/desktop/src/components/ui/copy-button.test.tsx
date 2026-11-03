import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider, setRuntimeI18nLocale } from '@/i18n'
import { writeClipboardText } from '@/lib/clipboard'

import { CopyButton } from './copy-button'

describe('CopyButton i18n', () => {
  afterEach(() => {
    setRuntimeI18nLocale('en')
    cleanup()
    vi.restoreAllMocks()
  })

  it('uses localized default labels and copied feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })

    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <CopyButton text="hello" />
      </I18nProvider>
    )

    const button = screen.getByRole('button', { name: '复制' })

    expect(button.textContent).toContain('复制')
    fireEvent.click(button)

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('hello'))
    await waitFor(() => expect(screen.getByRole('button', { name: '已复制' })).toBeTruthy())
    expect(screen.getByRole('button', { name: '已复制' }).textContent).toContain('已复制')
  })

  it('uses Simplified Chinese copy when no clipboard bridge is available', async () => {
    setRuntimeI18nLocale('zh')
    Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })

    await expect(writeClipboardText('hello')).rejects.toThrow('剪贴板功能不可用')
  })
})
