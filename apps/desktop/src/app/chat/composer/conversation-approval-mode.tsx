import { useCallback } from 'react'

import { useI18n } from '@/i18n'
import type { ConversationOwner } from '@/store/conversation-owner'
import { confirm } from '@/store/confirm'
import { requestGatewayForAgent } from '@/store/gateway'
import { conversationRuntime } from '@/store/conversation-runtime'

import { ApprovalModeMenu } from './approval-mode-menu'

interface ConversationApprovalModeProps {
  owner: ConversationOwner
  participantId: string
  profile: string
  disabled: boolean
  onRefresh: (id: string, generation: number) => Promise<unknown>
}
export function ConversationApprovalMode({
  owner,
  participantId,
  profile,
  disabled,
  onRefresh
}: ConversationApprovalModeProps) {
  const { t } = useI18n()
  const request = useCallback(
    async (method: string, params?: Record<string, unknown>) => {
      if (method === 'config.set') {
        const state = conversationRuntime(owner)
        const generation =
          state.snapshot?.participants.find(item => item.participant.participant_id === participantId)
            ?.session_generation ?? 1
        if (state.busy || state.submitting || state.uncertainSend)
          throw new Error(t.composer.conversation.configurationBusy)
        const accepted = await confirm({
          title: t.shell.approvalMode.title,
          description: t.composer.conversation.refreshExplanation
        })
        if (!accepted) throw new Error(t.common.cancel)
        const latest = conversationRuntime(owner)
        if (latest.busy || latest.submitting || latest.uncertainSend)
          throw new Error(t.composer.conversation.configurationBusy)
        const result = await requestGatewayForAgent(owner.connectionId, 'default', method, { ...params, profile })
        await onRefresh(participantId, generation)
        return result
      }
      return requestGatewayForAgent(owner.connectionId, 'default', method, { ...params, profile })
    },
    [owner, participantId, profile, onRefresh, t]
  )
  return (
    <ApprovalModeMenu
      disabled={disabled}
      profile={JSON.stringify([owner.connectionId, owner.installId, profile])}
      requestGateway={request}
    />
  )
}
