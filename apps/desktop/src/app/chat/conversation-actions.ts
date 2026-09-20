import { JsonRpcGatewayError } from '@hermes/shared'
import type { ConversationCreateParams, RpcMethods } from '@hermes/shared/gateway-events'

import { bindSelectedPlatformSession } from '@/api/platform-session-binding'
import { type ConversationOwner, conversationOwnerKey, participantSessionOwner } from '@/store/conversation-owner'
import { conversationRuntime, updateConversationRuntime } from '@/store/conversation-runtime'
import {
  $conversationDrafts,
  acceptConversationSend,
  cacheConversation,
  freezeConversationSend,
  setConversationDraft
} from '@/store/conversations'
import { requestGatewayForAgent, retainGatewayForAgent } from '@/store/gateway'

import { respondConversationRequest } from '../session/hooks/use-message-stream/conversation-events'

import { bindConversationParticipant } from './conversation-binding'
import {
  createConversationConfigurationActions,
  type ResolvedConversationCommandSend
} from './conversation-configuration-actions'
import { createConversationRecoveryActions } from './conversation-recovery-actions'
import { type ConversationMethod, createConversationSync } from './conversation-sync'

interface ConversationActionDependencies {
  request: typeof requestGatewayForAgent
  retain: typeof retainGatewayForAgent
  bind: typeof bindSelectedPlatformSession
}
const submissions = new Map<string, Promise<unknown>>()

