import { JsonRpcGatewayError } from '@hermes/shared'
import type {
  ConversationBranchParams,
  ConversationEvent,
  ConversationReactionState,
  ConversationRegenerateParams
} from '@hermes/shared/gateway-events'

import { bindSelectedPlatformSession } from '@/api/platform-session-binding'
import { type ConversationOwner, conversationOwnerKey } from '@/store/conversation-owner'
import { conversationRuntime, updateConversationRuntime } from '@/store/conversation-runtime'
import { cacheConversation } from '@/store/conversations'
import { requestGatewayForAgent, retainGatewayForAgent } from '@/store/gateway'

import { createConversationActions } from './conversation-actions'
import { bindConversationParticipant } from './conversation-binding'
import type { ConversationRequest } from './conversation-sync'

// Retry the same ambiguous operation. Successful deliberate actions get fresh identities.
const branches = new Map<string, ConversationBranchParams>()
const attempts = new Map<string, ConversationRegenerateParams>()

export function createConversationHistoryActions(source: ConversationOwner, request = requestGatewayForAgent) {
  const owner = Object.freeze({ ...source })
  const key = conversationOwnerKey(owner)

  const rpc: ConversationRequest = (method, params) =>
    request(owner.connectionId, 'default', method, params as unknown as Record<string, unknown>)

  const idle = () => {
    const state = conversationRuntime(owner)

    if (!state.snapshot || state.busy || state.submitting || state.uncertainSend || state.uncertainHistory) {
      throw new Error('Finish current work before changing history')
    }

    return state.snapshot
  }

  async function branch(event: ConversationEvent, editText?: string) {
    if (event.room_id !== owner.conversationId) {
      throw new Error('History event belongs to another conversation')
    }
    const operationKey = JSON.stringify([key, event.event_id, editText])
    let params = branches.get(operationKey)

    if (!params) {
      params = {
        conversation_id: owner.conversationId,
        source_event_id: event.event_id,
        expected_revision: idle().conversation.revision,
        target_conversation_id: crypto.randomUUID(),
        operation_id: crypto.randomUUID(),
        ...(editText === undefined ? {} : { edit_text: editText })
      }
      branches.set(operationKey, params)
    }

    const result = await rpc('conversations.branch', params).catch(async error => {
      if (error instanceof JsonRpcGatewayError && [4000, 4120, 4121].includes(error.code ?? 0)) {
        branches.delete(operationKey)
        await createConversationActions(owner)
          .load()
          .catch(() => undefined)
      }

      throw error
    })

    const target = { ...owner, conversationId: params.target_conversation_id }

    if (result.branch.conversation_id !== target.conversationId || result.branch.operation_id !== params.operation_id) {
      throw new Error('Branch response belongs to another operation')
    }

    cacheConversation(target, result.conversation)
    branches.delete(operationKey)

    return target
  }

  async function regenerate(event: ConversationEvent) {
    if (event.room_id !== owner.conversationId) {
      throw new Error('History event belongs to another conversation')
    }
    const operationKey = JSON.stringify([key, event.event_id])
    let params = attempts.get(operationKey)

    if (params && conversationRuntime(owner).uncertainHistory?.input_id !== params.input_id) {
      attempts.delete(operationKey)
      params = undefined
    }

    let started = false
    const release = await retainGatewayForAgent(owner.connectionId, 'default')

    try {
      if (conversationRuntime(owner).submitting) {
        throw new Error('Finish current work before changing history')
      }

      if (!params) {
        const snapshot = idle()
        const binding = snapshot.participants.find(item => item.participant.participant_id === event.actor.id)

        if (!binding) {
          throw new Error('Original response participant is unavailable')
        }
        updateConversationRuntime(owner, { submitting: true })
        started = true

        const prepared = await rpc('conversations.prepare', {
          conversation_id: owner.conversationId,
          participant_id: binding.participant.participant_id,
          expected_generation: binding.session_generation,
          expected_revision: snapshot.conversation.revision
        })

        if (
          prepared.session_generation !== binding.session_generation ||
          prepared.previous_revision !== snapshot.conversation.revision ||
          prepared.conversation_revision < prepared.previous_revision
        ) {
          throw new Error('Preparation belongs to another generation or revision')
        }

        updateConversationRuntime(owner, {
          runtimeOwners: {
            ...conversationRuntime(owner).runtimeOwners,
            [prepared.session_id]: {
              participantId: binding.participant.participant_id,
              sessionGeneration: prepared.session_generation
            }
          }
        })
        await bindConversationParticipant(
          owner,
          binding.participant,
          prepared,
          bindSelectedPlatformSession,
          (method, value, timeout) => request(owner.connectionId, 'default', method, value, timeout)
        )
        params = {
          conversation_id: owner.conversationId,
          source_event_id: event.event_id,
          expected_revision: prepared.conversation_revision,
          input_id: crypto.randomUUID(),
          turn_id: crypto.randomUUID()
        }
        attempts.set(operationKey, params)
      }

      updateConversationRuntime(owner, { uncertainHistory: params })
      const result = await rpc('conversations.regenerate', params)

      if (
        result.admission.conversation_id !== owner.conversationId ||
        result.admission.input_id !== params.input_id ||
        result.admission.turn_id !== params.turn_id ||
        result.regenerates_event_id !== event.event_id
      ) {
        throw new Error('Regeneration response belongs to another operation')
      }

      attempts.delete(operationKey)
      updateConversationRuntime(owner, { busy: true, uncertainHistory: undefined })

      return result
    } catch (error) {
      if (error instanceof JsonRpcGatewayError && [4000, 4120, 4121].includes(error.code ?? 0)) {
        attempts.delete(operationKey)
        updateConversationRuntime(owner, { uncertainHistory: undefined })
      }

      throw error
    } finally {
      if (started) {
        updateConversationRuntime(owner, { submitting: false })
      }
      await createConversationActions(owner)
        .load()
        .catch(() => undefined)
      release()
    }
  }

  async function reactions(eventIds: string[]) {
    const states: ConversationReactionState[] = []

    for (let offset = 0; offset < eventIds.length; offset += 200) {
      const result = await rpc('conversations.reactions', {
        conversation_id: owner.conversationId,
        event_ids: eventIds.slice(offset, offset + 200)
      })

      states.push(...result.reactions)
    }

    return states
  }

  return { branch, regenerate, reactions, rpc }
}
