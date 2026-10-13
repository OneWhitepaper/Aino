import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { $activeTreeGroup, $layoutTree, noteActiveTreeGroup } from '@/components/pane-shell/tree/store'
import { $workspaceMode } from '@/components/pane-shell/workspace-scope'
import { createClientSessionState } from '@/lib/chat-runtime'
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

import { resetProjectTreeState } from './files/use-project-tree'
import { useSummarySession } from './summary/use-summary-session'
import {
  $terminals,
  closeAllTerminals,
  createTerminal,
  terminalSourceIsCurrent,
  updateTerminalRestoreCwd
} from './terminal/terminals'

import { RightSidebarPane } from './index'

const readDir = vi.fn(async (_cwd: string) => ({ entries: [] }))

beforeEach(() => {
  $connection.set(null)
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
  act(() => $sessionTiles.set([{ storedSessionId: 'tile-chat', runtimeId: 'tile-runtime', ownerRoute: { connectionId: 'remote-b', profile: 'default' } }]))
  // Publish the newly attached runtime's workspace.
  act(() => $sessionStates.set({ 'tile-runtime': { ...createClientSessionState('tile-chat'), cwd: '/project-b' } }))
  const remoteTerminal = createTerminal()!
  expect($terminals.get().find(term => term.id === remoteTerminal)?.cwd).toBe('/project-b')
  expect(terminalSourceIsCurrent(localTerminal)).toBe(false)
  expect(terminalSourceIsCurrent(remoteTerminal)).toBe(true)
  expect($terminals.get().find(term => term.id === localTerminal)?.cwd).toBe('/project-a')
})
