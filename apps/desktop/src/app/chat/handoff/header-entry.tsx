import { useStore } from '@nanostores/react'

import { useStoresSelector } from '@/lib/use-session-slice'
import { $activeSessionId, $selectedStoredSessionId } from '@/store/session'
import { $sessionStates, $sessionTiles } from '@/store/session-states'

import { useBotChatPresentation } from '../use-bot-chat-presentation'

import { HandoffEntry } from './entry'

/** The layout tree places the primary session's menu in the real desktop titlebar. */
export function WorkspaceHandoffEntry() {
  const storedId = useStore($selectedStoredSessionId)
  const runtimeId = useStore($activeSessionId)
  const { canonical } = useBotChatPresentation(storedId)

  return <HandoffEntry enabled={!canonical} runtimeSessionId={runtimeId} storedSessionId={storedId} />
}

export function TileHandoffEntry({ storedId }: { storedId: string }) {
  const runtimeId = useStoresSelector([$sessionTiles, $sessionStates], () => {
    const id = $sessionTiles.get().find(tile => tile.storedSessionId === storedId)?.runtimeId

    return id && $sessionStates.get()[id]?.storedSessionId === storedId ? id : null
  })

  const { canonical } = useBotChatPresentation(storedId)

  return <HandoffEntry enabled={!canonical} runtimeSessionId={runtimeId} storedSessionId={storedId} surface="tile" />
}
