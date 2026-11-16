import { useStoresSelector } from '@/lib/use-session-slice'
import { $botChatScopes } from '@/store/bot-chat-scope'
import { $sessionTiles } from '@/store/session-states'

/** A companion's canonical chat, not an ordinary side thread opened in Bot mode. */
export function useBotChatPresentation(storedSessionId: string | null | undefined) {
  const scopeForSession = () =>
    storedSessionId
      ? ($botChatScopes.get()[storedSessionId] ??
        $sessionTiles.get().find(tile => tile.storedSessionId === storedSessionId))
      : undefined

  const canonical = useStoresSelector([$botChatScopes, $sessionTiles], () => {
    const scope = scopeForSession()

    // The opener supplies the registry title only for the canonical chat.
    // A recent session has the same owner/mode but deliberately no tab title.
    return Boolean(scope?.workspaceMode === 'bots' && scope.workspaceTabTitle)
  })

  const ownerKey = useStoresSelector([$botChatScopes, $sessionTiles], () => {
    const scope = scopeForSession()

    return scope?.workspaceMode === 'bots' ? scope.workspaceOwnerKey : undefined
  })

  return { canonical, ownerKey }
}
