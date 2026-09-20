import { JsonRpcGatewayError } from '@hermes/shared'
import type {
  ConversationCommandSend,
  ConversationModelPreparation,
  ConversationParticipantRef
} from '@hermes/shared/gateway-events'

import { translateNow } from '@/i18n'
import { setConversationPrivateNotice } from '@/store/conversation-notices'
import { type ConversationOwner, conversationOwnerKey, participantSessionOwner } from '@/store/conversation-owner'
import { conversationRuntime, updateConversationRuntime } from '@/store/conversation-runtime'
import { $conversationDrafts, type ConversationDraft, setConversationDraft } from '@/store/conversations'

import type { ConversationRequest } from './conversation-sync'

export interface ResolvedConversationCommandSend {
  result: ConversationCommandSend
  draft: ConversationDraft
}

export interface ConversationModelSelection {
  model_source: 'aino' | 'byok'
  model_id?: string
  reasoning_effort?: string
  fast?: boolean
}

interface ConfigurationDependencies {
  rpc: ConversationRequest
  retain: () => Promise<void>
  releaseIdle: () => void
  load: () => Promise<unknown>
  hasSubmission: () => boolean
  bindPrepared: (participant: ConversationParticipantRef, prepared: ConversationModelPreparation) => Promise<void>
}

