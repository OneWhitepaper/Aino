import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { $activeTreeGroup, $layoutTree, noteActiveTreeGroup } from '@/components/pane-shell/tree/store'
import { $workspaceMode } from '@/components/pane-shell/workspace-scope'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $connectionsRegistry } from '@/store/connection-registry-state'
import { $notifications, resetNotifications } from '@/store/notifications'
import { $activeGatewayProfile } from '@/store/profile'
import {
  $activeSessionId,
  $connection,
  $currentCwd,
  $selectedStoredSessionId,
  $sessions,
  $workspaceCwdOwner
} from '@/store/session'
import { $sessionStates, $sessionTiles } from '@/store/session-states'
import { $toolSession, toolSessionHasCurrentSource } from '@/store/tool-session'
import { makeSessionInfo } from '@/test/session-info'

import { resetProjectTreeState } from './files/use-project-tree'
import { useSummarySession } from './summary/use-summary-session'
import {
  $terminals,
  bindTerminalDefaultGateway,
  closeAllTerminals,
  createTerminal,
  terminalSourceIsCurrent,
  updateTerminalRestoreCwd
} from './terminal/terminals'

import { RightSidebarPane } from './index'

const readDir = vi.fn(async (_cwd: string) => ({ entries: [] }))

beforeEach(() => {
  $connection.set(null)
  $connectionsRegistry.set(null)
  resetNotifications()
  $activeGatewayProfile.set('default')
  $workspaceMode.set('sessions')
  $sessionTiles.set([])
  $selectedStoredSessionId.set('main-chat')
  $activeSessionId.set('main-runtime')
  $currentCwd.set('/project-a')
  $workspaceCwdOwner.set('main-chat')
  $sessions.set([])
  $sessionStates.set({
    'main-runtime': { ...createClientSessionState('main-chat'), cwd: '/project-a', model: 'model-a' },
    'tile-runtime': { ...createClientSessionState('tile-chat'), cwd: '/project-b', model: 'model-b' }
  })
  $sessionTiles.set([
    {
      storedSessionId: 'tile-chat',
      runtimeId: 'tile-runtime',
      ownerRoute: { connectionId: 'local', profile: 'default' }
    }
  ])
  $layoutTree.set({
    id: 'root',
    type: 'split',
    orientation: 'row',
    weights: [1, 1, 1],
    children: [
      { id: 'main', type: 'group', panes: ['workspace'], active: 'workspace' },
      { id: 'tile', type: 'group', panes: ['session-tile:tile-chat'], active: 'session-tile:tile-chat' },
      { id: 'tools', type: 'group', panes: ['files', 'review', 'terminal'], active: 'files' }
    ]
  })
  noteActiveTreeGroup('main')
  bindTerminalDefaultGateway(atom(undefined))
  closeAllTerminals()
  resetProjectTreeState()
  readDir.mockClear()
  ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { readDir }
})

afterEach(() => {
  cleanup()
  closeAllTerminals()
  resetProjectTreeState()
  $sessionTiles.set([])
  $sessionStates.set({})
  $layoutTree.set(null)
  $activeTreeGroup.set(null)
  $connectionsRegistry.set(null)
  resetNotifications()
  delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
})

