import { atom, type WritableAtom } from 'nanostores'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registry } from '@/contrib/registry'
import type { CollaborationGroup, CollaborationTask } from '@/store/collaboration-capsule-model'

const fixture = vi.hoisted(() => ({
  open: vi.fn(),
  switchScope: vi.fn(),
  publishScope: vi.fn(),
  hint: vi.fn(),
  tileScope: vi.fn(),
  reveal: vi.fn(),
  panel: vi.fn(() => true),
  visible: true,
  registerRoom: vi.fn(() => 'canonical:exact-room'),
  openRoom: vi.fn(),
  insert: vi.fn(async () => true)
}))

vi.mock('@/sdk/workspace-navigation', () => ({ switchWorkspaceScope: fixture.switchScope }))
vi.mock('@/components/pane-shell/workspace-scope', () => ({
  setWorkspaceScope: fixture.publishScope,
  $workspaceMode: atom('sessions'),
  $workspaceOwnerKey: atom(null)
}))
vi.mock('@/plugins/hermes-bots/canonical-group-registry', () => ({ registerCanonicalGroup: fixture.registerRoom }))
vi.mock('@/plugins/hermes-bots/group-chat-view', () => ({ openGroupChat: fixture.openRoom }))
vi.mock('@/components/pane-shell/tree/store', () => ({ revealTreePane: fixture.reveal }))
vi.mock('../open-session', () => ({ openSession: fixture.open }))
vi.mock('./subagent-panel', () => ({ openSubagentPanel: fixture.panel, subagentPanelSourceKey: () => 'foreground-anchor' }))
vi.mock('@/store/tool-session', () => ({ $toolSession: { get: () => ({ storedId: 'foreground' }) } }))
vi.mock('../chat/composer/focus', () => ({
  requestComposerInsertAcked: fixture.insert,
  getVisibleComposerSurfaceId: () => (fixture.visible ? 'source-surface' : null)
}))
vi.mock('@/store/session-focus', () => ({ $focusedStoredSessionId: atom<string | null>('source-chat') }))
vi.mock('@/store/collaboration-capsule', async () => ({
  ...(await import('@/store/collaboration-capsule-model')),
  $collaborationGroups: atom<CollaborationGroup[]>([])
}))
vi.mock('@/store/bot-chat-scope', () => ({ $botChatScopes: atom({}) }))
vi.mock('@/store/session', () => ({
  $selectedStoredSessionId: atom<string | null>('draft-owner'),
  $sessions: atom([]),
  idsShareLineage: (left: string, right: string) => left === right,
  setSessionOwnerHint: fixture.hint
}))
vi.mock('@/store/session-states', () => ({
  $sessionTiles: atom<{ storedSessionId: string }[]>([]),
  setSessionTileWorkspaceScope: fixture.tileScope
}))
vi.mock('@/store/session-request-router', () => ({
  isSessionOwnerRoute: (owner: unknown) => Boolean(owner && typeof owner === 'object' && 'connectionId' in owner)
}))

import { $collaborationGroups } from '@/store/collaboration-capsule'
import { $selectedStoredSessionId } from '@/store/session'
import { $focusedStoredSessionId } from '@/store/session-focus'
import { $sessionTiles } from '@/store/session-states'

import { openCollaborationGroup, openCollaborationTask, prepareCollaborationRetry } from './collaboration-navigation'

const groups = $collaborationGroups as WritableAtom<CollaborationGroup[]>
const focused = $focusedStoredSessionId as WritableAtom<string | null>
const owner = { connectionId: 'other-gateway', profile: 'research', targetProfile: 'remote-profile' }

const task = {
  key: 'worker-key',
  sourceKey: 'source-key',
  goal: 'Check the original files',
  owner
} as CollaborationTask

function group(changes: Partial<CollaborationGroup> = {}): CollaborationGroup {
  return {
    key: 'source-key',
    title: 'Research bot',
    owner,
    storedSessionId: 'source-chat',
    workspaceMode: 'bots',
    workspaceOwnerKey: 'bot:other-gateway::research',
    runtimeIds: ['source-runtime'],
    tasks: [task],
    ...changes
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  $selectedStoredSessionId.set('draft-owner')
  $sessionTiles.set([])
  groups.set([])
  focused.set('source-chat')
  fixture.visible = true
  fixture.insert.mockResolvedValue(true)
  fixture.registerRoom.mockReset().mockReturnValue('canonical:exact-room')
})
afterEach(() => vi.useRealTimers())

