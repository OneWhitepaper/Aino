import { useEffect } from 'react'

import { getAllSessionMessages } from '@/hermes'
import { toChatMessages } from '@/lib/chat-messages'
import { onCloudHistoryChanged } from '@/store/cloud-sync'
import { $sessions, knownSessionOwner } from '@/store/session'
import { clearTranscriptTail } from '@/store/transcript-tail'
import { dropTranscriptTail } from '@/store/transcript-tail-cache'

import type { SessionActionsOptions } from './types'

interface PendingInvalidation {
  failures: number
  retryAt: number
}

/** Refresh display caches only. The runtime rehydrates its own context before the next turn. */
export function useCloudHistory({
  activeSessionIdRef,
  sessionStateByRuntimeIdRef,
  selectedStoredSessionIdRef,
  updateSessionState,
  syncSessionStateToView
}: Pick<
  SessionActionsOptions,
  | 'activeSessionIdRef'
  | 'sessionStateByRuntimeIdRef'
  | 'selectedStoredSessionIdRef'
  | 'updateSessionState'
  | 'syncSessionStateToView'
>) {
  useEffect(() => {
    let alive = true
    const pending = new Map<string, PendingInvalidation>()
    const running = new Set<string>()

    const refresh = () => {
      for (const [id, token] of pending) {
        if (running.has(id) || token.retryAt > Date.now()) {
          continue
        }
        const owner = knownSessionOwner($sessions.get(), id)

        if (!owner || (typeof owner !== 'string' && owner.connectionId && owner.connectionId !== 'local')) {
          pending.delete(id)

          continue
        }

        const states = [...sessionStateByRuntimeIdRef.current].filter(([, state]) => state.storedSessionId === id)

        if (states.some(([, state]) => state.busy || state.awaitingResponse)) {
          continue
        }
        const scope =
          typeof owner === 'string' ? { connectionId: 'local', profile: owner } : { ...owner, connectionId: 'local' }
        dropTranscriptTail(id, scope)
        clearTranscriptTail(id, scope)
        dropTranscriptTail(id, scope.profile)
        clearTranscriptTail(id, scope.profile)

        if (!states.length) {
          pending.delete(id)

          continue
        }

        running.add(id)
        void getAllSessionMessages(id, scope)
          .then(page => {
            if (!alive || pending.get(id) !== token) {
              return
            }
            const messages = toChatMessages(page.messages)
            let retry = false

            for (const [runtime, before] of states) {
              if (
                sessionStateByRuntimeIdRef.current.get(runtime) !== before ||
                before.busy ||
                before.awaitingResponse
              ) {
                retry = true

                continue
              }

              const next = updateSessionState(
                runtime,
                current => ({
                  ...current,
                  messages,
                  transcriptProvenance: undefined,
                  transcriptAuthorityEpoch: (current.transcriptAuthorityEpoch ?? 0) + 1
                }),
                id
              )

              if (selectedStoredSessionIdRef.current === id && activeSessionIdRef.current === runtime) {
                syncSessionStateToView(runtime, next)
              }
            }

            if (!retry) {
              pending.delete(id)
            }
          })
          .catch(() => {
            // An older request must not consume or delay a newer invalidation.
            if (!alive || pending.get(id) !== token) {
              return
            }
            token.failures = Math.min(token.failures + 1, 6)
            token.retryAt = Date.now() + Math.min(1_000 * 2 ** (token.failures - 1), 30_000)
          })
          .finally(() => {
            running.delete(id)
          })
      }
    }

    const off = onCloudHistoryChanged(event => {
      for (const id of event.changed_session_ids) {
        pending.set(id, { failures: 0, retryAt: 0 })
      }
      refresh()
    })
    const timer = setInterval(refresh, 1_000)

    return () => {
      alive = false
      off()
      clearInterval(timer)
    }
  }, [
    activeSessionIdRef,
    sessionStateByRuntimeIdRef,
    selectedStoredSessionIdRef,
    updateSessionState,
    syncSessionStateToView
  ])
}