it('keeps shared tools on the last interacted chat while existing shells retain their directories', async () => {
  const summary = renderHook(() => useSummarySession())
  render(<RightSidebarPane onActivateFile={vi.fn()} onActivateFolder={vi.fn()} />)
  await waitFor(() => expect(readDir).toHaveBeenCalledWith('/project-a'))
  const first = createTerminal()!
  updateTerminalRestoreCwd(first, '/project-a/subfolder')

  act(() => noteActiveTreeGroup('tile'))
  expect(summary.result.current).toMatchObject({ storedId: 'tile-chat', runtimeId: 'tile-runtime', cwd: '/project-b' })
  await waitFor(() => expect(readDir).toHaveBeenCalledWith('/project-b'))

  act(() => noteActiveTreeGroup('tools'))
  expect(summary.result.current.storedId).toBe('tile-chat')
  const beforeToken = summary.result.current
  act(() =>
    $sessionStates.set({
      ...$sessionStates.get(),
      'tile-runtime': {
        ...$sessionStates.get()['tile-runtime'],
        messages: [{ id: 'delta', role: 'assistant', parts: [{ type: 'text', text: 'streaming' }] }]
      }
    })
  )
  expect(summary.result.current).toBe(beforeToken)
  const second = createTerminal()!
  expect($terminals.get().find(term => term.id === second)?.cwd).toBe('/project-b')
  expect($terminals.get().find(term => term.id === first)).toMatchObject({
    cwd: '/project-a',
    restoreCwd: '/project-a/subfolder'
  })

  act(() => noteActiveTreeGroup('main'))
  expect(summary.result.current.cwd).toBe('/project-a')
  expect($terminals.get().find(term => term.id === second)?.cwd).toBe('/project-b')
})

it('does not use a local filesystem or shell for a chat belonging to another connection', async () => {
  const localTerminal = createTerminal()!
  $sessionTiles.set([
    {
      storedSessionId: 'tile-chat',
      runtimeId: 'tile-runtime',
      ownerRoute: { connectionId: 'remote-b', profile: 'default' }
    }
  ])
  noteActiveTreeGroup('tile')
  const summary = renderHook(() => useSummarySession())
  render(<RightSidebarPane onActivateFile={vi.fn()} onActivateFolder={vi.fn()} />)

  expect(summary.result.current.scope.connectionId).toBe('remote-b')
  expect(readDir).not.toHaveBeenCalled()
  expect(createTerminal()).toBeNull()
  expect($terminals.get().map(term => term.id)).toEqual([localTerminal])

  act(() =>
    $connection.set({ mode: 'remote', remoteKind: 'ssh', connectionId: 'remote-b', profile: 'default' } as NonNullable<
      ReturnType<typeof $connection.get>
    >)
  )
  // A connection switch restores its own tile bucket; reopen this chat on that owner.
  act(() =>
    $sessionTiles.set([
      {
        storedSessionId: 'tile-chat',
        runtimeId: 'tile-runtime',
        ownerRoute: { connectionId: 'remote-b', profile: 'default' }
      }
    ])
  )
  // Publish the newly attached runtime's workspace.
  act(() => $sessionStates.set({ 'tile-runtime': { ...createClientSessionState('tile-chat'), cwd: '/project-b' } }))
  const remoteTerminal = createTerminal()!
  expect($terminals.get().find(term => term.id === remoteTerminal)?.cwd).toBe('/project-b')
  expect(terminalSourceIsCurrent(localTerminal)).toBe(false)
  expect(terminalSourceIsCurrent(remoteTerminal)).toBe(true)
  expect($terminals.get().find(term => term.id === localTerminal)?.cwd).toBe('/project-a')
})

it('opens a pooled Bot shell without changing the foreground gateway profile', () => {
  bindTerminalDefaultGateway(atom({ connectionId: 'local' }))
  $sessionTiles.set([
    {
      storedSessionId: 'tile-chat',
      runtimeId: 'tile-runtime',
      ownerRoute: { connectionId: 'local', profile: 'writer' }
    }
  ])
  noteActiveTreeGroup('tile')

  expect(toolSessionHasCurrentSource($toolSession.get())).toBe(false)
  const id = createTerminal()

  expect(id).not.toBeNull()
  expect($terminals.get().find(term => term.id === id)).toMatchObject({
    connectionId: 'local',
    cwd: '/project-b',
    profile: 'writer'
  })
  expect($activeGatewayProfile.get()).toBe('default')
})

