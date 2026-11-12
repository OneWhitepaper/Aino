import { describe, expect, it } from 'vitest'

import { collaborationGroupsFor, collaborationOwnerKey, type CollaborationSource } from './collaboration-capsule-model'
import type { SubagentProgress } from './subagents'

const task = (overrides: Partial<SubagentProgress> = {}): SubagentProgress => ({
  id: 'internal-worker-id',
  parentId: null,
  goal: '检查模型配置',
  status: 'running',
  taskCount: 1,
  taskIndex: 0,
  startedAt: 10,
  updatedAt: 20,
  filesRead: [],
  filesWritten: [],
  stream: [],
  ...overrides
})

const source = (overrides: Partial<CollaborationSource> = {}): CollaborationSource => ({
  parentRuntimeId: 'runtime',
  storedSessionId: 'conversation',
  owner: { connectionId: 'source-a', profile: 'default' },
  title: '项目方案',
  workspaceMode: 'sessions',
  ...overrides
})

describe('collaboration source identity', () => {
  it("groups the same room across members while preserving each child's exact control owner", () => {
    const roomBinding = {
      connectionId: 'source-a',
      profile: 'room-authority',
      roomId: 'release-room',
      roomName: '发布小组'
    }

    const writer = { ...source({ owner: { connectionId: 'source-a', profile: 'writer' } }), roomBinding }

    const researcher = {
      ...source({
        parentRuntimeId: 'research-runtime',
        storedSessionId: 'member-chat-2',
        owner: { connectionId: 'source-a', profile: 'researcher' }
      }),
      roomBinding
    }

    const groups = collaborationGroupsFor(
      [writer, researcher],
      { runtime: [task()], 'research-runtime': [task()] },
      '协作任务'
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ title: '发布小组', workspaceMode: 'bots', roomBinding })
    expect(groups[0]!.tasks).toHaveLength(2)
    expect(groups[0]!.tasks[0]!.key).not.toBe(groups[0]!.tasks[1]!.key)
    expect(groups[0]!.tasks.map(item => item.owner)).toEqual([writer.owner, researcher.owner])
    expect(groups[0]!.tasks.map(item => item.parentRuntimeId)).toEqual(['runtime', 'research-runtime'])
    expect(groups[0]!.storedSessionId).toBeNull()
    expect(groups[0]!.owner).toEqual({ connectionId: 'source-a', profile: 'room-authority' })
  })

  it('keeps rooms with the same identifier isolated across authority profiles and connections', () => {
    const roomBinding = {
      connectionId: 'source-a',
      profile: 'room-authority',
      roomId: 'release-room',
      roomName: '发布小组'
    }

    const sources = [
      { ...source(), roomBinding },
      {
        ...source({ parentRuntimeId: 'other-runtime', owner: { connectionId: 'source-b', profile: 'default' } }),
        roomBinding: { ...roomBinding, connectionId: 'source-b' }
      },
      {
        ...source({ parentRuntimeId: 'other-authority' }),
        roomBinding: { ...roomBinding, profile: 'other-room-authority' }
      }
    ]

    const groups = collaborationGroupsFor(
      sources,
      { runtime: [task()], 'other-runtime': [task()], 'other-authority': [task()] },
      '协作任务'
    )

    expect(groups).toHaveLength(3)
    expect(new Set(groups.map(group => group.key)).size).toBe(3)
  })

  it('treats an omitted default target as the same owner but preserves a distinct routed target', () => {
    const owner = { connectionId: 'source', profile: 'writer' }
    expect(collaborationOwnerKey(owner)).toBe(collaborationOwnerKey({ ...owner, targetProfile: 'writer' }))
    expect(collaborationOwnerKey(owner)).not.toBe(collaborationOwnerKey({ ...owner, targetProfile: 'research' }))
  })

  it('keeps identical conversation and worker ids on separate connections isolated', () => {
    const groups = collaborationGroupsFor(
      [
        source(),
        source({ parentRuntimeId: 'remote-runtime', owner: { connectionId: 'source-b', profile: 'default' } })
      ],
      { runtime: [task()], 'remote-runtime': [task({ status: 'failed' })] },
      '协作任务'
    )

    expect(groups).toHaveLength(2)
    expect(groups[0]?.key).not.toBe(groups[1]?.key)
    expect(groups[0]?.tasks[0]?.key).not.toBe(groups[1]?.tasks[0]?.key)
    expect(groups.map(group => group.tasks[0]?.status)).toEqual(['running', 'failed'])
  })

  it('merges reconnect aliases only for the same owner and uses the newest child facts', () => {
    const groups = collaborationGroupsFor(
      [source(), source({ parentRuntimeId: 'reconnected' })],
      {
        runtime: [task()],
        reconnected: [task({ status: 'interrupted', updatedAt: 30, summary: '用户已停止' })]
      },
      '协作任务'
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]?.runtimeIds).toEqual(['runtime', 'reconnected'])
    expect(groups[0]?.tasks).toHaveLength(1)
    expect(groups[0]?.tasks[0]).toMatchObject({
      parentRuntimeId: 'reconnected',
      status: 'interrupted',
      summary: '用户已停止'
    })
  })

  it('never exposes an internal worker id as its name or enables controls for unknown ownership', () => {
    const groups = collaborationGroupsFor(
      [source({ owner: undefined }), source({ parentRuntimeId: 'other', owner: undefined })],
      { runtime: [task()], other: [task({ goal: '' })] },
      '协作任务'
    )

    expect(groups).toHaveLength(2)
    expect(groups[0]?.tasks[0]).toMatchObject({ displayName: '检查模型配置', canControl: false })
    expect(groups[1]?.tasks[0]).toMatchObject({ displayName: '协作任务', canControl: false })
    expect(groups[0]?.tasks[0]?.displayName).not.toBe('internal-worker-id')
  })

  it('uses a real reported label and keeps roster-only discovery read-only', () => {
    const named = { ...task(), displayName: '代码审查' }

    const groups = collaborationGroupsFor(
      [source({ parentRuntimeId: '', canControl: false, taskSnapshot: [named] })],
      {},
      '协作任务'
    )

    expect(groups[0]?.runtimeIds).toEqual([])
    expect(groups[0]?.tasks[0]).toMatchObject({ displayName: '代码审查', parentRuntimeId: '', canControl: false })
  })
})