export function createConversationConfigurationActions(owner: ConversationOwner, deps: ConfigurationDependencies) {
  const key = conversationOwnerKey(owner)

  function start() {
    const current = conversationRuntime(owner)

    if (
      !current.snapshot ||
      current.busy ||
      current.submitting ||
      current.uncertainSend ||
      current.uncertainHistory ||
      deps.hasSubmission()
    ) {
      throw new Error(translateNow('composer.conversation.configurationBusy'))
    }

    updateConversationRuntime(owner, { submitting: true })

    return current
  }

  async function participant(id: string) {
    const bound = conversationRuntime(owner).snapshot?.participants.find(item => item.participant.participant_id === id)

    const result =
      bound?.participant ??
      (await deps.rpc('conversations.participants', {})).participants.find(
        item => item.available && item.participant.participant_id === id
      )?.participant

    if (!result) {
      throw new Error(translateNow('composer.expertSelector.unavailable'))
    }

    participantSessionOwner(owner, result)

    return result
  }

  async function bindPrepared(selected: ConversationParticipantRef, prepared: ConversationModelPreparation) {
    await deps.bindPrepared(selected, prepared)
    updateConversationRuntime(owner, {
      runtimeOwners: {
        ...conversationRuntime(owner).runtimeOwners,
        [prepared.session_id]: {
          participantId: selected.participant_id,
          sessionGeneration: prepared.session_generation
        }
      }
    })
  }

  async function command() {
    const draft = $conversationDrafts.get()[key]

    if (!draft) {
      throw new Error(translateNow('composer.conversation.unavailable'))
    }

    const captured = { ...draft, attachmentIds: [...draft.attachmentIds] }
    let selected: ConversationParticipantRef | undefined
    let started = false

    try {
      const current = start()
      started = true
      selected = await participant(captured.selectedParticipantId)

      const generation =
        current.snapshot!.participants.find(item => item.participant.participant_id === selected!.participant_id)
          ?.session_generation ?? 1

      await deps.retain()

      const prepared = await deps.rpc('conversations.prepare', {
        conversation_id: owner.conversationId,
        participant_id: selected.participant_id,
        expected_generation: generation,
        expected_revision: captured.revision
      })

      if (
        prepared.previous_revision !== captured.revision ||
        prepared.conversation_revision < captured.revision ||
        prepared.session_generation !== generation
      ) {
        throw new Error(translateNow('composer.conversation.runtimeChanged'))
      }

      await bindPrepared(selected, prepared)
      const latest = $conversationDrafts.get()[key]

      if (latest) {
        setConversationDraft(owner, { ...latest, revision: Math.max(latest.revision, prepared.conversation_revision) })
      }

      const result = await deps.rpc('conversations.command', {
        conversation_id: owner.conversationId,
        participant_id: selected.participant_id,
        expected_generation: generation,
        expected_revision: prepared.conversation_revision,
        command: captured.text.trim()
      })

      if (
        (result.type === 'notice' && result.scope !== 'private') ||
        result.conversation_id !== owner.conversationId ||
        result.participant_id !== selected.participant_id ||
        result.session_generation !== generation ||
        result.runtime_id !== prepared.session_id ||
        result.conversation_revision !== prepared.conversation_revision
      ) {
        throw new Error(translateNow('composer.conversation.runtimeChanged'))
      }

      if (result.type === 'send') {
        await deps.load()
        const currentDraft = $conversationDrafts.get()[key]

        if (
          !result.command_token ||
          currentDraft?.inputVersion !== captured.inputVersion ||
          currentDraft.selectedParticipantId !== captured.selectedParticipantId ||
          currentDraft.revision !== result.conversation_revision
        ) {
          throw new Error(translateNow('composer.conversation.commandDraftChanged'))
        }

        return {
          result,
          draft: { ...captured, revision: result.conversation_revision }
        } satisfies ResolvedConversationCommandSend
      }

      setConversationPrivateNotice(owner, {
        participantId: selected.participant_id,
        displayName: selected.display_name,
        command: captured.text.trim(),
        output: result.output
      })
      const currentDraft = $conversationDrafts.get()[key]

      if (currentDraft?.inputVersion === captured.inputVersion && currentDraft.text === captured.text) {
        setConversationDraft(owner, { ...currentDraft, text: '' })
      }

      await deps.load()

      return undefined
    } catch (reason) {
      const data = reason instanceof JsonRpcGatewayError ? (reason.data as { reason?: string } | undefined) : undefined
      setConversationPrivateNotice(owner, {
        participantId: captured.selectedParticipantId,
        displayName: selected?.display_name ?? translateNow('composer.expertSelector.unavailable'),
        command: captured.text.trim(),
        output: reason instanceof Error ? reason.message : String(reason),
        error: true,
        refreshRequired: data?.reason === 'refresh_required'
      })

      if (started) {
        await deps.load().catch(() => undefined)
      }

      throw reason
    } finally {
      if (started) {
        updateConversationRuntime(owner, { submitting: false })
        deps.releaseIdle()
      }
    }
  }

  async function refresh(participantId: string, expectedGeneration: number, selection?: ConversationModelSelection) {
    let selected: ConversationParticipantRef | undefined
    let started = false

    try {
      const current = start()
      started = true
      const binding = current.snapshot!.participants.find(item => item.participant.participant_id === participantId)

      if (binding && binding.session_generation !== expectedGeneration) {
        throw new Error(translateNow('composer.conversation.runtimeChanged'))
      }

      selected = await participant(participantId)
      await deps.retain()
      let prepared: ConversationModelPreparation

      if (!binding) {
        if (expectedGeneration !== 1) {
          throw new Error(translateNow('composer.conversation.runtimeChanged'))
        }

        prepared = await deps.rpc('conversations.prepare', {
          conversation_id: owner.conversationId,
          participant_id: participantId,
          expected_generation: 1,
          expected_revision: current.snapshot!.conversation.revision,
          ...selection
        })
      } else {
        const result = await deps.rpc('conversations.refresh', {
          conversation_id: owner.conversationId,
          participant_id: participantId,
          expected_generation: expectedGeneration,
          ...selection
        })

        if (
          result.binding.conversation_id !== owner.conversationId ||
          result.binding.participant.participant_id !== participantId ||
          result.binding.participant.install_id !== owner.installId ||
          result.binding.session_generation !== expectedGeneration + 1 ||
          result.preparation.session_generation !== result.binding.session_generation
        ) {
          throw new Error(translateNow('composer.conversation.runtimeChanged'))
        }

        prepared = result.preparation
      }

      await bindPrepared(selected, prepared)
      await deps.load()
      setConversationPrivateNotice(owner, {
        participantId,
        displayName: selected.display_name,
        output: translateNow('composer.conversation.configurationRefreshed')
      })
    } catch (reason) {
      setConversationPrivateNotice(owner, {
        participantId,
        displayName: selected?.display_name ?? translateNow('composer.expertSelector.unavailable'),
        output: reason instanceof Error ? reason.message : String(reason),
        error: true
      })

      // A refresh can persist the new binding before credential binding fails; reconcile that truth, never roll back history.
      if (started) {
        await deps.load().catch(() => undefined)
      }

      throw reason
    } finally {
      if (started) {
        updateConversationRuntime(owner, { submitting: false })
        deps.releaseIdle()
      }
    }
  }

  return { command, refresh }
}
