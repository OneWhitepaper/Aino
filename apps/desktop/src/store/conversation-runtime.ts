import type {
  ConversationActivityCoordinates,
  ConversationEvent,
  ConversationGetResult,
  ConversationRuntimeSnapshotResult,
  GatewayEvent,
  OpenRequestEntry
} from '@hermes/shared/gateway-events'
import { atom } from 'nanostores'

import { type ConversationOwner, conversationOwnerKey } from './conversation-owner'
import type { FrozenConversationSend } from './conversations'

export interface ConversationActivity {
  coordinates: ConversationActivityCoordinates
  events: GatewayEvent[]
  lastSeq: number
  text: string
  finalEventId?: string
}

export interface ConversationRuntime {
  owner: ConversationOwner
  snapshot?: ConversationGetResult
  events: ConversationEvent[]
  cursor: number
  activities: Record<string, ConversationActivity>
  uncertainSend?: FrozenConversationSend
  runtimeOwners: Record<string, { participantId: string; sessionGeneration: number }>
  runtimes: Record<string, ConversationRuntimeSnapshotResult>
  pendingRequests: Record<string, OpenRequestEntry & { coordinates: ConversationActivityCoordinates }>
  busy: boolean
  submitting: boolean
  error: string | null
}

export const $foregroundConversationOwner = atom<ConversationOwner | null>(null)

export const $conversationRuntime = atom<Record<string, ConversationRuntime>>({})

export function conversationRuntime(owner: ConversationOwner): ConversationRuntime {
  return (
    $conversationRuntime.get()[conversationOwnerKey(owner)] ?? {
      owner: { ...owner },
      events: [],
      cursor: 0,
      activities: {},
      runtimes: {},
      runtimeOwners: {},
      pendingRequests: {},
      busy: false,
      submitting: false,
      error: null
    }
  )
}

export function updateConversationRuntime(owner: ConversationOwner, patch: Partial<ConversationRuntime>): void {
  $conversationRuntime.set({
    ...$conversationRuntime.get(),
    [conversationOwnerKey(owner)]: { ...conversationRuntime(owner), ...patch }
  })
}

export function conversationActivityKey(activity: ConversationActivityCoordinates): string {
  return JSON.stringify([
    activity.conversation_id,
    activity.turn_id,
    activity.participant_id,
    activity.session_generation,
    activity.task_id,
    activity.execution_generation,
    activity.runtime_id
  ])
}

export function conversationIsBusy(snapshot: ConversationGetResult): boolean {
  return snapshot.active_turn !== null || snapshot.pending_delegations.length > 0
}

// Each controller reconciles its captured owner; terminal events do not consult UI selection.
export const conversationReconcilers = new Map<string, () => void>()
