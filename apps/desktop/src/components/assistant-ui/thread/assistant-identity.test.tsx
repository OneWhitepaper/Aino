import { act, cleanup, render } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { PRIMARY_SESSION_VIEW, SessionViewProvider } from '@/app/chat/session-view'
import { WORKSPACE_AVATAR_AREA } from '@/components/pane-shell/workspace-scope'
import { registry } from '@/contrib/registry'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $botChatScopes, $botChatSessionIds } from '@/store/bot-chat-scope'
import { $activeSessionId, $activeSessionStoredIdRotation, $selectedStoredSessionId } from '@/store/session'
import {
  $sessionStates,
  $sessionTiles,
  publishSessionState,
  setSessionTileWorkspaceScope
} from '@/store/session-states'

import { AssistantIdentity } from './assistant-identity'

let restore: () => void
let unregister: () => void

beforeEach(() => {
  const active = $activeSessionId.get()
  const selected = $selectedStoredSessionId.get()
  const bots = $botChatSessionIds.get()
  const scopes = $botChatScopes.get()
  const tiles = $sessionTiles.get()
  const states = $sessionStates.get()
  const rotation = $activeSessionStoredIdRotation.get()

  restore = () => {
    $activeSessionId.set(active)
    $selectedStoredSessionId.set(selected)
    $botChatSessionIds.set(bots)
    $botChatScopes.set(scopes)
    $sessionTiles.set(tiles)
    $sessionStates.set(states)
    $activeSessionStoredIdRotation.set(rotation)
  }

  unregister = registry.register({
    id: 'test.session-portraits',
    area: WORKSPACE_AVATAR_AREA,
    data: { avatarFor: (ownerKey: string) => <span data-testid="portrait">{ownerKey}</span> }
  })
})

afterEach(() => {
  cleanup()
  unregister()
  restore()
})

interface IdentityProps {
  runtimeId: string
  storedId: string
}

function Identity({ runtimeId, storedId }: IdentityProps) {
  const view = {
    ...PRIMARY_SESSION_VIEW,
    kind: 'tile' as const,
    $runtimeId: atom<string | null>(runtimeId),
    $storedId: atom<string | null>(storedId)
  }

  return (
    <SessionViewProvider value={view}>
      <AssistantIdentity />
    </SessionViewProvider>
  )
}

it('keeps split portraits bound to exact durable owners across a runtime rebind and foreground changes', () => {
  $activeSessionId.set('runtime-a')
  $selectedStoredSessionId.set('stored-a')
  $botChatSessionIds.set(new Set(['stored-a', 'stored-b']))
  $botChatScopes.set({
    'stored-a': { workspaceMode: 'bots', workspaceOwnerKey: 'bot:source-a::default' },
    'stored-b': { workspaceMode: 'bots', workspaceOwnerKey: 'bot:source-b::default' }
  })
  $sessionTiles.set([
    { runtimeId: 'runtime-a', storedSessionId: 'stored-a' },
    { runtimeId: 'runtime-b', storedSessionId: 'stored-b' }
  ])

  const { container } = render(
    <>
      <Identity runtimeId="runtime-a" storedId="pre-compaction-a" />
      <Identity runtimeId="runtime-b" storedId="stored-b" />
      <Identity runtimeId="ordinary-runtime" storedId="ordinary-stored" />
    </>
  )

  const owners = () => [...container.querySelectorAll('[data-testid="portrait"]')].map(el => el.textContent)
  expect(owners()).toEqual(['bot:source-a::default', 'bot:source-b::default'])
  expect(container.querySelectorAll('[data-slot="aui_assistant-brand"]')).toHaveLength(1)

  act(() => {
    $activeSessionId.set('runtime-b')
    $selectedStoredSessionId.set('stored-b')
    $sessionTiles.set([
      {
        runtimeId: 'runtime-a',
        storedSessionId: 'compacted-a',
        workspaceMode: 'bots',
        workspaceOwnerKey: 'bot:source-a::default'
      },
      { runtimeId: 'runtime-b', storedSessionId: 'stored-b' }
    ])
  })
  expect(owners()).toEqual(['bot:source-a::default', 'bot:source-b::default'])
  expect(container.querySelectorAll('[data-slot="aui_assistant-brand"]')).toHaveLength(1)
})

it('uses a neutral bot identity while the portrait plugin is absent, never a foreground portrait or Aino mark', () => {
  $botChatSessionIds.set(new Set(['unknown-owner']))
  $botChatScopes.set({})
  const { container } = render(<Identity runtimeId="unknown-runtime" storedId="unknown-owner" />)

  expect(container.querySelector('[data-slot="aui_assistant-avatar"] .codicon-hubot')).toBeTruthy()
  expect(container.querySelector('[data-slot="aui_assistant-brand"]')).toBeNull()

  act(() =>
    $botChatScopes.set({ 'unknown-owner': { workspaceMode: 'bots', workspaceOwnerKey: 'bot:remote::default' } })
  )
  expect(container.querySelector('[data-testid="portrait"]')?.textContent).toBe('bot:remote::default')
  act(unregister)
  expect(container.querySelector('[data-testid="portrait"]')).toBeNull()
  expect(container.querySelector('[data-slot="aui_assistant-avatar"] .codicon-hubot')).toBeTruthy()
})

it('keeps the primary Bot portrait across real compression without a tile, retaining old-history ownership', () => {
  $activeSessionId.set('runtime-main')
  $selectedStoredSessionId.set('stored-before')
  $sessionTiles.set([])

  const scope = {
    workspaceMode: 'bots' as const,
    workspaceOwnerKey: 'bot:source-a::default',
    workspaceTabTitle: 'Research',
    ownerRoute: { connectionId: 'source-a', mode: 'remote' as const, profile: 'default', targetProfile: 'research' }
  }

  setSessionTileWorkspaceScope('stored-before', scope)
  publishSessionState('runtime-main', createClientSessionState('stored-before'))

  const { container } = render(
    <>
      <SessionViewProvider value={PRIMARY_SESSION_VIEW}>
        <AssistantIdentity />
      </SessionViewProvider>
      <Identity runtimeId="old-history-runtime" storedId="stored-before" />
    </>
  )

  const portraits = () => [...container.querySelectorAll('[data-testid="portrait"]')].map(el => el.textContent)
  expect(portraits()).toEqual(['bot:source-a::default', 'bot:source-a::default'])

  act(() => {
    publishSessionState('runtime-main', createClientSessionState('stored-after'))
    $selectedStoredSessionId.set('stored-after')
  })
  expect(portraits()).toEqual(['bot:source-a::default', 'bot:source-a::default'])
  expect(container.querySelector('[data-slot="aui_assistant-brand"]')).toBeNull()
  expect($botChatScopes.get()['stored-after']).toEqual(scope)
  expect($botChatScopes.get()['stored-before']).toEqual(scope)
  expect($botChatSessionIds.get().has('stored-after')).toBe(true)
})
