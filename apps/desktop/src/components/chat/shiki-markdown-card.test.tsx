import type { SyntaxHighlighterProps } from '@assistant-ui/react-streamdown'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider, setRuntimeI18nLocale } from '@/i18n'
import { stubResizeObserver } from '@/test/jsdom'

import { SyntaxHighlighter } from './shiki-highlighter'

const { writeText } = vi.hoisted(() => ({ writeText: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/clipboard', () => ({ writeClipboardText: writeText }))

const components = { Pre: 'pre' } as unknown as SyntaxHighlighterProps['components']
const source = '# 排查任务\n\n- **检查账号**\n- 保留 `config.yaml`\n\n原样保留 @url:https://example.com\n'

function Card({ code = source, language = 'markdown', defer = true }) {
  return (
    <I18nProvider configClient={null} initialLocale="zh">
      <SyntaxHighlighter code={code} components={components} defer={defer} language={language} />
    </I18nProvider>
  )
}

beforeEach(stubResizeObserver)

afterEach(() => {
  cleanup()
  setRuntimeI18nLocale('en')
  writeText.mockClear()
  vi.restoreAllMocks()
})

describe('Markdown source cards', () => {
  it.each(['md', 'markdown'])('offers a visible copy action for %s source, preserving raw Markdown', async language => {
    const { container } = render(<Card language={language} />)
    const card = container.querySelector<HTMLElement>('[data-slot="code-card"]')

    expect(card).not.toBeNull()
    expect(within(card!).getByText('Markdown')).toBeTruthy()
    expect(card?.querySelector('pre')?.textContent).toBe(source)
    expect(card?.querySelector('h1, strong, ul')).toBeNull()
    const copy = within(card!).getByRole('button', { name: '复制' })
    expect(copy.textContent).toContain('复制')
    expect(copy.closest('[data-slot="code-card-header"]')).not.toBeNull()

    fireEvent.click(copy)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(source))
    await waitFor(() => expect(screen.getByRole('button', { name: '已复制' })).toBeTruthy())
  })

  it('keeps the same card while streaming grows and highlighting settles', async () => {
    const { container, rerender } = render(<Card code="# 标题" />)
    const card = container.querySelector('[data-slot="code-card"]')

    expect(card).not.toBeNull()
    await act(async () => rerender(<Card code={source} />))
    expect(container.querySelector('[data-slot="code-card"]')).toBe(card)
    expect(card?.querySelector('pre')?.textContent).toBe(source)
    expect(within(card as HTMLElement).getByRole('button', { name: '复制' })).toBeTruthy()

    await act(async () => rerender(<Card code={source} defer={false} />))
    await waitFor(() => expect(card?.querySelector('[data-testid="shiki-container"]')).not.toBeNull(), {
      timeout: 5_000
    })
    expect(card?.querySelector('pre')?.textContent).toBe(source)
    expect(container.querySelector('[data-slot="code-card"]')).toBe(card)
    expect(container.querySelector('.aui-prose-fence')).toBeNull()
  })

  it('retains the existing compact presentation for another code language', () => {
    const { container } = render(<Card code="const value = 1;" language="ts" />)

    expect(container.querySelector('[data-slot="code-card"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="code-card-header"]')).toBeNull()
    expect(screen.getByRole('button', { name: '复制代码' }).textContent).toBe('')
  })
})
