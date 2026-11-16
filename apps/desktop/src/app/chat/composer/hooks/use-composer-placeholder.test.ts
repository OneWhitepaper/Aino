import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { i18nState } = vi.hoisted(() => ({
  i18nState: {
    locale: 'en',
    t: {
      composer: {
        placeholderTo: (name: string) => `Message ${name}, or type / to use a skill`,
        newSessionPlaceholders: ['English starter'],
        placeholderReconnecting: 'Reconnecting',
        placeholderStarting: 'Starting',
        followUpPlaceholders: ['English follow-up']
      },
      common: { bots: 'Bot' },
      home: { placeholder: 'Ask anything' }
    }
  }
}))

vi.mock('@/i18n', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useI18n: () => i18nState
}))

vi.mock('@/store/composer-input-history', () => ({
  resetBrowseState: vi.fn()
}))

import { $workspaceOwnerLabels } from '@/components/pane-shell/workspace-scope'
import { $botChatScopes, $botChatSessionIds } from '@/store/bot-chat-scope'
import { $sessionTiles } from '@/store/session-states'

import { useComposerPlaceholder } from './use-composer-placeholder'

let restore: () => void

beforeEach(() => {
  i18nState.locale = 'en'
  i18nState.t = {
    composer: {
      placeholderTo: (name: string) => `Message ${name}, or type / to use a skill`,
      newSessionPlaceholders: ['English starter'],
      placeholderReconnecting: 'Reconnecting',
      placeholderStarting: 'Starting',
      followUpPlaceholders: ['English follow-up']
    },
    common: { bots: 'Bot' },
    home: { placeholder: 'Ask anything' }
  }
  const scopes = $botChatScopes.get()
  const bots = $botChatSessionIds.get()
  const tiles = $sessionTiles.get()
  const labels = $workspaceOwnerLabels.get()

  restore = () => {
    $botChatScopes.set(scopes)
    $botChatSessionIds.set(bots)
    $sessionTiles.set(tiles)
    $workspaceOwnerLabels.set(labels)
  }
})

afterEach(() => {
  cleanup()
  restore()
})

describe('useComposerPlaceholder', () => {
  it('refreshes the visible starter after the persisted locale resolves', () => {
    const view = renderHook(() =>
      useComposerPlaceholder({
        disabled: false,
        reconnecting: false,
        sessionId: null
      })
    )

    expect(view.result.current).toBe('Message Aino, or type / to use a skill')

    i18nState.locale = 'zh'
    i18nState.t = {
      composer: {
        placeholderTo: (name: string) => `发消息给 ${name}，或输入 / 使用技能`,
        newSessionPlaceholders: ['中文起始语'],
        placeholderReconnecting: '正在重新连接',
        placeholderStarting: '正在启动',
        followUpPlaceholders: ['中文后续消息']
      },
      common: { bots: '机器人' },
      home: { placeholder: '随便问点什么' }
    }
    view.rerender()

    expect(view.result.current).toBe('发消息给 Aino，或输入 / 使用技能')
  })

  it('uses the stable landing placeholder when the home layout is active', () => {
    const view = renderHook(() =>
      useComposerPlaceholder({
        disabled: false,
        homeLayout: true,
        reconnecting: false,
        sessionId: null
      })
    )

    expect(view.result.current).toBe('Message Aino, or type / to use a skill')
  })

  it('follows the composer conversation owner and live renames without borrowing another Bot name', () => {
    $sessionTiles.set([
      { runtimeId: 'runtime-a', storedSessionId: 'stored-a' },
      { runtimeId: 'runtime-b', storedSessionId: 'stored-b' }
    ])
    $botChatSessionIds.set(new Set(['stored-a', 'stored-b']))
    $botChatScopes.set({
      'stored-a': { workspaceMode: 'bots', workspaceOwnerKey: 'bot:a' },
      'stored-b': { workspaceMode: 'bots', workspaceOwnerKey: 'bot:b' }
    })
    $workspaceOwnerLabels.set({ 'bot:a': 'Research', 'bot:b': 'Writing' })

    const view = renderHook(
      ({ sessionId }) => useComposerPlaceholder({ disabled: false, reconnecting: false, sessionId }),
      {
        initialProps: { sessionId: 'runtime-a' }
      }
    )

    expect(view.result.current).toBe('Message Research, or type / to use a skill')
    act(() => $workspaceOwnerLabels.set({ 'bot:a': 'Research renamed', 'bot:b': 'Writing' }))
    expect(view.result.current).toBe('Message Research renamed, or type / to use a skill')
    view.rerender({ sessionId: 'runtime-b' })
    expect(view.result.current).toBe('Message Writing, or type / to use a skill')
    view.rerender({ sessionId: 'ordinary' })
    expect(view.result.current).toBe('Message Aino, or type / to use a skill')
  })
})
