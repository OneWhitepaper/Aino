import { paneChrome } from '@/components/pane-shell/tree/renderer/track-model'
import { revealTreePane } from '@/components/pane-shell/tree/store'
import { $workspaceMode, $workspaceOwnerKey, setWorkspaceScope } from '@/components/pane-shell/workspace-scope'
import { registry } from '@/contrib/registry'
import { switchWorkspaceScope } from '@/sdk/workspace-navigation'
import { $botChatScopes } from '@/store/bot-chat-scope'
import {
  $collaborationGroups,
  type CollaborationGroup,
  collaborationOwnerKey,
  type CollaborationTask
} from '@/store/collaboration-capsule'
import { $selectedStoredSessionId, $sessions, idsShareLineage, setSessionOwnerHint } from '@/store/session'
import { $focusedStoredSessionId } from '@/store/session-focus'
import { currentUserSessionOpen } from '@/store/session-open-intent'
import { isSessionOwnerRoute } from '@/store/session-request-router'
import { $sessionTiles, setSessionTileWorkspaceScope } from '@/store/session-states'
import { $toolSession } from '@/store/tool-session'

import { type ComposerTarget, getVisibleComposerSurfaceId, requestComposerInsertAcked } from '../chat/composer/focus'
import { openSession, type OpenSessionNavigate, type OpenSessionWorkspaceScope } from '../open-session'

import { openSubagentPanel, subagentPanelSourceKey } from './subagent-panel'

let sourceNavigation = 0

/** Inspection uses the child receipt's parent and owner, never the foreground's backend. */
export async function openCollaborationTask(task: CollaborationTask): Promise<boolean> {
  const group = $collaborationGroups.get().find(group => group.key === task.sourceKey)

  const current = group?.tasks.find(candidate =>
    candidate.key === task.key &&
    candidate.parentRuntimeId === task.parentRuntimeId &&
    candidate.storedSessionId === task.storedSessionId &&
    collaborationOwnerKey(candidate.owner) === collaborationOwnerKey(task.owner)
  )

  if (!current || !collaborationOwnerKey(current.owner)) {
    return false
  }

  return openSubagentPanel({
    parentRuntimeId: null,
    anchorSourceKey: subagentPanelSourceKey($toolSession.get()),
    inspection: { runtimeId: current.parentRuntimeId, storedId: current.storedSessionId, owner: current.owner },
    taskId: current.id,
    row: delegateRowFromSubagent(current, current.id, current.goal)
  })
}

async function openRoomSource(group: CollaborationGroup, generation: number): Promise<boolean> {
  const binding = group.roomBinding

  if (!binding?.connectionId.trim() || !binding.profile.trim() || !binding.roomId.trim()) {
    return false
  }

  const revision = currentUserSessionOpen()
  const initialMode = $workspaceMode.get()
  const initialOwner = $workspaceOwnerKey.get()
  const initialPath = window.location.hash

  try {
    const [{ registerCanonicalGroup }, { openGroupChat }] = await Promise.all([
      import('@/plugins/hermes-bots/canonical-group-registry'),
      import('@/plugins/hermes-bots/group-chat-view')
    ])

    if (
      generation !== sourceNavigation ||
      currentUserSessionOpen() !== revision ||
      initialPath !== window.location.hash ||
      initialMode !== $workspaceMode.get() ||
      initialOwner !== $workspaceOwnerKey.get()
    ) {
      return false
    }

    const route = { connectionId: binding.connectionId, profile: binding.profile }

    const key = registerCanonicalGroup(route, {
      room_id: binding.roomId,
      name: binding.roomName || group.title,
      members: []
    })

    openGroupChat(key, 'key', route)
    const navigation = registry.getArea('panes').find(pane => paneChrome(pane).sidebarMode === 'bots')

    if (navigation) {
      revealTreePane(navigation.id)
    }

    return true
  } catch {
    return false
  }
}

