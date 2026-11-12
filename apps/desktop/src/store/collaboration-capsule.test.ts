import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createClientSessionState } from '@/lib/chat-runtime'
import type { SessionInfo } from '@/types/hermes'

import { $botChatScopes } from './bot-chat-scope'
import {
  $collaborationGroups,
  collaborationGroupsFor,
  CollaborationTaskActionError,
  interruptCollaborationTask,
  steerCollaborationTask
} from './collaboration-capsule'
import { $liveWorkRoster, setLiveWorkRosterSource } from './live-work-roster'
import {
  $activeSessionId,
  $cronSessions,
  $messagingSessions,
  $selectedStoredSessionId,
  $sessions,
  $unlistedSessionOwnerRows
} from './session'
import * as router from './session-request-router'
import { $sessionStates, $sessionTiles } from './session-states'
import { $subagentsBySession, upsertSubagent } from './subagents'

beforeEach(() => {
  vi.restoreAllMocks()
  $subagentsBySession.set({})
  $sessionStates.set({})
  $sessionTiles.set([])
  $sessions.set([])
  $cronSessions.set([])
  $messagingSessions.set([])
  $unlistedSessionOwnerRows.set([])
  $botChatScopes.set({})
  $liveWorkRoster.set({})
  $activeSessionId.set(null)
  $selectedStoredSessionId.set(null)
})

function installBackgroundBot() {
  const owner = { connectionId: 'bot-source', profile: 'research' }
  $sessionStates.set({ 'bot-runtime': createClientSessionState('bot-chat') })
  $sessions.set([
    { id: 'bot-chat', title: 'Bot Chat', connection_id: 'bot-source', profile: 'research' } as SessionInfo
  ])
  $botChatScopes.set({
    'bot-chat': {
      ownerRoute: owner,
      workspaceMode: 'bots',
      workspaceOwnerKey: 'bot:research',
      workspaceTabTitle: '研究助手'
    }
  })
  upsertSubagent(
    'bot-runtime',
    { subagent_id: 'worker', goal: '审查模型配置', status: 'running' },
    true,
    'subagent.start'
  )

  return owner
}

