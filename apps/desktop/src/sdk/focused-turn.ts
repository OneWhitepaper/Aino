import { computed, type ReadableAtom } from 'nanostores'

import { PRIMARY_SESSION_VIEW } from '@/app/chat/session-view'
import type { ClientSessionState } from '@/app/types'
import { $selectedStoredSessionId } from '@/store/session'
import { $focusedStoredSessionId } from '@/store/session-focus'
import { $focusedSessionState } from '@/store/session-states'

/**
 * Turn flag for the FOCUSED chat — same semantics as the statusbar's busy
 * pulse. While the focused surface is the primary workspace (or a draft with
 * no runtime slice yet) this reads the primary view, which itself falls back
 * to the global draft atoms. Once a session TILE holds focus, the tile's own
 * state slice is authoritative — a background session can never leak in.
 */
const focusedTurnFlag = (
  select: (state: ClientSessionState) => boolean,
  $primary: ReadableAtom<boolean>
): ReadableAtom<boolean> =>
  computed(
    [$focusedStoredSessionId, $selectedStoredSessionId, $focusedSessionState, $primary],
    (focused, selected, state, primary) =>
      !focused || focused === selected ? primary : Boolean(state && select(state))
  )

export const $focusedBusy = focusedTurnFlag(state => state.busy, PRIMARY_SESSION_VIEW.$busy)

export const $focusedAwaitingResponse = focusedTurnFlag(
  state => state.awaitingResponse,
  PRIMARY_SESSION_VIEW.$awaitingResponse
)