/** A task's source is captured by delegation, never reconstructed from the foreground. */
export async function openCollaborationGroup(
  group: CollaborationGroup,
  navigate: OpenSessionNavigate
): Promise<boolean> {
  const generation = ++sourceNavigation

  if (group.roomBinding) {
    return openRoomSource(group, generation)
  }

  if (
    !group.storedSessionId ||
    !isSessionOwnerRoute(group.owner) ||
    !group.owner.connectionId.trim() ||
    !group.owner.profile.trim() ||
    (group.workspaceMode === 'bots' && !group.workspaceOwnerKey)
  ) {
    return false
  }

  const ownerRoute = { ...group.owner }

  const matchingTile = $sessionTiles
    .get()
    .find(tile => idsShareLineage(tile.storedSessionId, group.storedSessionId!, $sessions.get()))

  const existingOwner = matchingTile?.ownerRoute ?? matchingTile?.ownerProfile

  if (existingOwner && collaborationOwnerKey(existingOwner) !== collaborationOwnerKey(ownerRoute)) {
    return false
  }

  const previousScope = matchingTile ?? $botChatScopes.get()[group.storedSessionId]

  const workspaceTabTitle =
    previousScope?.workspaceOwnerKey === group.workspaceOwnerKey &&
    collaborationOwnerKey(previousScope?.ownerRoute) === collaborationOwnerKey(ownerRoute)
      ? previousScope?.workspaceTabTitle
      : undefined

  const scope: OpenSessionWorkspaceScope = {
    ownerRoute,
    workspaceMode: group.workspaceMode,
    ...(group.workspaceOwnerKey ? { workspaceOwnerKey: group.workspaceOwnerKey } : {}),
    ...(workspaceTabTitle ? { workspaceTabTitle } : {})
  }

  setSessionOwnerHint(group.storedSessionId, ownerRoute)

  if (group.workspaceMode === 'bots') {
    switchWorkspaceScope('bots', group.workspaceOwnerKey, { kind: 'route', route: ownerRoute })
  } else {
    // This explicit open owns focus. The ordinary mode-switch action schedules
    // a remembered-pane restore, which would undo the source selected below.
    setWorkspaceScope('sessions')
  }

  // Tab intent keeps an unsent primary draft and any other bot's chat intact.
  openSession(group.storedSessionId, navigate, 'tab', scope)
  // Ordinary cold opens create a tile after openSession's initial scope write.
  setSessionTileWorkspaceScope(group.storedSessionId, scope)

  const navigation = registry.getArea('panes').find(pane => paneChrome(pane).sidebarMode === group.workspaceMode)

  if (navigation) {
    revealTreePane(navigation.id)
  }

  return true
}

function retryComposerTarget(group: CollaborationGroup): ComposerTarget | null {
  const storedId = group.storedSessionId

  if (!storedId) {
    return null
  }

  const sessions = $sessions.get()
  const tile = $sessionTiles.get().find(candidate => idsShareLineage(candidate.storedSessionId, storedId, sessions))

  if (tile) {
    return `tile:${tile.storedSessionId}`
  }

  const selected = $selectedStoredSessionId.get()

  return selected && idsShareLineage(selected, storedId, sessions) ? 'main' : null
}

/** Restore the original goal for review; a retry never sends a second turn by itself. */
export async function prepareCollaborationRetry(
  task: CollaborationTask,
  navigate: OpenSessionNavigate
): Promise<boolean> {
  const group = $collaborationGroups
    .get()
    .find(
      candidate =>
        candidate.key === task.sourceKey &&
        (candidate.roomBinding || collaborationOwnerKey(candidate.owner) === collaborationOwnerKey(task.owner)) &&
        candidate.tasks.some(
          candidateTask =>
            candidateTask.key === task.key &&
            collaborationOwnerKey(candidateTask.owner) === collaborationOwnerKey(task.owner)
        )
    )

  if (!task.goal.trim() || !group || group.roomBinding) {
    return false
  }

  // Group composers use a distinct mention/draft protocol. Until they expose
  // an acknowledged targeted insert, retry preparation belongs to direct chats.
  if (!(await openCollaborationGroup(group, navigate))) {
    return false
  }

  const target = retryComposerTarget(group)

  if (!target) {
    return false
  }

  const revision = currentUserSessionOpen()
  const deadline = Date.now() + 2000
  const initialFocus = $focusedStoredSessionId.get()
  let cancelled = false
  let sourceFocused = false

  const cancel = () => {
    cancelled = true
  }

  const ownsFocus = () => {
    const focused = $focusedStoredSessionId.get()

    return Boolean(focused && idsShareLineage(focused, group.storedSessionId!, $sessions.get()))
  }

  const stillOwned = () => {
    const current = $collaborationGroups.get().find(source => source.key === group.key)
    const tile = $sessionTiles.get().find(tile => `tile:${tile.storedSessionId}` === target)
    const tileOwner = tile?.ownerRoute ?? tile?.ownerProfile

    return (
      !cancelled &&
      currentUserSessionOpen() === revision &&
      collaborationOwnerKey(current?.owner) === collaborationOwnerKey(group.owner) &&
      (!tileOwner || collaborationOwnerKey(tileOwner) === collaborationOwnerKey(group.owner))
    )
  }

  document.addEventListener('pointerdown', cancel, true)
  document.addEventListener('keydown', cancel, true)

  try {
    while (Date.now() < deadline && stillOwned()) {
      const focused = ownsFocus()
      const currentFocus = $focusedStoredSessionId.get()

      if (!focused && (sourceFocused || (currentFocus && currentFocus !== initialFocus))) {
        return false
      }

      sourceFocused ||= focused

      if (focused && getVisibleComposerSurfaceId(target)) {
        const inserted = await requestComposerInsertAcked(task.goal, {
          mode: 'block',
          stillCurrent: () => stillOwned() && ownsFocus() && Boolean(getVisibleComposerSurfaceId(target)),
          target
        })

        if (inserted) {
          return true
        }
      }

      await new Promise(resolve => window.setTimeout(resolve, 50))
    }

    return false
  } finally {
    document.removeEventListener('pointerdown', cancel, true)
    document.removeEventListener('keydown', cancel, true)
  }
}

import { delegateRowFromSubagent } from '@/components/assistant-ui/tool/delegate-model'
