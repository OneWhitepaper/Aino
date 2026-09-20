import type { ConversationActivityCoordinates, ConversationEvent, GatewayEvent } from '@hermes/shared/gateway-events'

import { type ConversationOwner, conversationOwnerKey } from '@/store/conversation-owner'
import {
  $conversationRuntime,
  $foregroundConversationOwner,
  conversationActivityKey,
  conversationReconcilers,
  type ConversationRuntime,
  conversationRuntime,
  updateConversationRuntime
} from '@/store/conversation-runtime'
import { acceptConversationSend } from '@/store/conversations'
import type { ScopedServerRequest } from '@/store/gateway'

function isFinalFor(event: ConversationEvent, coordinates: ConversationActivityCoordinates): boolean {
  return (
    event.kind === 'conversation.response' &&
    event.actor.id === coordinates.participant_id &&
    event.payload.turn_id === coordinates.turn_id &&
    event.payload.task_id === coordinates.task_id &&
    event.payload.session_generation === coordinates.session_generation &&
    event.payload.execution_generation === coordinates.execution_generation
  )
}

export function mergeConversationEvents(owner: ConversationOwner, incoming: readonly ConversationEvent[]): void {
  const current = conversationRuntime(owner)
  const events = [...current.events]
  const ids = new Set(events.map(event => event.event_id))
  const seqs = new Set(events.map(event => event.seq))

  for (const event of incoming) {
    if (event.room_id !== owner.conversationId) {
      throw new Error('Public event belongs to another conversation')
    }

    if (ids.has(event.event_id) || seqs.has(event.seq)) {
      continue
    }

    ids.add(event.event_id)
    seqs.add(event.seq)
    events.push(event)
  }

  events.sort((a, b) => a.seq - b.seq)
  const activities = { ...current.activities }

  for (const [key, activity] of Object.entries(activities)) {
    const final = events.find(event => isFinalFor(event, activity.coordinates))

    if (final) {
      activities[key] = { ...activity, text: String(final.payload.text ?? ''), finalEventId: final.event_id }
    }
  }

  const frozen = current.uncertainSend

  const accepted =
    frozen &&
    events.some(
      event =>
        event.kind === 'conversation.input' &&
        event.payload.input_id === frozen.inputId &&
        event.payload.turn_id === frozen.turnId &&
        event.payload.target_participant_id === frozen.participantId &&
        event.payload.text === frozen.text &&
        JSON.stringify(event.payload.attachment_ids) === JSON.stringify(frozen.attachmentIds)
    )

  if (accepted) {
    acceptConversationSend(owner, frozen, current.snapshot?.conversation.revision ?? frozen.expectedRevision)
  }

  updateConversationRuntime(owner, {
    events,
    activities,
    ...(accepted ? { uncertainSend: undefined, error: null } : {})
  })
}

/** Consume tagged activity before legacy session routing, including while another page is foreground. */
export function handleConversationGatewayEvent(event: GatewayEvent): boolean {
  if (event.type === 'request.cancel') {
    const id = (event.payload as { id?: string } | undefined)?.id

    const state =
      id &&
      Object.values($conversationRuntime.get()).find(
        candidate =>
          candidate.owner.connectionId === event.connectionId &&
          (candidate.pendingRequests[id]?.coordinates.runtime_id ??
            pendingReplies.get(conversationOwnerKey(candidate.owner))?.get(id)?.params.session_id) === event.session_id
      )

    if (state && id) {
      pendingReplies.get(conversationOwnerKey(state.owner))?.delete(id)
      const { [id]: _cancelled, ...pendingRequests } = state.pendingRequests
      updateConversationRuntime(state.owner, { pendingRequests })

      return true
    }
  }

  const coordinates = event.conversation

  if (!coordinates) {
    return false
  }

  // Connection comes from the delivering socket; the selected Profile/session is never consulted.
  const state = Object.values($conversationRuntime.get()).find(
    candidate =>
      candidate.owner.connectionId === event.connectionId &&
      candidate.owner.conversationId === coordinates.conversation_id &&
      candidate.runtimeOwners[coordinates.runtime_id]?.participantId === coordinates.participant_id &&
      candidate.runtimeOwners[coordinates.runtime_id]?.sessionGeneration === coordinates.session_generation
  )

  if (!state) {
    return true
  }

  const key = conversationActivityKey(coordinates)
  const previous = state.activities[key]

  if (event.seq !== undefined && previous && event.seq <= previous.lastSeq) {
    return true
  }

  const final = state.events.find(item => isFinalFor(item, coordinates))
  const payload = event.payload as { text?: unknown } | undefined
  const delta = event.type === 'message.delta' && typeof payload?.text === 'string' ? payload.text : ''
  updateConversationRuntime(state.owner, {
    activities: {
      ...state.activities,
      [key]: {
        coordinates: { ...coordinates },
        events: [...(previous?.events ?? []), event],
        lastSeq: event.seq ?? previous?.lastSeq ?? 0,
        text: final ? String(final.payload.text ?? '') : (previous?.text ?? '') + delta,
        ...(final ? { finalEventId: final.event_id } : {})
      }
    }
  })

  if (event.type === 'message.complete' || event.type === 'session.info') {
    conversationReconcilers.get(conversationOwnerKey(state.owner))?.()
  }

  return true
}