describe('collaboration source navigation', () => {
  it.each([false, true])('opens the exact capsule child in the tool panel without activating any parent (room=%s)', async room => {
    const child = { ...task, id: 'exact-child', parentRuntimeId: 'member-runtime', storedSessionId: 'member-history',
      goal: 'Review changes', displayName: 'Review', status: 'failed', stream: [], sessionId: 'child-history' } as unknown as CollaborationTask

    groups.set([group({ tasks: [child], ...(room ? { roomBinding: { connectionId: 'room', profile: 'authority', roomId: 'room-1' } } : {}) })])
    expect(await openCollaborationTask(child)).toBe(true)
    expect(fixture.panel).toHaveBeenCalledWith(expect.objectContaining({
      anchorSourceKey: 'foreground-anchor', taskId: 'exact-child',
      inspection: { runtimeId: 'member-runtime', storedId: 'member-history', owner },
      row: expect.objectContaining({ subagentId: 'exact-child', sessionId: 'child-history', goal: 'Review changes', status: 'failed' })
    }))
    expect(fixture.open).not.toHaveBeenCalled()
    expect(fixture.openRoom).not.toHaveBeenCalled()
    expect(fixture.switchScope).not.toHaveBeenCalled()
    expect(fixture.insert).not.toHaveBeenCalled()
  })

  it('rejects a capsule entry after its exact source has changed accounts', async () => {
    groups.set([group({ tasks: [{ ...task, owner: { connectionId: 'foreign', profile: 'research' } }] })])
    expect(await openCollaborationTask(task)).toBe(false)
    expect(fixture.panel).not.toHaveBeenCalled()
  })

  it.each(['bots', 'sessions'] as const)('reveals the declared %s rail after choosing the exact source', async mode => {
    const dispose = registry.register({ id: 'owning-rail', area: 'panes', data: { sidebarMode: mode } })

    try {
      expect(await openCollaborationGroup(group({ workspaceMode: mode }), vi.fn())).toBe(true)
      expect(fixture.reveal).toHaveBeenCalledWith('owning-rail')
      expect(fixture.open.mock.invocationCallOrder[0]).toBeLessThan(fixture.reveal.mock.invocationCallOrder[0]!)
    } finally {
      dispose()
    }
  })

  it('opens the captured Bot owner as a tab without replacing the primary draft', async () => {
    const source = group()
    const navigate = vi.fn()

    expect(await openCollaborationGroup(source, navigate)).toBe(true)
    expect(fixture.switchScope).toHaveBeenCalledWith('bots', 'bot:other-gateway::research', {
      kind: 'route',
      route: owner
    })
    expect(fixture.open).toHaveBeenCalledWith('source-chat', navigate, 'tab', {
      ownerRoute: owner,
      workspaceMode: 'bots',
      workspaceOwnerKey: 'bot:other-gateway::research'
    })
    expect(fixture.hint).toHaveBeenCalledWith('source-chat', owner)
    expect($selectedStoredSessionId.get()).toBe('draft-owner')
  })

  it.each([undefined, null, 'research'])(
    'rejects incomplete owner %s instead of using the foreground gateway',
    async owner => {
      expect(await openCollaborationGroup(group({ owner }), vi.fn())).toBe(false)
      expect(fixture.open).not.toHaveBeenCalled()
      expect(fixture.switchScope).not.toHaveBeenCalled()
    }
  )

  it('returns to an ordinary session with its exact route and clears Bot workspace scope', async () => {
    await openCollaborationGroup(group({ workspaceMode: 'sessions', workspaceOwnerKey: undefined }), vi.fn())

    expect(fixture.publishScope).toHaveBeenCalledWith('sessions')
    expect(fixture.switchScope).not.toHaveBeenCalled()
    expect(fixture.tileScope).toHaveBeenCalledWith('source-chat', { ownerRoute: owner, workspaceMode: 'sessions' })
  })

  it('does not relabel an existing same-id tile that belongs to another connection', async () => {
    $sessionTiles.set([
      { storedSessionId: 'source-chat', ownerRoute: { connectionId: 'foreign-gateway', profile: 'research' } }
    ] as typeof $sessionTiles.value)

    expect(await openCollaborationGroup(group(), vi.fn())).toBe(false)
    expect(fixture.hint).not.toHaveBeenCalled()
    expect(fixture.open).not.toHaveBeenCalled()
    expect(fixture.tileScope).not.toHaveBeenCalled()
  })

  it('opens the exact room authority instead of a hidden member execution chat', async () => {
    const binding = {
      connectionId: 'room-gateway',
      profile: 'room-authority',
      roomId: 'room-17',
      roomName: 'Design crew'
    }

    expect(await openCollaborationGroup(group({ roomBinding: binding }), vi.fn())).toBe(true)
    expect(fixture.registerRoom).toHaveBeenCalledWith(
      { connectionId: 'room-gateway', profile: 'room-authority' },
      { room_id: 'room-17', name: 'Design crew', members: [] }
    )
    expect(fixture.openRoom).toHaveBeenCalledWith('canonical:exact-room', 'key', {
      connectionId: 'room-gateway',
      profile: 'room-authority'
    })
    expect(fixture.open).not.toHaveBeenCalled()
    expect(fixture.hint).not.toHaveBeenCalled()
    expect($selectedStoredSessionId.get()).toBe('draft-owner')
  })

  it('fails closed on room navigation errors and superseded async source jumps', async () => {
    const source = group({ roomBinding: { connectionId: 'source', profile: 'authority', roomId: 'room-17' } })
    fixture.registerRoom.mockImplementationOnce(() => {
      throw new Error('unavailable')
    })
    expect(await openCollaborationGroup(source, vi.fn())).toBe(false)

    const pending = openCollaborationGroup(source, vi.fn())
    await openCollaborationGroup(group(), vi.fn())
    expect(await pending).toBe(false)
    expect(fixture.openRoom).not.toHaveBeenCalled()
  })

  it('rejects room retry preparation without navigating or writing goals into private composers', async () => {
    const source = group({
      owner: { connectionId: 'source', profile: 'another-member' },
      roomBinding: { connectionId: 'room-gateway', profile: 'room-authority', roomId: 'room-17' }
    })

    groups.set([source])

    expect(await prepareCollaborationRetry(task, vi.fn())).toBe(false)
    expect(fixture.openRoom).not.toHaveBeenCalled()
    expect(fixture.insert).not.toHaveBeenCalled()
    expect(fixture.open).not.toHaveBeenCalled()
  })

  it('prepares the original goal in the exact source tile and propagates a rejected insert', async () => {
    groups.set([group()])
    $sessionTiles.set([{ storedSessionId: 'source-chat' }] as typeof $sessionTiles.value)

    expect(await prepareCollaborationRetry(task, vi.fn())).toBe(true)
    expect(fixture.insert).toHaveBeenCalledWith('Check the original files', {
      mode: 'block',
      stillCurrent: expect.any(Function),
      target: 'tile:source-chat'
    })
    fixture.insert.mockResolvedValue(false)
    vi.useFakeTimers()
    const rejected = prepareCollaborationRetry(task, vi.fn())
    await vi.advanceTimersByTimeAsync(2100)
    expect(await rejected).toBe(false)
  })

  it('waits for a cold source composer and inserts once it acknowledges readiness', async () => {
    vi.useFakeTimers()
    groups.set([group()])
    $sessionTiles.set([{ storedSessionId: 'source-chat' }] as typeof $sessionTiles.value)
    fixture.visible = false
    focused.set('previous-chat')
    const pending = prepareCollaborationRetry(task, vi.fn())

    await vi.advanceTimersByTimeAsync(100)
    expect(fixture.insert).not.toHaveBeenCalled()
    focused.set('source-chat')
    fixture.visible = true
    await vi.advanceTimersByTimeAsync(50)

    expect(await pending).toBe(true)
    expect(fixture.insert).toHaveBeenCalledTimes(1)
  })

  it.each(['focus', 'owner', 'pointer'])('cancels a cold retry when the user or source changes: %s', async change => {
    vi.useFakeTimers()
    groups.set([group()])
    $sessionTiles.set([{ storedSessionId: 'source-chat' }] as typeof $sessionTiles.value)
    fixture.visible = false
    const pending = prepareCollaborationRetry(task, vi.fn())

    await vi.advanceTimersByTimeAsync(50)

    if (change === 'focus') {
      focused.set('another-chat')
    }

    if (change === 'owner') {
      groups.set([group({ owner: { connectionId: 'changed', profile: 'research' } })])
    }

    if (change === 'pointer') {
      document.dispatchEvent(new Event('pointerdown'))
    }

    fixture.visible = true
    await vi.advanceTimersByTimeAsync(50)

    expect(await pending).toBe(false)
    expect(fixture.insert).not.toHaveBeenCalled()
  })

  it('never inserts into an unrelated foreground composer when the source is missing or changed owners', async () => {
    groups.set([group({ owner: { connectionId: 'new-gateway', profile: 'research' } })])

    expect(await prepareCollaborationRetry(task, vi.fn())).toBe(false)
    expect(fixture.insert).not.toHaveBeenCalled()
    expect(fixture.open).not.toHaveBeenCalled()
  })
})
