import { useEffect, useState } from 'react'

import { usePaneVisible } from '@/components/pane-shell/pane-visibility'
import { useI18n } from '@/i18n'
import { sessionOwnerIsKnown } from '@/store/session-owner-resolution'
import { requestForSessionProfile, type SessionOwnerScope } from '@/store/session-request-router'
import { knownOwnerForSession, requestForOwnedSession } from '@/store/session-states'

import { rejectUnownedSubagentRequest } from './use-subagent-snapshot'

interface Tail {
  available: boolean
  text: string
  truncated: boolean
}

interface SubagentTranscriptProps {
  sessionId: string
  subagentId: string
  /** A panel keeps the source selected by its opener. */
  owner?: SessionOwnerScope
}

export function SubagentTranscript(props: SubagentTranscriptProps) {
  const { sessionId, subagentId, owner: suppliedOwner } = props
  const explicitOwner = Object.hasOwn(props, 'owner')
  const { t } = useI18n()
  const paneVisible = usePaneVisible()
  const ownerIdentity = JSON.stringify(explicitOwner ? suppliedOwner : knownOwnerForSession(sessionId))
  const identity = JSON.stringify([sessionId, subagentId, ownerIdentity])
  const [snapshot, setSnapshot] = useState<{ identity: string; tail: Tail } | null>(null)
  const tail = snapshot?.identity === identity ? snapshot.tail : null
  const unresolved = explicitOwner && !sessionOwnerIsKnown(suppliedOwner)
  useEffect(() => {
    if (!paneVisible || unresolved) {
      // Keep-alive tiles stay mounted; only poll while this pane is the visible tab (reveal re-runs the effect).
      return
    }

    let cancelled = false
    let pending = false
    const owner = suppliedOwner && typeof suppliedOwner === 'object' ? { ...suppliedOwner } : suppliedOwner

    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') {
        return
      }

      pending = true

      try {
        const params = { session_id: sessionId, subagent_id: subagentId }

        const result = explicitOwner
          ? await requestForSessionProfile<Tail>(owner, rejectUnownedSubagentRequest, 'subagent.tail', params)
          : await requestForOwnedSession<Tail>(sessionId, rejectUnownedSubagentRequest, 'subagent.tail', params)

        if (!cancelled && (explicitOwner || ownerIdentity === JSON.stringify(knownOwnerForSession(sessionId)))) {
          setSnapshot({
            identity,
            tail: {
              available: result.available,
              text: typeof result.text === 'string' ? result.text.slice(-16384) : '',
              truncated: result.truncated
            }
          })
        }
      } catch {
        if (!cancelled) {
          setSnapshot({ identity, tail: { available: false, text: '', truncated: false } })
        }
      } finally {
        pending = false
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), 2000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [explicitOwner, identity, ownerIdentity, paneVisible, sessionId, subagentId, suppliedOwner, unresolved])

  return (
    <section className="mt-2 text-xs" data-slot="subagent-transcript">
      <h4 className="text-(--ui-text-secondary)">{t.agents.extendedTranscript}</h4>
      {tail?.truncated && <p className="text-(--ui-text-tertiary)">{t.agents.transcriptTruncated}</p>}
      {tail?.available ? (
        <pre className="max-h-[30vh] overflow-auto overscroll-y-auto whitespace-pre-wrap break-words font-mono text-[length:var(--aino-text-caption)]">
          {tail.text}
        </pre>
      ) : (
        <p className="text-(--ui-text-tertiary)">
          {tail || unresolved ? t.agents.transcriptUnavailable : t.agents.waitingActivity}
        </p>
      )}
    </section>
  )
}