// Keep replies on the delivering socket, keyed by the complete conversation owner.
const pendingReplies = new Map<string, Map<string, ScopedServerRequest>>()

const INPUT_METHODS = new Set([
  'approval',
  'clarify',
  'mcp.setup',
  'secret',
  'sudo',
  'vault.code',
  'vault.save_login',
  'vault.unlock_prompt'
])

function ownsRequestCoordinates(state: ConversationRuntime, coordinates: ConversationActivityCoordinates): boolean {
  const binding = state.snapshot?.participants.find(
    item =>
      item.participant.install_id === state.owner.installId &&
      item.participant.participant_id === coordinates.participant_id &&
      item.session_generation === coordinates.session_generation
  )

  const runtime = state.runtimes[coordinates.participant_id]
  const known = state.runtimeOwners[coordinates.runtime_id]

  if (
    !binding ||
    state.owner.conversationId !== coordinates.conversation_id ||
    !(
      (known?.participantId === coordinates.participant_id &&
        known.sessionGeneration === coordinates.session_generation) ||
      runtime?.runtime_id === coordinates.runtime_id
    )
  ) {
    return false
  }

  const active = state.snapshot?.active_turn

  const exactActive =
    active &&
    active.runtime_id === coordinates.runtime_id &&
    active.participant_id === coordinates.participant_id &&
    active.session_generation === coordinates.session_generation &&
    active.turn_id === coordinates.turn_id &&
    active.task_id === coordinates.task_id &&
    active.execution_generation === coordinates.execution_generation

  const exactBackground = runtime?.background_activities.some(
    item => conversationActivityKey(item) === conversationActivityKey(coordinates)
  )

  return Boolean(exactActive || exactBackground)
}

export function conversationRequestOwner(request: ScopedServerRequest): ConversationRuntime | undefined {
  const coordinates = request.params.conversation as ConversationActivityCoordinates | undefined

  if (!coordinates || request.params.session_id !== coordinates.runtime_id) {
    return undefined
  }

  const candidates = Object.values($conversationRuntime.get()).filter(
    state => state.owner.connectionId === request.connectionId && ownsRequestCoordinates(state, coordinates)
  )

  return candidates.length === 1 ? candidates[0] : undefined
}

export function isForegroundConversationRequest(request: ScopedServerRequest): boolean {
  const state = conversationRequestOwner(request)
  const foreground = $foregroundConversationOwner.get()

  return Boolean(state && foreground && conversationOwnerKey(state.owner) === conversationOwnerKey(foreground))
}

export function handleConversationServerRequest(request: ScopedServerRequest): boolean {
  const coordinates = request.params.conversation as ConversationActivityCoordinates | undefined

  if (!coordinates || !INPUT_METHODS.has(request.method)) {
    return false
  }

  // Snapshot replies replay requests before the runtime snapshot is published. Keep
  // the socket privately until reconciliation establishes its complete owner.
  const candidate = Object.values($conversationRuntime.get()).find(
    state =>
      state.owner.connectionId === request.connectionId && state.owner.conversationId === coordinates.conversation_id
  )

  if (candidate) {
    const key = conversationOwnerKey(candidate.owner)
    const replies = pendingReplies.get(key) ?? new Map<string, ScopedServerRequest>()
    replies.set(request.id, { ...request, params: { ...request.params, conversation: { ...coordinates } } })
    pendingReplies.set(key, replies)
  }

  const state = conversationRequestOwner(request)

  if (!state) {
    return true
  }
  updateConversationRuntime(state.owner, {
    pendingRequests: {
      ...state.pendingRequests,
      [request.id]: {
        id: request.id,
        method: request.method,
        params: { ...request.params },
        coordinates: { ...coordinates }
      }
    }
  })

  return true
}

export function respondConversationRequest(
  owner: ConversationOwner,
  requestId: string,
  result: Record<string, unknown>
): void {
  const key = conversationOwnerKey(owner)
  const request = pendingReplies.get(key)?.get(requestId)
  const state = conversationRuntime(owner)

  if (!request || !state.pendingRequests[requestId] || conversationRequestOwner(request)?.owner !== state.owner) {
    throw new Error('Conversation request is no longer available; reload the conversation')
  }

  request.respond(result)
  pendingReplies.get(key)?.delete(requestId)
  const { [requestId]: _answered, ...pendingRequests } = state.pendingRequests
  updateConversationRuntime(owner, { pendingRequests })
}

export function reconcileConversationRequests(
  owner: ConversationOwner,
  participantId: string,
  openIds: readonly string[]
): void {
  const state = conversationRuntime(owner)
  const pendingRequests = { ...state.pendingRequests }
  const replies = pendingReplies.get(conversationOwnerKey(owner))

  for (const [id, request] of replies ?? []) {
    const coordinates = request.params.conversation as ConversationActivityCoordinates

    if (coordinates.participant_id === participantId && !openIds.includes(id)) {
      replies?.delete(id)
    }
  }

  for (const [id, request] of Object.entries(pendingRequests)) {
    if (
      request.coordinates.participant_id === participantId &&
      (!openIds.includes(id) || !ownsRequestCoordinates(state, request.coordinates))
    ) {
      delete pendingRequests[id]
      replies?.delete(id)
    }
  }

  updateConversationRuntime(owner, { pendingRequests })

  for (const id of openIds) {
    const replay = replies?.get(id)

    if (replay) {
      handleConversationServerRequest(replay)
    }
  }
}