it('records the pooled Bot profile on an SSH shell instead of the ambient profile', () => {
  $connection.set({ mode: 'remote', remoteKind: 'ssh', connectionId: 'remote-b', profile: 'default' } as NonNullable<
    ReturnType<typeof $connection.get>
  >)
  bindTerminalDefaultGateway(atom({ connectionId: 'remote-b', profile: 'default' }))
  $sessionTiles.set([
    {
      storedSessionId: 'tile-chat',
      runtimeId: 'tile-runtime',
      ownerRoute: { connectionId: 'remote-b', profile: 'writer' }
    }
  ])
  $sessionStates.set({ 'tile-runtime': { ...createClientSessionState('tile-chat'), cwd: '/bot-project' } })
  noteActiveTreeGroup('tile')

  const id = createTerminal()

  expect(id).not.toBeNull()
  expect($terminals.get().find(term => term.id === id)).toMatchObject({
    connectionId: 'remote-b',
    cwd: '/bot-project',
    profile: 'writer'
  })
  expect($activeGatewayProfile.get()).toBe('default')
})

it('does not borrow the local shell for an unowned session in registry topology', () => {
  $connectionsRegistry.set({
    version: 2,
    primary: 'local',
    secureTokenStorage: true,
    connections: [{ id: 'local', kind: 'local', label: 'This device', tokenSet: false, tokenPreview: '' }]
  })
  expect($toolSession.get().owner).toBeUndefined()

  expect(createTerminal()).toBeNull()
  expect($terminals.get()).toEqual([])
  expect($notifications.get().at(-1)).toMatchObject({
    title: 'Could not open terminal',
    message: 'Reopen this chat on its original connection, then try again.'
  })
})

it.each(['url', 'cloud'] as const)('does not open a local shell for a %s-only connection', remoteKind => {
  $connection.set({ mode: 'remote', remoteKind, connectionId: 'remote-b', profile: 'default' } as NonNullable<
    ReturnType<typeof $connection.get>
  >)
  // The native default fallback must not turn a remote path into a local one.
  bindTerminalDefaultGateway(atom({ connectionId: 'local' }))
  $sessionTiles.set([
    {
      storedSessionId: 'tile-chat',
      runtimeId: 'tile-runtime',
      ownerRoute: { connectionId: 'remote-b', profile: 'writer' }
    }
  ])
  noteActiveTreeGroup('tile')

  expect(createTerminal()).toBeNull()
  expect($terminals.get()).toEqual([])
  expect($notifications.get().at(-1)).toMatchObject({
    title: 'Could not open terminal',
    message: 'This connection does not provide a terminal. Use this device or an SSH connection.'
  })
})

it('does not treat a pooled remote override as a local Bot shell', () => {
  $sessionTiles.set([
    {
      storedSessionId: 'tile-chat',
      runtimeId: 'tile-runtime',
      ownerRoute: { connectionId: 'local', mode: 'remote', profile: 'remote-writer' }
    }
  ])
  noteActiveTreeGroup('tile')

  expect(createTerminal()).toBeNull()
  expect($terminals.get()).toEqual([])
})

it.each(['local', 'remote-b'])('does not pass a %s SSH conversation path to a local shell fallback', connectionId => {
  $connection.set({ mode: 'remote', remoteKind: 'ssh', connectionId, profile: 'default' } as NonNullable<
    ReturnType<typeof $connection.get>
  >)
  bindTerminalDefaultGateway(atom({ connectionId: 'local' }))
  $sessionTiles.set([
    {
      storedSessionId: 'tile-chat',
      runtimeId: 'tile-runtime',
      ownerRoute: { connectionId, mode: 'remote', profile: 'writer' }
    }
  ])
  noteActiveTreeGroup('tile')

  expect(createTerminal()).toBeNull()
  expect($terminals.get()).toEqual([])
})

it('does not guess the host of a bare pooled profile whose backend is not dialed', () => {
  $sessions.set([makeSessionInfo({ id: 'main-chat', profile: 'writer' })])

  expect($toolSession.get().owner).toBe('writer')
  expect(createTerminal()).toBeNull()
  expect($terminals.get()).toEqual([])
})
