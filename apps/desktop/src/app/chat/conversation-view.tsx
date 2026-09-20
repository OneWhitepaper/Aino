import type { ConversationCatalogEntry } from '@hermes/shared/gateway-events'
import { useStore } from '@nanostores/react'
import { computed } from 'nanostores'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { AssistantMessageContent } from '@/components/assistant-ui/thread/assistant-message'
import { ThreadContent } from '@/components/assistant-ui/thread/list'
import { HumanMessageContainer, USER_BUBBLE_BASE_CLASS } from '@/components/assistant-ui/thread/user-message'
import { Backdrop } from '@/components/Backdrop'
import { Intro } from '@/components/chat/intro'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { PaneTabLabel } from '@/components/ui/pane-tab'
import { Contribute } from '@/contrib/react/contribute'
import { useI18n } from '@/i18n'
import { type ConversationOwner, conversationOwnerKey } from '@/store/conversation-owner'
import { $conversationRuntime, $foregroundConversationOwner, conversationRuntime } from '@/store/conversation-runtime'
import { $conversationDrafts, setConversationDraft } from '@/store/conversations'

import { ConversationComposer } from './composer/conversation-composer'
import type { ParticipantOption } from './composer/expert-selection'
import { createConversationActions } from './conversation-actions'
import { ConversationActivity } from './conversation-activity'
import { ConversationConfiguration } from './conversation-configuration'
import { ConversationContentView } from './conversation-content-view'
import { ConversationEditedDraft } from './conversation-edited-draft'
import { ConversationMessageActions } from './conversation-message-actions'
import { ConversationProject } from './conversation-project'
import { useConversationReactions } from './use-conversation-reactions'

export interface ConversationViewProps {
  owner: ConversationOwner
  onOpenConversation?: (owner: ConversationOwner) => void
}

export function ConversationView({ owner, onOpenConversation }: ConversationViewProps) {
  const { t } = useI18n()
  const copy = t.composer.conversation
  const key = conversationOwnerKey(owner)
  const actions = useMemo(() => createConversationActions(owner), [owner])

  const runtime = useStore(
    useMemo(() => computed($conversationRuntime, rows => rows[key] ?? conversationRuntime(owner)), [key, owner])
  )

  const reactionIds = runtime.events
    .filter(event => event.kind === 'conversation.input' || event.kind === 'conversation.response')
    .map(event => event.event_id)

  const reactions = useConversationReactions(owner, reactionIds)
  const pendingEdit = runtime.snapshot?.conversation.branch?.draft_pending ? runtime.snapshot.conversation.branch : null
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

  const home =
    Boolean(runtime.snapshot) &&
    !runtime.events.some(event => event.kind === 'conversation.input' || event.kind === 'conversation.response')

  return (
    <main
      className="relative isolate flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-(--ui-chat-surface-background)"
      data-chat-surface=""
      data-conversation-id={owner.conversationId}
      data-conversation-layout={!home ? '' : undefined}
      data-home-layout={home ? '' : undefined}
    >
      {!home && runtime.snapshot && (
        <Contribute area="titleBar.left" id={`conversation-header:${key}`} order={-100}>
          <PaneTabLabel
            className="normal-case text-sm tracking-normal"
            overflowLabel={runtime.snapshot.conversation.title}
          >
            {runtime.snapshot.conversation.title}
          </PaneTabLabel>
        </Contribute>
      )}
      <Backdrop />
      <div
        aria-label={copy.history}
        className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
        data-slot="aui_thread-viewport"
        onScroll={event => {
          const element = event.currentTarget
          follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
        }}
        ref={scrollRef}
        role="log"
      >
        <ThreadContent className={home ? 'h-full' : 'pb-8'}>
          {home && (
            <Intro
              home
              onInsertPrompt={text => {
                const draft = $conversationDrafts.get()[key]

                if (draft) {
                  setConversationDraft(owner, { ...draft, text })
                }
              }}
              onPickFiles={() => {
                const root = scrollRef.current?.closest('main')
                root?.querySelector<HTMLInputElement>('input[type="file"]')?.click()
              }}
            />
          )}
          {!runtime.snapshot && !runtime.error && <Loader label={copy.loading} />}
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
                  className="pb-(--conversation-turn-gap)"
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
                  {event.kind === 'conversation.input' ? (
                    <HumanMessageContainer messageId={event.event_id}>
                      <div className={USER_BUBBLE_BASE_CLASS}>
                        <ConversationContentView event={event} owner={owner} />
                      </div>
                    </HumanMessageContainer>
                  ) : (
                    <AssistantMessageContent>
                      <ConversationContentView event={event} owner={owner} />
                    </AssistantMessageContent>
                  )}
                  <ConversationMessageActions
                    disabled={
                      runtime.busy ||
                      runtime.submitting ||
                      Boolean(runtime.uncertainSend || runtime.uncertainHistory) ||
                      Boolean(pendingEdit) ||
                      Boolean(runtime.snapshot?.conversation.archived)
                    }
                    event={event}
                    onOpen={onOpenConversation}
                    onReact={reactions.react}
                    owner={owner}
                    reaction={reactions.states[event.event_id]}
                  />
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
                {name(active.participant_id)} · {active.status}
              </span>
              {runtime.snapshot!.pending_delegations.length > 0 && (
                <Button onClick={() => run(() => actions.stop(active, true))} variant="outline">
                  {copy.stopAll}
                </Button>
              )}
            </div>
          )}
          {reactions.error && (
            <Button onClick={reactions.retry} variant="ghost">
              {t.common.retry}
            </Button>
          )}
          {(runtime.error || catalogError) && <p role="alert">{runtime.error || catalogError}</p>}
          {(runtime.uncertainSend || runtime.uncertainHistory) && (
            <Button onClick={() => run(() => actions.retry())}>{copy.reconcile}</Button>
          )}
        </ThreadContent>
      </div>
      {pendingEdit?.draft ? (
        <ConversationEditedDraft
          branch={pendingEdit}
          busy={runtime.busy || runtime.submitting}
          owner={owner}
          revision={runtime.snapshot!.conversation.revision}
          uncertain={Boolean(runtime.uncertainSend)}
        />
      ) : (
        <ConversationComposer
          busy={runtime.busy}
          configuration={
            <ConversationConfiguration onRefresh={actions.refresh} owner={owner} participants={participants} />
          }
          home={home}
          notices={
            <ConversationConfiguration
              noticesOnly
              onRefresh={actions.refresh}
              owner={owner}
              participants={participants}
            />
          }
          onRefresh={actions.refresh}
          onStop={active ? () => run(() => actions.stop(active)) : undefined}
          onSubmit={() => run(actions.submit)}
          owner={owner}
          participants={participants}
          project={
            runtime.snapshot && (
              <ConversationProject
                disabled={runtime.busy || runtime.submitting || Boolean(runtime.uncertainSend)}
                load={actions.load}
                owner={owner}
                profiles={(catalog ?? []).map(entry => entry.participant.profile)}
                record={runtime.snapshot.conversation}
              />
            )
          }
          submitting={runtime.submitting}
          unavailable={
            catalog === null ||
            !runtime.snapshot ||
            runtime.snapshot.conversation.archived ||
            Boolean(runtime.uncertainSend || runtime.uncertainHistory) ||
            Boolean(catalogError)
          }
        />
      )}
    </main>
  )
}
