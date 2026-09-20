import type { ConversationCatalogEntry } from '@hermes/shared/gateway-events'
import { useStore } from '@nanostores/react'
import { computed } from 'nanostores'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { type ConversationOwner, conversationOwnerKey } from '@/store/conversation-owner'
import { $conversationRuntime, $foregroundConversationOwner, conversationRuntime } from '@/store/conversation-runtime'

import { ConversationComposer } from './composer/conversation-composer'
import type { ParticipantOption } from './composer/expert-selection'
import { createConversationActions } from './conversation-actions'
import { ConversationActivity } from './conversation-activity'
import { ConversationConfiguration } from './conversation-configuration'
import { ConversationContentView } from './conversation-content-view'

export interface ConversationViewProps {
  owner: ConversationOwner
}

export function ConversationView({ owner }: ConversationViewProps) {
  const { t } = useI18n()
  const copy = t.composer.conversation
  const key = conversationOwnerKey(owner)
  const actions = useMemo(() => createConversationActions(owner), [owner])

  const runtime = useStore(
    useMemo(() => computed($conversationRuntime, rows => rows[key] ?? conversationRuntime(owner)), [key, owner])
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  useLayoutEffect(() => {
    const element = scrollRef.current

    if (element && follow.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [runtime.events, runtime.activities, runtime.pendingRequests])

  const [catalog, setCatalog] = useState<ConversationCatalogEntry[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  useEffect(() => {
    const foreground = { ...owner }
    $foregroundConversationOwner.set(foreground)

    return () => {
      if ($foregroundConversationOwner.get() === foreground) {
        $foregroundConversationOwner.set(null)
      }
    }
  }, [owner])

  useEffect(() => {
    let disposed = false
    void actions.load().catch(() => {}) // The action publishes the failure to this owner's runtime.
    void actions
      .participants()
      .then(result => {
        if (!disposed) {
          setCatalog(result.participants)
        }
      })
      .catch(reason => {
        if (!disposed) {
          setCatalogError(String(reason instanceof Error ? reason.message : reason))
        }
      })

    return () => {
      disposed = true
      actions.releaseIdle()
    }
  }, [actions])

  const participants = useMemo<ParticipantOption[]>(() => {
    const entries = new Map((catalog ?? []).map(entry => [entry.participant.participant_id, entry]))

    for (const binding of runtime.snapshot?.participants ?? []) {
      if (!entries.has(binding.participant.participant_id)) {
        entries.set(binding.participant.participant_id, {
          participant: binding.participant,
          available: catalog === null,
          reason: t.composer.expertSelector.unavailable
        })
      }
    }

    return [...entries.values()].map(({ participant, available, reason }) => ({
      id: participant.participant_id,
      displayName: participant.display_name,
      sourceLabel: participant.profile,
      sourceId: `${participant.install_id} · ${participant.participant_id}`,
      isGeneral: participant.participant_id === runtime.snapshot?.conversation.general.participant_id,
      unavailableReason:
        available && participant.install_id === owner.installId
          ? undefined
          : reason || t.composer.expertSelector.unavailable
    }))
  }, [
    catalog,
    runtime.snapshot?.participants,
    runtime.snapshot?.conversation.general.participant_id,
    owner.installId,
    t.composer.expertSelector.unavailable
  ])

  const name = (id: string) => participants.find(item => item.id === id)?.displayName ?? id
  const active = runtime.snapshot?.active_turn

  const run = (action: () => Promise<unknown>) => {
    void action().catch(() => {})
  }

  return (
    <main
      className="flex h-full min-h-0 flex-col bg-(--ui-chat-surface-background)"
      data-conversation-id={owner.conversationId}
    >
      <header className="flex items-center justify-between border-b px-5 py-3">
        <h1>{runtime.snapshot?.conversation.title ?? copy.title}</h1>
        <Button onClick={() => run(actions.load)} variant="ghost">
          {copy.refresh}
        </Button>
      </header>
      <div
        aria-label={copy.history}
        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4"
        onScroll={event => {
          const element = event.currentTarget
          follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
        }}
        ref={scrollRef}
        role="log"
      >
        {!runtime.snapshot && !runtime.error && <p role="status">{copy.loading}</p>}
        {runtime.events
          .filter(event => event.kind === 'conversation.input' || event.kind === 'conversation.response')
          .map(event => {
            const payload = event.payload

            const author =
              typeof payload.author_display_name_at_time === 'string'
                ? payload.author_display_name_at_time
                : event.actor.display_name || event.actor.id

            const model = payload.model_snapshot as
              { model?: string; provider?: string; model_source?: string } | null | undefined

            const target =
              typeof payload.target_display_name_at_time === 'string'
                ? payload.target_display_name_at_time
                : typeof payload.target_participant_id === 'string'
                  ? name(payload.target_participant_id)
                  : null

            return (
              <article
                className="space-y-1"
                data-author-id={event.actor.id}
                data-event-id={event.event_id}
                key={event.event_id}
              >
                <div className="flex flex-wrap gap-2 text-sm">
                  <strong title={event.actor.id}>{author}</strong>
                  {target && <span>→ {target}</span>}
                  {event.kind === 'conversation.response' && (
                    <span className="text-(--ui-text-tertiary)">
                      {model?.model
                        ? [model.model, model.provider, model.model_source].filter(Boolean).join(' · ')
                        : copy.modelUnavailable}
                    </span>
                  )}
                </div>
                <ConversationContentView event={event} owner={owner} />
                {typeof payload.status === 'string' && payload.status !== 'settled' && (
                  <p className="text-xs">{payload.status}</p>
                )}
                {typeof payload.error === 'string' && <p role="alert">{payload.error}</p>}
              </article>
            )
          })}
        <ConversationActivity
          owner={owner}
          participantName={name}
          refresh={actions.load}
          respond={actions.respond}
          runtime={runtime}
        />
        {active && (
          <div className="flex items-center gap-3" role="status">
            <span title={active.runtime_id ?? undefined}>
              {name(active.participant_id)} · {active.status} · {copy.generation} {active.session_generation}
            </span>
            <Button
              disabled={active.status === 'stopping'}
              onClick={() => run(() => actions.stop(active))}
              variant="outline"
            >
              {t.composer.stop}
            </Button>
            {runtime.snapshot!.pending_delegations.length > 0 && (
              <Button onClick={() => run(() => actions.stop(active, true))} variant="outline">
                {copy.stopAll}
              </Button>
            )}
          </div>
        )}
        {(runtime.error || catalogError) && <p role="alert">{runtime.error || catalogError}</p>}
        {runtime.uncertainSend && <Button onClick={() => run(() => actions.retry())}>{copy.reconcile}</Button>}
      </div>
      <ConversationConfiguration onRefresh={actions.refresh} owner={owner} participants={participants} />
      <ConversationComposer
        busy={runtime.busy}
        onSubmit={() => run(actions.submit)}
        owner={owner}
        participants={participants}
        submitting={runtime.submitting}
        unavailable={catalog === null || !runtime.snapshot || Boolean(runtime.uncertainSend) || Boolean(catalogError)}
      />
    </main>
  )
}
