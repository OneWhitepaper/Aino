import type { ConversationGetResult, RpcMethods } from '@hermes/shared/gateway-events'

import { type ConversationOwner, conversationOwnerKey, participantSessionOwner } from '@/store/conversation-owner'
import {
  conversationIsBusy,
  conversationReconcilers,
  conversationRuntime,
  updateConversationRuntime
} from '@/store/conversation-runtime'
import { $conversationDrafts, cacheConversation, setConversationDraft } from '@/store/conversations'
import type { retainGatewayForAgent } from '@/store/gateway'

import {
  mergeConversationEvents,
  reconcileConversationRequests
} from '../session/hooks/use-message-stream/conversation-events'

export type ConversationMethod = Extract<keyof RpcMethods, `conversations.${string}`>
export type ConversationRequest = <M extends ConversationMethod>(
  method: M,
  params: RpcMethods[M]['params']
) => Promise<RpcMethods[M]['result']>
const leases = new Map<string, () => void>()
const acquiringLeases = new Map<string, Promise<void>>()
const polls = new Map<string, ReturnType<typeof setTimeout>>()
const loads = new Map<string, Promise<ConversationGetResult>>()

export function createConversationSync(
  owner: ConversationOwner,
  rpc: ConversationRequest,
  retainGateway: typeof retainGatewayForAgent
) {
  const key = conversationOwnerKey(owner)
  let consecutiveFailures = 0

  async function retain() {
    if (leases.has(key)) {
      return
    }

    let pending = acquiringLeases.get(key)

    if (!pending) {
      pending = retainGateway(owner.connectionId, 'default')
        .then(value => {
          leases.set(key, value)
        })
        .finally(() => {
          acquiringLeases.delete(key)
        })
      acquiringLeases.set(key, pending)
    }

    await pending
  }

  function releaseIdle() {
    const current = conversationRuntime(owner)

    if (!current.busy && !current.submitting && !current.uncertainSend && !current.uncertainHistory) {
      leases.get(key)?.()
      leases.delete(key)
      clearTimeout(polls.get(key))
      polls.delete(key)
    }
  }

  function scheduleReconcile() {
    const state = conversationRuntime(owner)

    if (
      (!state.busy && !state.uncertainSend && !state.uncertainHistory) ||
      polls.has(key) ||
      consecutiveFailures >= 3
    ) {
      return
    }

    polls.set(
      key,
      setTimeout(() => {
        polls.delete(key)
        // Errors remain visible in owner state; reconnecting does not discard a pending input.
        void load().catch(() => undefined)
      }, 2000)
    )
  }

  conversationReconcilers.set(key, scheduleReconcile)

  function failed(error: unknown) {
    updateConversationRuntime(owner, { error: error instanceof Error ? error.message : String(error) })
  }

  async function readEvents() {
    let cursor = conversationRuntime(owner).cursor

    for (;;) {
      const page = await rpc('conversations.events', {
        conversation_id: owner.conversationId,
        after_seq: cursor,
        limit: 200
      })

      mergeConversationEvents(owner, page.events)

      if (page.has_more && page.cursor <= cursor) {
        throw new Error('Conversation event cursor did not advance')
      }

      cursor = page.cursor
      updateConversationRuntime(owner, { cursor })

      if (!page.has_more) {
        return
      }
    }
  }

  async function readSnapshot() {
    await retain()
    const snapshot = await rpc('conversations.get', { conversation_id: owner.conversationId })

    for (const binding of snapshot.participants) {
      participantSessionOwner(owner, binding.participant)

      if (binding.conversation_id !== owner.conversationId) {
        throw new Error('Participant binding belongs to another conversation')
      }
    }

    cacheConversation(owner, snapshot.conversation)
    const previous = conversationRuntime(owner).snapshot

    if (previous && previous.conversation.revision > snapshot.conversation.revision) {
      return previous
    }

    updateConversationRuntime(owner, {
      snapshot,
      busy: conversationIsBusy(snapshot),
      error:
        conversationRuntime(owner).uncertainSend || conversationRuntime(owner).uncertainHistory
          ? conversationRuntime(owner).error
          : null
    })
    const draft = $conversationDrafts.get()[key]
    const edited = snapshot.conversation.branch?.draft_pending ? snapshot.conversation.branch.draft : null
    setConversationDraft(
      owner,
      draft
        ? { ...draft, revision: Math.max(draft.revision, snapshot.conversation.revision) }
        : {
            conversationId: owner.conversationId,
            selectedParticipantId: edited?.participant_id ?? snapshot.conversation.general.participant_id,
            text: edited?.text ?? '',
            attachmentIds: edited?.attachment_ids ?? [],
            revision: snapshot.conversation.revision
          }
    )
    await readEvents()
    updateConversationRuntime(owner, { historyLoaded: true })
    const pendingHistory = conversationRuntime(owner).uncertainHistory

    if (
      pendingHistory &&
      conversationRuntime(owner).events.some(event => event.payload.input_id === pendingHistory.input_id)
    ) {
      updateConversationRuntime(owner, { uncertainHistory: undefined })
    }

    const runtimes: ReturnType<typeof conversationRuntime>['runtimes'] = {}

    for (const binding of snapshot.participants) {
      const runtime = await rpc('conversations.runtime_snapshot', {
        conversation_id: owner.conversationId,
        participant_id: binding.participant.participant_id,
        session_generation: binding.session_generation
      })

      for (const activity of [runtime.activity, ...runtime.background_activities]) {
        if (
          activity &&
          (activity.conversation_id !== owner.conversationId ||
            activity.participant_id !== binding.participant.participant_id ||
            activity.session_generation !== binding.session_generation ||
            activity.runtime_id !== runtime.runtime_id)
        ) {
          throw new Error('Runtime snapshot belongs to another participant generation')
        }
      }

      updateConversationRuntime(owner, {
        runtimes: { ...conversationRuntime(owner).runtimes, [binding.participant.participant_id]: runtime }
      })
      reconcileConversationRequests(
        owner,
        binding.participant.participant_id,
        runtime.open_requests.map(request => request.id)
      )
      runtimes[binding.participant.participant_id] = runtime
    }

    const runtimeOwners = { ...conversationRuntime(owner).runtimeOwners }

    for (const binding of snapshot.participants) {
      const id = runtimes[binding.participant.participant_id]?.runtime_id

      if (id) {
        runtimeOwners[id] = {
          participantId: binding.participant.participant_id,
          sessionGeneration: binding.session_generation
        }
      }
    }

    updateConversationRuntime(owner, { runtimes, runtimeOwners })

    return snapshot
  }

  function load(): Promise<ConversationGetResult> {
    const pending = loads.get(key)

    if (pending) {
      return pending
    }

    const loading = readSnapshot()
      .then(snapshot => {
        consecutiveFailures = 0

        return snapshot
      })
      .catch(error => {
        consecutiveFailures += 1
        failed(error)
        throw error
      })
      .finally(() => {
        loads.delete(key)
        releaseIdle()
        scheduleReconcile()
      })

    loads.set(key, loading)

    return loading
  }

  return { retain, releaseIdle, scheduleReconcile, failed, load }
}
