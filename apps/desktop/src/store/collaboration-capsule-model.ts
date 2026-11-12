import type { WorkspaceMode } from '@/contrib/types'
import { subagentDisplayName } from '@/lib/subagent-identity'

import type { SessionOwnerScope } from './session-request-router'
import type { SubagentProgress } from './subagents'

export interface CollaborationRoomBinding {
  connectionId: string
  /** The profile which owns the room, not a member's execution profile. */
  profile: string
  roomId: string
  roomName?: string
}

export interface CollaborationSource {
  parentRuntimeId: string
  storedSessionId: string | null
  owner: SessionOwnerScope
  title: string
  workspaceMode: WorkspaceMode
  workspaceOwnerKey?: string
  roomBinding?: CollaborationRoomBinding
  /** A roster can discover work without owning an attached runtime. */
  canControl?: boolean
  taskSnapshot?: readonly SubagentProgress[]
}

export interface CollaborationTask extends SubagentProgress {
  key: string
  parentRuntimeId: string
  storedSessionId: string | null
  owner: SessionOwnerScope
  sourceKey: string
  displayName: string
  canControl: boolean
}

export interface CollaborationGroup {
  key: string
  title: string
  workspaceMode: WorkspaceMode
  workspaceOwnerKey?: string
  roomBinding?: CollaborationRoomBinding
  owner: SessionOwnerScope
  storedSessionId: string | null
  runtimeIds: string[]
  tasks: CollaborationTask[]
}

/** Profile names alone are not identities when two connections serve them. */
export function collaborationOwnerKey(owner: SessionOwnerScope): string | null {
  if (typeof owner === 'string') {
    return owner.trim() ? JSON.stringify(['profile', owner.trim()]) : null
  }

  return owner?.connectionId.trim()
    ? JSON.stringify([
        'connection',
        owner.connectionId.trim(),
        owner.profile.trim() || 'default',
        owner.targetProfile?.trim() || owner.profile.trim() || 'default'
      ])
    : null
}

function projectTask(
  item: SubagentProgress,
  source: CollaborationSource,
  sourceKey: string,
  fallbackTaskName: string
): CollaborationTask {
  return {
    ...item,
    key: JSON.stringify([
      sourceKey,
      collaborationOwnerKey(source.owner),
      source.storedSessionId ?? source.parentRuntimeId,
      item.id
    ]),
    parentRuntimeId: source.parentRuntimeId,
    storedSessionId: source.storedSessionId,
    owner: typeof source.owner === 'object' && source.owner ? { ...source.owner } : source.owner,
    sourceKey,
    displayName: subagentDisplayName(item, fallbackTaskName),
    canControl: Boolean(collaborationOwnerKey(source.owner) && source.parentRuntimeId && source.canControl !== false)
  }
}

export function collaborationRoomKey(room: CollaborationRoomBinding | undefined): string | null {
  return room?.connectionId.trim() && room.profile.trim() && room.roomId.trim()
    ? JSON.stringify(['room', room.connectionId.trim(), room.profile.trim(), room.roomId.trim()])
    : null
}

function sourceGroupKey(source: CollaborationSource): string {
  const ownerKey = collaborationOwnerKey(source.owner)

  // Unknown ownership never collapses two runtime ids into one actionable source.
  return (
    collaborationRoomKey(source.roomBinding) ??
    JSON.stringify([ownerKey, source.storedSessionId ?? source.parentRuntimeId, ownerKey ? '' : source.parentRuntimeId])
  )
}

function createGroup(source: CollaborationSource, key: string): CollaborationGroup {
  const room = source.roomBinding

  return {
    key,
    title: room?.roomName?.trim() || source.title,
    workspaceMode: room ? 'bots' : source.workspaceMode,
    workspaceOwnerKey: room ? undefined : source.workspaceOwnerKey,
    roomBinding: room ? { ...room } : undefined,
    owner: room
      ? { connectionId: room.connectionId, profile: room.profile }
      : typeof source.owner === 'object' && source.owner
        ? { ...source.owner }
        : source.owner,
    storedSessionId: room ? null : source.storedSessionId,
    runtimeIds: [],
    tasks: []
  }
}

/** Combine reconnect aliases only after both durable identity and owner agree. */
export function collaborationGroupsFor(
  sources: readonly CollaborationSource[],
  tasksByRuntime: Readonly<Record<string, readonly SubagentProgress[]>>,
  fallbackTaskName: string
): CollaborationGroup[] {
  const groups = new Map<string, CollaborationGroup>()

  for (const source of sources) {
    const items = source.taskSnapshot ?? tasksByRuntime[source.parentRuntimeId]

    if (!items?.length) {
      continue
    }

    const key = sourceGroupKey(source)

    let group = groups.get(key)

    if (!group) {
      group = createGroup(source, key)
      groups.set(key, group)
    }

    if (source.parentRuntimeId && !group.runtimeIds.includes(source.parentRuntimeId)) {
      group.runtimeIds.push(source.parentRuntimeId)
    }

    for (const item of items) {
      const task = projectTask(item, source, key, fallbackTaskName)
      const index = group.tasks.findIndex(previous => previous.key === task.key)

      if (index < 0) {
        group.tasks.push(task)
      } else if (
        group.tasks[index]!.updatedAt < task.updatedAt &&
        !(isTerminal(group.tasks[index]!) && !isTerminal(task))
      ) {
        group.tasks[index] = task
      }
    }
  }

  for (const group of groups.values()) {
    group.tasks.sort((left, right) => left.startedAt - right.startedAt || left.taskIndex - right.taskIndex)
  }

  return [...groups.values()]
}

function isTerminal(task: SubagentProgress): boolean {
  return task.status !== 'running' && task.status !== 'queued'
}
