// @vitest-environment jsdom
import type { Unstable_TriggerItem } from '@assistant-ui/core'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

import { useAtCompletions } from './hooks/use-at-completions'
import { useSlashCompletions } from './hooks/use-slash-completions'
import { ComposerTriggerPopover } from './trigger-popover'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function settleSearch(
  hook: { result: { current: { adapter: { search?: (query: string) => readonly Unstable_TriggerItem[] } | null } } },
  query: string
): Promise<readonly Unstable_TriggerItem[]> {
  act(() => {
    hook.result.current.adapter?.search?.(query)
  })

  await act(async () => {
    await vi.advanceTimersByTimeAsync(200)
  })

  return hook.result.current.adapter?.search?.(query) ?? []
}

describe('composer completion localization', () => {
  it('localizes @ reference descriptions and the /resume browse action', async () => {
    vi.useFakeTimers()

    const gateway = {
      request: vi.fn(async (method: string) => {
        if (method === 'complete.path') {
          return { items: [] }
        }

        if (method === 'commands.catalog') {
          return {
            categories: [{ name: 'Session', pairs: [['/branch', 'Branch the current session']] }],
            pairs: [['/branch', 'Branch the current session']]
          }
        }

        return { items: [] }
      })
    }

    const wrapper = ({ children }: { children: ReactNode }) => (
      <I18nProvider configClient={null} initialLocale="zh">
        {children}
      </I18nProvider>
    )

    const at = renderHook(() => useAtCompletions({ cwd: '/repo', gateway: gateway as never, sessionId: 's1' }), {
      wrapper
    })

    const slash = renderHook(() => useSlashCompletions({ gateway: gateway as never }), { wrapper })

    const atItems = await settleSearch(at, '')
    const slashItems = await settleSearch(slash, 'resume ')
    const catalogItems = await settleSearch(slash, '')

    expect(atItems.find(item => item.label === '@file:')?.description).toBe('引用文件')
    expect(atItems.find(item => item.label === '@folder:')?.description).toBe('引用文件夹')
    expect(slashItems.some(item => item.label === '浏览全部会话…')).toBe(true)
    expect(catalogItems.find(item => (item.metadata as { command?: string }).command === '/branch')?.description).toBe(
      '将最新消息分支到新对话'
    )
  })

  it('localizes slash completion group headings without changing their internal ids', () => {
    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <ComposerTriggerPopover
          activeIndex={0}
          items={[
            {
              id: '/help',
              label: '/help',
              metadata: { display: '/help', group: 'Commands', meta: '' },
              type: 'slash'
            }
          ]}
          kind="/"
          loading={false}
          onHover={vi.fn()}
          onPick={vi.fn()}
        />
      </I18nProvider>
    )

    expect(screen.getByText('命令')).toBeTruthy()
    expect(screen.queryByText('Commands')).toBeNull()
  })

  it('localizes backend command categories while preserving the category ids', () => {
    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <ComposerTriggerPopover
          activeIndex={0}
          items={[
            {
              id: '/config',
              label: '/config',
              metadata: { display: '/config', group: 'Configuration', meta: '' },
              type: 'slash'
            },
            {
              id: '/tools',
              label: '/tools',
              metadata: { display: '/tools', group: 'Tools & Skills', meta: '' },
              type: 'slash'
            }
          ]}
          kind="/"
          loading={false}
          onHover={vi.fn()}
          onPick={vi.fn()}
        />
      </I18nProvider>
    )

    expect(screen.getByText('配置')).toBeTruthy()
    expect(screen.getByText('工具与技能')).toBeTruthy()
    expect(screen.queryByText('Configuration')).toBeNull()
    expect(screen.queryByText('Tools & Skills')).toBeNull()
  })
})
