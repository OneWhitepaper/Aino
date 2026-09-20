import type { ConversationActivityCoordinates, RpcMethods } from '@hermes/shared/gateway-events'

import { translateNow } from '@/i18n'
import type { ConversationOwner } from '@/store/conversation-owner'
import { conversationRuntime } from '@/store/conversation-runtime'
import { requestGatewayForAgent } from '@/store/gateway'

/** A captured runtime is never substituted with the next draft's participant or a new generation. */
export function requireConversationRuntime(owner: ConversationOwner, coordinates: ConversationActivityCoordinates) {
  const runtime = conversationRuntime(owner)

  const binding = runtime.snapshot?.participants.find(
    item => item.participant.participant_id === coordinates.participant_id
  )

  const live = runtime.runtimes[coordinates.participant_id]

  if (
    coordinates.conversation_id !== owner.conversationId ||
    binding?.participant.install_id !== owner.installId ||
    binding.session_generation !== coordinates.session_generation ||
    live?.runtime_id !== coordinates.runtime_id
  ) {
    throw new Error(translateNow('composer.conversation.runtimeChanged'))
  }

  return { binding, live }
}

export async function controlConversationChild(
  owner: ConversationOwner,
  coordinates: ConversationActivityCoordinates,
  childId: string,
  action: { kind: 'interrupt' } | { kind: 'steer'; text: string }
) {
  const { live } = requireConversationRuntime(owner, coordinates)

  if (!live.subagents.some(child => child.subagent_id === childId)) {
    throw new Error(translateNow('composer.conversation.childUnavailable'))
  }

  const params = { session_id: coordinates.runtime_id, subagent_id: childId }

  return action.kind === 'steer'
    ? requestGatewayForAgent<RpcMethods['subagent.steer']['result']>(owner.connectionId, 'default', 'subagent.steer', {
        ...params,
        text: action.text
      })
    : requestGatewayForAgent<RpcMethods['subagent.interrupt']['result']>(
        owner.connectionId,
        'default',
        'subagent.interrupt',
        params
      )
}
