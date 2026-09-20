import { JsonRpcGatewayError } from '@hermes/shared'
import type { ConversationTurn } from '@hermes/shared/gateway-events'

import type { ConversationOwner } from '@/store/conversation-owner'
import { conversationRuntime, updateConversationRuntime } from '@/store/conversation-runtime'
import { acceptConversationSend } from '@/store/conversations'

import type { ConversationRequest } from './conversation-sync'

interface RecoveryDependencies {
  rpc: ConversationRequest
  load: () => Promise<unknown>
  retain: () => Promise<void>
  releaseIdle: () => void
  failed: (error: unknown) => void
  scheduleReconcile: () => void
}

export function createConversationRecoveryActions(
  owner: ConversationOwner,
  { rpc, load, retain, releaseIdle, failed, scheduleReconcile }: RecoveryDependencies
) {
  async function stop(turn: ConversationTurn, includeDelegations = false) {
    try {
      const captured = { ...turn }

      const result = await rpc('conversations.stop', {
        conversation_id: owner.conversationId,
        turn_id: captured.turn_id,
        execution_generation: captured.execution_generation,
        include_delegations: includeDelegations
      })

      const current = conversationRuntime(owner)

      if (result.status === 'requested') {
        const active = current.snapshot?.active_turn
        updateConversationRuntime(owner, {
          busy: true,
          ...(current.snapshot &&
          active?.turn_id === captured.turn_id &&
          active.execution_generation === captured.execution_generation
            ? {
                snapshot: { ...current.snapshot, active_turn: { ...active, status: 'stopping' } }
              }
            : {})
        })
      } else {
        await load()
      }

      return result
    } catch (error) {
      failed(error)
      throw error
    } finally {
      scheduleReconcile()
    }
  }

  async function retry(turn?: ConversationTurn) {
    try {
      await retain()
      const history = conversationRuntime(owner).uncertainHistory

      if (!turn && history) {
        const result = await rpc('conversations.regenerate', history).catch(error => {
          if (error instanceof JsonRpcGatewayError && [4000, 4120, 4121].includes(error.code ?? 0)) {
            updateConversationRuntime(owner, { uncertainHistory: undefined })
          }

          throw error
        })

        if (
          result.admission.conversation_id !== owner.conversationId ||
          result.admission.input_id !== history.input_id ||
          result.admission.turn_id !== history.turn_id
        ) {
          throw new Error('Regeneration reconciliation belongs to another input')
        }

        updateConversationRuntime(owner, { uncertainHistory: undefined })
        await load()

        return result
      }

      const frozen = conversationRuntime(owner).uncertainSend

      if (!turn && !frozen) {
        throw new Error('No conversation input to reconcile')
      }

      const result = turn
        ? await rpc('conversations.retry', {
            conversation_id: owner.conversationId,
            turn_id: turn.turn_id,
            input_id: turn.input_id,
            expected_generation: turn.execution_generation
          })
        : await rpc('conversations.send', {
            conversation_id: owner.conversationId,
            turn_id: frozen!.turnId,
            input_id: frozen!.inputId,
            participant_id: frozen!.participantId,
            text: frozen!.text,
            ...(frozen!.surface ? { surface: frozen!.surface, voice_context: frozen!.voiceContext } : {}),
            ...(frozen!.commandToken ? { command_token: frozen!.commandToken } : {}),
            attachment_ids: [...frozen!.attachmentIds],
            expected_revision: frozen!.expectedRevision
          })

      if (
        !turn &&
        frozen &&
        (result.admission.input_id !== frozen.inputId ||
          result.admission.turn_id !== frozen.turnId ||
          result.admission.conversation_id !== owner.conversationId ||
          result.admission.participant_id !== frozen.participantId)
      ) {
        throw new Error('Send reconciliation belongs to another input')
      }

      if (
        frozen &&
        result.admission.input_id === frozen.inputId &&
        result.admission.turn_id === frozen.turnId &&
        result.admission.conversation_id === owner.conversationId &&
        result.admission.participant_id === frozen.participantId
      ) {
        acceptConversationSend(owner, frozen, frozen.expectedRevision)
        updateConversationRuntime(owner, { uncertainSend: undefined })
      }

      await load()

      return result
    } catch (error) {
      failed(error)
      throw error
    } finally {
      releaseIdle()
      scheduleReconcile()
    }
  }

  return { stop, retry }
}
