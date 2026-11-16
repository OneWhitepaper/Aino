import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { BotChatEmpty, BotChatStartingActions } from './chat-empty'
import { $botMeta, $lastRoster } from './data'
import { translateBots } from './i18n-test-helper'
import type { RosterRow } from './types'

const { insertText, submit } = vi.hoisted(() => ({ insertText: vi.fn(), submit: vi.fn() }))
vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return {
    ...sdk,
    host: { ...sdk.host, composer: { ...sdk.host.composer, insertText, submit } },
    usePluginI18n: () => translateBots
  }
})

const local: RosterRow = {
  name: 'writer',
  connectionId: 'local',
  sourceScoped: true,
  canonical_session: { id: 'shared-root', resolved_id: 'local-tip' }
}

const remote: RosterRow = {
  name: 'writer',
  connectionId: 'studio',
  sourceScoped: true,
  canonical_session: { id: 'shared-root', resolved_id: 'remote-tip' }
}

beforeEach(() => {
  vi.clearAllMocks()
  insertText.mockResolvedValue(true)
  $lastRoster.set([local, remote])
  $botMeta.set({ 'local::writer': { title: 'Local writer' }, 'studio::writer': { title: 'Studio writer' } })
})

afterEach(() => {
  cleanup()
  $lastRoster.set([])
  $botMeta.set({})
})

it('resolves an empty retained chat by its own stored id and exact source, never borrowing focused identity', () => {
  const { rerender, container } = render(
    <BotChatEmpty ownerKey="bot:studio::writer" sessionId="remote-runtime" storedSessionId="shared-root" />
  )

  expect(screen.getByText('Leave it with Studio writer. Let’s start here.')).toBeTruthy()
  expect(screen.queryByText(/Local writer/)).toBeNull()
  rerender(<BotChatEmpty sessionId="ordinary-runtime" storedSessionId="ordinary-session" />)
  expect(container.textContent).toBe('')
})

it('appends a suggestion to its exact draft without sending it or changing another conversation', () => {
  render(
    <BotChatStartingActions ownerKey="bot:studio::writer" sessionId="remote-runtime" storedSessionId="remote-tip" />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Research a topic' }))
  expect(insertText).toHaveBeenCalledExactlyOnceWith('remote-tip', expect.stringContaining('Please research a topic'))
  expect(submit).not.toHaveBeenCalled()
})
