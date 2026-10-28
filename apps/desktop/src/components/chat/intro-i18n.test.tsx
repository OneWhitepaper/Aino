// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider, TRANSLATIONS } from '@/i18n'
import { AGENT_NAME } from '@/lib/brand'

import { Intro } from './intro'
import introCopyJsonl from './intro-copy.jsonl?raw'
import introCopyZhJsonl from './intro-copy.zh.jsonl?raw'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('empty chat intro localization', () => {
  it('renders Simplified Chinese copy for a Chinese locale', () => {
    const { container } = render(
      <I18nProvider configClient={null} initialLocale="zh">
        <Intro personality="none" seed={0} />
      </I18nProvider>
    )

    const text = container.textContent ?? ''

    expect(text).toMatch(/[\u4e00-\u9fff]/u)
    expect(text).not.toMatch(/Ask a question|Describe the task|Drop a file|Search the repo|Type a task/u)
  })

  it('renders the Aino home layout and routes every quick action to its existing handler', () => {
    const onPickFiles = vi.fn()
    const onInsertPrompt = vi.fn()

    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <Intro onInsertPrompt={onInsertPrompt} onPickFiles={onPickFiles} personality="none" seed={0} />
      </I18nProvider>
    )

    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/[\u4e00-\u9fff]/u)
    fireEvent.click(screen.getByRole('button', { name: '分析文档' }))
    expect(onPickFiles).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '审查代码' }))
    expect(onInsertPrompt).toHaveBeenCalledWith('请审查当前代码，找出问题并给出可执行的优化建议。')
    expect(screen.getByRole('button', { name: '审查代码' }).querySelector('[data-aino-design-icon]')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '研究主题' }))
    expect(onInsertPrompt).toHaveBeenCalledWith('请深入研究这个主题，并整理出关键结论与可靠来源。')

    fireEvent.click(screen.getByRole('button', { name: '生成报告' }))
    expect(onInsertPrompt).toHaveBeenCalledWith('请根据当前上下文生成一份结构化报告。')
  })

  it.each([
    { locale: 'en', raw: introCopyJsonl },
    { locale: 'zh', raw: introCopyZhJsonl }
  ] as const)('reuses the $locale copy pool without rerandomizing on a home rerender', ({ locale, raw }) => {
    const records = raw
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as { personality: string; body: string; headline: string })

    const neutral = records.filter(record => record.personality === 'none')
    const helpful = records.filter(record => record.personality === 'helpful')

    const random = vi.spyOn(Math, 'random').mockReturnValue(0)

    const view = (seed: number, personality = 'none') => (
      <I18nProvider configClient={null} initialLocale={locale}>
        <Intro home personality={personality} seed={seed} />
      </I18nProvider>
    )

    const { container, rerender } = render(view(0))

    const subtitle = () => container.querySelector('.aino-home-subtitle')?.textContent

    expect(subtitle()).toBe(neutral[0].body)
    random.mockReturnValue(0.00003)
    rerender(view(0))
    expect(subtitle()).toBe(neutral[0].body)

    rerender(view(1))
    expect(subtitle()).toBe(neutral[1].body)
    expect(subtitle()).not.toBe(neutral[0].body)

    rerender(view(1, 'helpful'))
    expect(subtitle()).toBe(helpful[1].body)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(helpful[1].headline)
  })

  it.each(['ja', 'zh-hant'] as const)('keeps the localized home subtitle when %s has no copy pool', locale => {
    const { container } = render(
      <I18nProvider configClient={null} initialLocale={locale}>
        <Intro home personality="none" seed={0} />
      </I18nProvider>
    )

    expect(container.querySelector('.aino-home-subtitle')?.textContent).toBe(TRANSLATIONS[locale].home.subtitle)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(AGENT_NAME)
  })
})