describe('collaboration capsule facts and commands', () => {
  it('labels a background Bot main chat from its own remembered scope and reacts to its new name', () => {
    installBackgroundBot()
    $activeSessionId.set('unrelated-foreground')
    $selectedStoredSessionId.set('unrelated-conversation')

    expect($collaborationGroups.get()[0]).toMatchObject({
      title: '研究助手',
      workspaceMode: 'bots',
      storedSessionId: 'bot-chat'
    })
    const scope = $botChatScopes.get()['bot-chat']!
    $botChatScopes.set({ 'bot-chat': { ...scope, workspaceTabTitle: '架构研究员' } })

    expect($collaborationGroups.get()[0]?.title).toBe('架构研究员')
  })

  it('does not republish the capsule when an unrelated conversation streams a token', () => {
    installBackgroundBot()
    const before = $collaborationGroups.get()
    const changes: unknown[] = []
    const stop = $collaborationGroups.listen(value => changes.push(value))

    try {
      $sessionStates.set({ ...$sessionStates.get(), 'unrelated-runtime': createClientSessionState('other-chat') })
      expect($collaborationGroups.get()).toBe(before)
      expect(changes).toEqual([])
    } finally {
      stop()
    }
  })

  it('uses the original conversation preview until its title is generated', () => {
    const owner = { connectionId: 'local', profile: 'default' }
    $sessionTiles.set([{ storedSessionId: 'new-chat', runtimeId: 'new-runtime', ownerRoute: owner }])
    $sessions.set([
      { id: 'new-chat', title: null, preview: 'E2E_SIDEBAR_TRIGGER', connection_id: 'local' } as SessionInfo
    ])
    upsertSubagent(
      'new-runtime',
      { subagent_id: 'worker', goal: '分析资料', status: 'running' },
      true,
      'subagent.start'
    )

    expect($collaborationGroups.get()[0]).toMatchObject({ title: 'E2E_SIDEBAR_TRIGGER', owner })
  })

  it("accepts a session row stamped with the captured owner's backend target profile", () => {
    const owner = { connectionId: 'server', profile: 'desktop-alias', targetProfile: 'backend-profile' }
    $sessionTiles.set([{ storedSessionId: 'alias-chat', runtimeId: 'alias-runtime', ownerRoute: owner }])
    $sessions.set([
      { id: 'alias-chat', title: '目标资料研究', profile: 'backend-profile', connection_id: 'server' } as SessionInfo
    ])
    upsertSubagent(
      'alias-runtime',
      { subagent_id: 'worker', goal: '分析资料', status: 'running' },
      true,
      'subagent.start'
    )

    expect($collaborationGroups.get()[0]).toMatchObject({ title: '目标资料研究', owner })
  })

  it('sends stop to the captured owner after foreground ownership changes without manufacturing completion', async () => {
    const owner = installBackgroundBot()
    const [task] = $collaborationGroups.get()[0]!.tasks
    const request = vi.spyOn(router, 'requestForSessionProfile').mockResolvedValue({ found: true })
    $activeSessionId.set('new-foreground')
    $selectedStoredSessionId.set('other-stored')
    $sessions.set([{ id: 'other-stored', profile: 'default', connection_id: 'other-source' } as SessionInfo])

    await interruptCollaborationTask(task!)

    expect(request).toHaveBeenCalledWith(owner, expect.any(Function), 'subagent.interrupt', {
      session_id: 'bot-runtime',
      subagent_id: 'worker'
    })
    expect($subagentsBySession.get()['bot-runtime']?.[0]?.status).toBe('running')
  })

  it('rejects an unowned or roster-only control before it can reach the ambient source', async () => {
    installBackgroundBot()
    const task = $collaborationGroups.get()[0]!.tasks[0]!
    const request = vi.spyOn(router, 'requestForSessionProfile')

    await expect(interruptCollaborationTask({ ...task, owner: undefined })).rejects.toMatchObject({
      code: 'owner-unavailable'
    })
    await expect(interruptCollaborationTask({ ...task, canControl: false })).rejects.toMatchObject({
      code: 'owner-unavailable'
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('surfaces a rejected or missing child without changing its status', async () => {
    installBackgroundBot()
    const task = $collaborationGroups.get()[0]!.tasks[0]!
    const request = vi.spyOn(router, 'requestForSessionProfile').mockResolvedValue({ found: false })

    await expect(interruptCollaborationTask(task)).rejects.toBeInstanceOf(CollaborationTaskActionError)
    request.mockRejectedValue(new Error('connection closed'))
    await expect(interruptCollaborationTask(task)).rejects.toMatchObject({ code: 'request-failed' })
    expect($subagentsBySession.get()['bot-runtime']?.[0]?.status).toBe('running')
  })

  it('never submits stop for a completed or interrupted task', async () => {
    installBackgroundBot()
    const task = $collaborationGroups.get()[0]!.tasks[0]!
    const request = vi.spyOn(router, 'requestForSessionProfile')

    const [group] = collaborationGroupsFor(
      [
        {
          parentRuntimeId: task.parentRuntimeId,
          storedSessionId: task.storedSessionId,
          owner: task.owner,
          title: '任务',
          workspaceMode: 'bots'
        }
      ],
      { [task.parentRuntimeId]: [{ ...task, status: 'interrupted' }] },
      '协作任务'
    )

    await expect(interruptCollaborationTask(group!.tasks[0]!)).rejects.toMatchObject({ code: 'not-running' })
    expect(request).not.toHaveBeenCalled()
    expect(group!.tasks[0]!.status).toBe('interrupted')
  })

  it('steers only the captured owner and accepts only an explicit queued receipt', async () => {
    const owner = installBackgroundBot()
    const task = $collaborationGroups.get()[0]!.tasks[0]!
    const request = vi.spyOn(router, 'requestForSessionProfile').mockResolvedValue({ status: 'queued' })
    $activeSessionId.set('other-runtime')

    await steerCollaborationTask(task, '  请先检查权限  ')

    expect(request).toHaveBeenCalledWith(owner, expect.any(Function), 'subagent.steer', {
      session_id: 'bot-runtime',
      subagent_id: 'worker',
      text: '请先检查权限'
    })
    expect($subagentsBySession.get()['bot-runtime']?.[0]?.status).toBe('running')
    request.mockResolvedValue({ status: 'unavailable' })
    await expect(steerCollaborationTask(task, '继续')).rejects.toMatchObject({ code: 'request-failed' })
    request.mockClear()
    await expect(steerCollaborationTask(task, '  ')).rejects.toMatchObject({ code: 'request-failed' })
    await expect(steerCollaborationTask({ ...task, owner: undefined }, '继续')).rejects.toMatchObject({
      code: 'owner-unavailable'
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('discovers a genuine offscreen child without inventing a runtime or a control capability', () => {
    const owner = { connectionId: 'remote-source', profile: 'default' }
    $sessions.set([
      { id: 'offscreen', title: '后台研究', connection_id: 'remote-source', profile: 'default' } as SessionInfo
    ])
    setLiveWorkRosterSource(
      'remote-route',
      [
        {
          session_id: 'offscreen',
          subagents: 1,
          workers: [
            { subagent_id: 'remote-worker', goal: '阅读报告', status: 'running', child_session_id: 'child-stored' }
          ]
        }
      ],
      500,
      ['offscreen'],
      owner
    )

    const [group] = $collaborationGroups.get()
    expect(group).toMatchObject({ title: '后台研究', storedSessionId: 'offscreen', owner, runtimeIds: [] })
    expect(group!.tasks[0]).toMatchObject({
      displayName: '阅读报告',
      sessionId: 'child-stored',
      parentRuntimeId: '',
      canControl: false
    })
    expect($activeSessionId.get()).toBeNull()
  })

  it('restores a hidden Bot source after reload from its exact canonical roster scope', () => {
    const owner = { connectionId: 'bot-server', profile: 'research-alias', targetProfile: 'research' }

    const scope = {
      ownerRoute: owner,
      workspaceMode: 'bots' as const,
      workspaceOwnerKey: 'bot:bot-server::research-alias',
      workspaceTabTitle: '研究助手'
    }

    const bucket = {
      at: 500,
      owner,
      covers: new Set(['hidden-bot-chat']),
      sessions: { 'hidden-bot-chat': { background: 0, subagents: 1 } },
      workersBySession: {
        'hidden-bot-chat': [
          {
            id: 'research-worker',
            parentId: null,
            goal: '检查资料',
            status: 'running' as const,
            taskCount: 1,
            taskIndex: 0,
            startedAt: 400,
            updatedAt: 500,
            filesRead: [],
            filesWritten: [],
            stream: []
          }
        ]
      },
      sourceScopesBySession: { 'hidden-bot-chat': scope }
    }

    $liveWorkRoster.set({ botRoute: bucket })

    const [group] = $collaborationGroups.get()
    expect($botChatScopes.get()).toEqual({})
    expect($sessions.get()).toEqual([])
    expect(group).toMatchObject({
      title: '研究助手',
      workspaceMode: 'bots',
      workspaceOwnerKey: scope.workspaceOwnerKey,
      storedSessionId: 'hidden-bot-chat',
      owner,
      runtimeIds: []
    })
    expect(group!.tasks[0]!.canControl).toBe(false)
    expect($activeSessionId.get()).toBeNull()

    // Attaching the runtime does not downgrade the canonical Bot source into Sessions.
    $sessionTiles.set([{ storedSessionId: 'hidden-bot-chat', runtimeId: 'restored-runtime', ownerRoute: owner }])
    upsertSubagent(
      'restored-runtime',
      { subagent_id: 'research-worker', goal: '检查资料', status: 'running' },
      true,
      'subagent.start'
    )

    expect($collaborationGroups.get()).toHaveLength(1)
    expect($collaborationGroups.get()[0]).toMatchObject({
      title: '研究助手',
      workspaceMode: 'bots',
      workspaceOwnerKey: scope.workspaceOwnerKey
    })
    expect($collaborationGroups.get()[0]!.tasks[0]!.canControl).toBe(true)
  })

  it("never borrows another connection's canonical Bot metadata for the same stored id", () => {
    const owner = { connectionId: 'source-a', profile: 'default' }
    const foreignOwner = { connectionId: 'source-b', profile: 'default' }

    const bucket = {
      at: 500,
      owner,
      covers: new Set(['same-stored-id']),
      sessions: { 'same-stored-id': { background: 0, subagents: 1 } },
      workersBySession: {
        'same-stored-id': [
          {
            id: 'worker',
            parentId: null,
            goal: '检查资料',
            status: 'running' as const,
            taskCount: 1,
            taskIndex: 0,
            startedAt: 400,
            updatedAt: 500,
            filesRead: [],
            filesWritten: [],
            stream: []
          }
        ]
      },
      sourceScopesBySession: {
        'same-stored-id': {
          ownerRoute: foreignOwner,
          workspaceMode: 'bots' as const,
          workspaceOwnerKey: 'bot:source-b::default',
          workspaceTabTitle: '其他来源机器人'
        }
      }
    }

    $liveWorkRoster.set({ sourceA: bucket })

    expect($collaborationGroups.get()[0]).toMatchObject({
      owner,
      workspaceMode: 'sessions',
      workspaceOwnerKey: undefined
    })
    expect($collaborationGroups.get()[0]!.title).not.toBe('其他来源机器人')
  })

  it('returns group work to its real room while stopping the exact member-owned child', async () => {
    const writer = { connectionId: 'room-server', profile: 'writer' }
    const researcher = { connectionId: 'room-server', profile: 'researcher' }
    $sessionTiles.set([
      { storedSessionId: 'writer-private', runtimeId: 'writer-runtime', ownerRoute: writer },
      { storedSessionId: 'research-private', runtimeId: 'research-runtime', ownerRoute: researcher }
    ])
    upsertSubagent(
      'writer-runtime',
      { subagent_id: 'worker', goal: '写报告', status: 'running' },
      true,
      'subagent.start'
    )
    upsertSubagent(
      'research-runtime',
      { subagent_id: 'worker', goal: '找资料', status: 'running' },
      true,
      'subagent.start'
    )

    const source = {
      kind: 'bot_room' as const,
      room_id: 'shared-room',
      room_name: '发布小组',
      profile: 'room-authority'
    }

    const bucket = (owner: typeof writer, storedId: string) => ({
      at: Date.now() - 10,
      owner,
      covers: new Set([storedId]),
      sessions: { [storedId]: { background: 0, subagents: 1 } },
      sourcesBySession: { [storedId]: source }
    })

    $liveWorkRoster.set({
      writer: bucket(writer, 'writer-private'),
      researcher: bucket(researcher, 'research-private')
    })

    const groups = $collaborationGroups.get()
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      title: '发布小组',
      storedSessionId: null,
      workspaceMode: 'bots',
      roomBinding: {
        connectionId: 'room-server',
        profile: 'room-authority',
        roomId: 'shared-room',
        roomName: '发布小组'
      }
    })
    expect(groups[0]!.tasks).toHaveLength(2)
    const task = groups[0]!.tasks.find(item => item.parentRuntimeId === 'research-runtime')!
    const request = vi.spyOn(router, 'requestForSessionProfile').mockResolvedValue({ found: true })

    await interruptCollaborationTask(task)

    expect(request).toHaveBeenCalledWith(researcher, expect.any(Function), 'subagent.interrupt', {
      session_id: 'research-runtime',
      subagent_id: 'worker'
    })
    expect($subagentsBySession.get()['research-runtime']![0]!.status).toBe('running')
  })

  it('lets a newer event beat an earlier roster read and preserves interruption over later snapshots', () => {
    const owner = installBackgroundBot()
    upsertSubagent(
      'bot-runtime',
      { subagent_id: 'worker', status: 'interrupted', summary: '已停止' },
      false,
      'subagent.complete'
    )
    const at = $subagentsBySession.get()['bot-runtime']![0]!.updatedAt

    const snapshot = [
      {
        session_id: 'bot-chat',
        subagents: 1,
        workers: [{ subagent_id: 'worker', goal: '审查模型配置', status: 'running' }]
      }
    ]

    setLiveWorkRosterSource('bot-route', snapshot, at - 10, ['bot-chat'], owner)
    expect($collaborationGroups.get()[0]!.tasks[0]!.status).toBe('interrupted')
    setLiveWorkRosterSource('bot-route', snapshot, at + 10, ['bot-chat'], owner)
    expect($collaborationGroups.get()[0]!.tasks).toHaveLength(1)
    expect($collaborationGroups.get()[0]!.tasks[0]!.status).toBe('interrupted')
  })

  it('clears an old live indicator only when a newer read of its own source proves it idle', () => {
    const owner = installBackgroundBot()
    const at = $subagentsBySession.get()['bot-runtime']![0]!.updatedAt
    setLiveWorkRosterSource('other-source', [], at + 20, ['bot-chat'], {
      connectionId: 'different',
      profile: 'research'
    })
    expect($collaborationGroups.get()[0]!.tasks[0]!.status).toBe('running')
    setLiveWorkRosterSource('bot-route', [], at - 20, ['bot-chat'], owner)
    expect($collaborationGroups.get()[0]!.tasks[0]!.status).toBe('running')
    setLiveWorkRosterSource('bot-route', [], at + 20, ['bot-chat'], owner)
    expect($collaborationGroups.get()).toEqual([])
  })
})
