import { afterEach, describe, expect, it, vi } from 'vitest'

import { setRuntimeI18nLocale } from '@/i18n'
import { $notifications } from '@/store/notifications'
import { applyReaction } from '@/store/reactions'
import { $activeSessionId, $messages } from '@/store/session'
import type { MessageReaction } from '@/types/hermes'

import { toggleMessageReaction } from './reactions'

const gatewayStore = await import('./gateway')

const at = 1_700_000_000

const message = {
  id: 'message-1',
  parts: [{ type: 'text', text: 'hello' }],
  role: 'assistant'
} as never

afterEach(() => {
  setRuntimeI18nLocale('en')
  $activeSessionId.set(null)
  $messages.set([])
  $notifications.set([])
  gatewayStore.setPrimaryGateway(null)
  vi.restoreAllMocks()
})

describe('toggleMessageReaction localization', () => {
  it('uses Simplified Chinese copy when there is no active session', async () => {
    setRuntimeI18nLocale('zh')

    await toggleMessageReaction(message, '👍')

    expect($notifications.get()[0]).toMatchObject({
      message: '没有活跃会话',
      title: '回应失败'
    })
  })

  it('uses Simplified Chinese copy when the gateway is unavailable', async () => {
    setRuntimeI18nLocale('zh')
    $activeSessionId.set('session-1')

    await toggleMessageReaction(message, '👍')

    expect($notifications.get()[0]).toMatchObject({
      message: '网关未连接',
      title: '回应失败'
    })
  })
})

function reaction(emoji: string, author: MessageReaction['author']): MessageReaction {
  return { emoji, author, at }
}

describe('applyReaction', () => {
  it('adds a reaction to an empty message', () => {
    expect(applyReaction(undefined, '❤️', 'user')).toMatchObject([{ emoji: '❤️', author: 'user' }])
  })

  it('replaces the same author’s existing reaction (one per author)', () => {
    const next = applyReaction([reaction('❤️', 'user')], '😂', 'user')

    expect(next).toHaveLength(1)
    expect(next[0].emoji).toBe('😂')
  })

  it('retracts when the live reaction is re-sent', () => {
    expect(applyReaction([reaction('👍', 'user')], '👍', 'user')).toEqual([])
  })

  it('clears on an explicit null', () => {
    expect(applyReaction([reaction('👍', 'user')], null, 'user')).toEqual([])
  })

  it('keeps authors independent', () => {
    const next = applyReaction([reaction('🔥', 'agent')], '❤️', 'user')

    expect(next.map(r => r.author).sort()).toEqual(['agent', 'user'])
  })

  it('retracting one author leaves the other intact', () => {
    const next = applyReaction([reaction('🔥', 'agent'), reaction('❤️', 'user')], null, 'user')

    expect(next).toMatchObject([{ emoji: '🔥', author: 'agent' }])
  })

  it('never mutates the input array', () => {
    const before = [reaction('❤️', 'user')]
    const snapshot = [...before]

    applyReaction(before, '😂', 'user')

    expect(before).toEqual(snapshot)
  })
})
