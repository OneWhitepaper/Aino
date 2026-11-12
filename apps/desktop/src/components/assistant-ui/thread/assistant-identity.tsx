import { useStore } from '@nanostores/react'

import { useSessionView } from '@/app/chat/session-view'
import { WORKSPACE_AVATAR_AREA, type WorkspaceAvatarContribution } from '@/components/pane-shell/workspace-scope'
import { Codicon } from '@/components/ui/codicon'
import { useContributions } from '@/contrib/react/use-contributions'
import { useStoresSelector } from '@/lib/use-session-slice'
import { $botChatScopes, $botChatSessionIds } from '@/store/bot-chat-scope'
import { $activeSessionId, $selectedStoredSessionId } from '@/store/session'
import { $sessionStates, $sessionTiles, storedSessionIdForRuntimeId } from '@/store/session-states'

/** Identity follows this message's conversation, including a background split. */
export function AssistantIdentity() {
  const view = useSessionView()
  const runtimeId = useStore(view.$runtimeId)
  const viewStoredId = useStore(view.$storedId)

  const storedId = useStoresSelector(
    [$sessionStates, $sessionTiles, $activeSessionId, $selectedStoredSessionId],
    () => (runtimeId && storedSessionIdForRuntimeId(runtimeId)) || viewStoredId
  )

  const botSession = useStoresSelector([$botChatSessionIds, $sessionTiles], () =>
    Boolean(
      storedId &&
      ($botChatSessionIds.get().has(storedId) ||
        $sessionTiles.get().some(tile => tile.storedSessionId === storedId && tile.workspaceMode === 'bots'))
    )
  )

  const ownerKey = useStoresSelector([$botChatScopes, $sessionTiles], () =>
    storedId
      ? ($botChatScopes.get()[storedId]?.workspaceOwnerKey ??
        $sessionTiles.get().find(tile => tile.storedSessionId === storedId)?.workspaceOwnerKey)
      : undefined
  )

  const portraits = useContributions(WORKSPACE_AVATAR_AREA)

  if (!storedId) {
    return null
  }

  if (!botSession) {
    return (
      <img
        alt=""
        aria-hidden="true"
        data-slot="aui_assistant-brand"
        src={`${import.meta.env.BASE_URL}apple-touch-icon.png`}
      />
    )
  }

  const portrait =
    ownerKey &&
    portraits
      .map(item => (item.data as WorkspaceAvatarContribution | undefined)?.avatarFor?.(ownerKey, 32))
      .find(Boolean)

  return (
    <span aria-hidden="true" data-slot="aui_assistant-avatar">
      {portrait || <Codicon name="hubot" size="1.5rem" />}
    </span>
  )
}
