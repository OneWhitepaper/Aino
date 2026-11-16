import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { $workspaceMode } from '@/components/pane-shell/workspace-scope'
import { $botChatScopes } from '@/store/bot-chat-scope'
import { $sessionTiles } from '@/store/session-states'

import { useBotChatPresentation } from './use-bot-chat-presentation'

let restore: () => void

beforeEach(() => {
  const scopes = $botChatScopes.get()
  const tiles = $sessionTiles.get()
  const mode = $workspaceMode.get()

  restore = () => {
    $botChatScopes.set(scopes)
    $sessionTiles.set(tiles)
    $workspaceMode.set(mode)
  }

  $sessionTiles.set([])
})

afterEach(() => {
  cleanup()
  restore()
})

function Surface({ id }: { id: string }) {
  const { canonical, ownerKey } = useBotChatPresentation(id)

  return <div data-canonical={canonical} data-owner={ownerKey} data-testid={id} />
}

it('distinguishes the canonical companion from a side chat and ordinary session in the same Bot workspace', () => {
  $workspaceMode.set('bots')
  $botChatScopes.set({
    canonical: { workspaceMode: 'bots', workspaceOwnerKey: 'bot:studio::writer', workspaceTabTitle: 'Bot Chat' },
    side: { workspaceMode: 'bots', workspaceOwnerKey: 'bot:studio::writer' }
  })
  render(
    <>
      <Surface id="canonical" />
      <Surface id="side" />
      <Surface id="ordinary" />
    </>
  )
  expect(screen.getByTestId('canonical').dataset.canonical).toBe('true')
  expect(screen.getByTestId('canonical').dataset.owner).toBe('bot:studio::writer')
  expect(screen.getByTestId('side').dataset.canonical).toBe('false')
  expect(screen.getByTestId('ordinary').dataset.canonical).toBe('false')

  act(() => $workspaceMode.set('sessions'))
  expect(screen.getByTestId('canonical').dataset.canonical).toBe('true')
})

it('keeps retained tile identity local and reacts when canonical scope arrives after hydration', () => {
  $botChatScopes.set({})
  $sessionTiles.set([
    {
      storedSessionId: 'retained',
      workspaceMode: 'bots',
      workspaceOwnerKey: 'bot:remote::writer',
      workspaceTabTitle: 'Bot Chat'
    }
  ])
  render(
    <>
      <Surface id="retained" />
      <Surface id="hydrating" />
    </>
  )
  expect(screen.getByTestId('retained').dataset.owner).toBe('bot:remote::writer')
  expect(screen.getByTestId('hydrating').dataset.canonical).toBe('false')
  act(() =>
    $botChatScopes.set({
      hydrating: { workspaceMode: 'bots', workspaceOwnerKey: 'bot:local::writer', workspaceTabTitle: 'Bot Chat' }
    })
  )
  expect(screen.getByTestId('hydrating').dataset.canonical).toBe('true')
  expect(screen.getByTestId('retained').dataset.owner).toBe('bot:remote::writer')
})