/** The owner is captured once; changing the selected Profile never changes this controller's route. */
export function createConversationActions(
  source: ConversationOwner,
  dependencies: Partial<ConversationActionDependencies> = {}
) {
  const owner = Object.freeze({ ...source })
  const key = conversationOwnerKey(owner)

  const deps = {
    request: requestGatewayForAgent,
    retain: retainGatewayForAgent,
    bind: bindSelectedPlatformSession,
    ...dependencies
  }

  const request = <T>(method: string, params?: Record<string, unknown>, timeout?: number) =>
    deps.request<T>(owner.connectionId, 'default', method, params, timeout)

  const rpc = <M extends ConversationMethod>(method: M, params: RpcMethods[M]['params']) =>
    request<RpcMethods[M]['result']>(method, params as Record<string, unknown>)

  const { retain, releaseIdle, scheduleReconcile, failed, load } = createConversationSync(owner, rpc, deps.retain)

  function send(
    ids: { inputId: string; turnId: string } = { inputId: crypto.randomUUID(), turnId: crypto.randomUUID() },
    resolvedCommand?: ResolvedConversationCommandSend
  ) {
    const pending = submissions.get(key)

    if (pending) {
      return pending
    }

    const draft = resolvedCommand?.draft ?? $conversationDrafts.get()[key]

    if (!draft) {
      return Promise.reject(new Error('Conversation draft is unavailable'))
    }

    const frozen = Object.freeze({
      ...freezeConversationSend(draft, ids),
      ...(resolvedCommand
        ? {
            text: resolvedCommand.result.display,
            sourceText: draft.text,
            commandToken: resolvedCommand.result.command_token
          }
        : {})
    })

    const execute = async () => {
      const current = conversationRuntime(owner)

      if (current.busy || current.uncertainSend || current.submitting) {
        throw new Error('Conversation is busy or awaiting send reconciliation')
      }

      const snapshot = current.snapshot

      if (!snapshot) {
        throw new Error('Load the conversation before sending')
      }

      const binding = snapshot.participants.find(item => item.participant.participant_id === frozen.participantId)
      let participant = binding?.participant

      if (!participant) {
        const catalog = await rpc('conversations.participants', {})
        participant = catalog.participants.find(
          item => item.available && item.participant.participant_id === frozen.participantId
        )?.participant
      }

      if (!participant) {
        throw new Error('Selected participant is unavailable')
      }

      participantSessionOwner(owner, participant)
      updateConversationRuntime(owner, { submitting: true, error: null })
      let admitted = false

      try {
        await retain()

        const prepared = await rpc('conversations.prepare', {
          conversation_id: owner.conversationId,
          participant_id: frozen.participantId,
          expected_generation: binding?.session_generation ?? 1,
          expected_revision: frozen.expectedRevision
        })

        if (
          prepared.previous_revision !== frozen.expectedRevision ||
          prepared.conversation_revision < prepared.previous_revision ||
          prepared.session_generation !== (binding?.session_generation ?? 1)
        ) {
          throw new Error('Conversation preparation revision changed')
        }

        const latestDraft = $conversationDrafts.get()[key]

        if (latestDraft) {
          setConversationDraft(owner, {
            ...latestDraft,
            revision: Math.max(latestDraft.revision, prepared.conversation_revision)
          })
        }

        updateConversationRuntime(owner, {
          runtimeOwners: {
            ...conversationRuntime(owner).runtimeOwners,
            [prepared.session_id]: {
              participantId: participant.participant_id,
              sessionGeneration: prepared.session_generation
            }
          }
        })
        await bindConversationParticipant(owner, participant, prepared, deps.bind, request)
        updateConversationRuntime(owner, {
          uncertainSend: { ...frozen, expectedRevision: prepared.conversation_revision }
        })

        const result = await rpc('conversations.send', {
          conversation_id: owner.conversationId,
          participant_id: frozen.participantId,
          input_id: frozen.inputId,
          turn_id: frozen.turnId,
          text: frozen.text,
          ...(frozen.commandToken ? { command_token: frozen.commandToken } : {}),
          attachment_ids: [...frozen.attachmentIds],
          expected_revision: prepared.conversation_revision
        })

        const ack = result.admission

        if (
          ack.conversation_id !== owner.conversationId ||
          ack.input_id !== frozen.inputId ||
          ack.turn_id !== frozen.turnId ||
          ack.participant_id !== frozen.participantId
        ) {
          throw new Error('Send acknowledgement belongs to another input')
        }

        admitted = true
        updateConversationRuntime(owner, { uncertainSend: undefined })
        acceptConversationSend(owner, frozen, prepared.conversation_revision)
        updateConversationRuntime(owner, { busy: true })
        // ACK has no public revision. Only a subsequent authoritative snapshot advances it.
        await load()

        return result
      } catch (error) {
        // These are explicit admission refusals, so no ambiguous in-flight send needs replay.
        if (error instanceof JsonRpcGatewayError && [4000, 4120, 4121].includes(error.code ?? 0)) {
          updateConversationRuntime(owner, { uncertainSend: undefined })
        }

        throw error
      } finally {
        updateConversationRuntime(owner, { submitting: false })

        if (!admitted) {
          releaseIdle()
        }
      }
    }

    const submission = execute()
      .catch(error => {
        failed(error)
        throw error
      })
      .finally(() => {
        submissions.delete(key)
        releaseIdle()
        scheduleReconcile()
      })

    submissions.set(key, submission)

    return submission
  }

  async function create(params: Omit<ConversationCreateParams, 'conversation_id'>) {
    try {
      const result = await rpc('conversations.create', { ...params, conversation_id: owner.conversationId })
      cacheConversation(owner, result.conversation)
      await load()

      return result.conversation
    } catch (error) {
      failed(error)
      throw error
    }
  }

  const recovery = createConversationRecoveryActions(owner, { rpc, load, retain, releaseIdle, failed, scheduleReconcile })

  const configuration = createConversationConfigurationActions(owner, {
    rpc,
    retain,
    releaseIdle,
    load,
    hasSubmission: () => submissions.has(key),
    bindPrepared: (participant, prepared) =>
      bindConversationParticipant(owner, participant, prepared, deps.bind, request)
  })

  const submit = async () => {
    if (!$conversationDrafts.get()[key]?.text.trimStart().startsWith('/')) {
      return send()
    }

    const resolved = await configuration.command()

    return resolved ? send(undefined, resolved) : undefined
  }

  const participants = () => rpc('conversations.participants', {})

  const respond = (requestId: string, result: Record<string, unknown>) =>
    respondConversationRequest(owner, requestId, result)

  return { owner, create, load, participants, send, submit, respond, releaseIdle, ...recovery, ...configuration }
}
