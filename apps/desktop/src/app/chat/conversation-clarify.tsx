import { useState } from 'react'

import { OwnedClarifyRequest } from '@/components/assistant-ui/clarify-tool'
import { useI18n } from '@/i18n'
import { normalizeChoices, normalizeQuestions } from '@/store/clarify'
import type { ConversationOwner } from '@/store/conversation-owner'
import type { ConversationRuntime } from '@/store/conversation-runtime'
import { requestGatewayForAgent } from '@/store/gateway'

import { requireConversationRuntime } from './conversation-runtime-controls'

export interface ConversationRequestProps {
  owner: ConversationOwner
  request: ConversationRuntime['pendingRequests'][string]
  respond: (id: string, result: Record<string, unknown>) => void
  refresh: () => Promise<unknown>
}

export function ConversationClarify({ owner, request, respond, refresh }: ConversationRequestProps) {
  const { t } = useI18n()
  const [accepted, setAccepted] = useState<Record<string, string>>({})

  return (
    <OwnedClarifyRequest
      request={{
        requestId: request.id,
        sessionId: request.coordinates.runtime_id,
        question: String(request.params.question ?? ''),
        choices: normalizeChoices(request.params.choices),
        multiSelect: request.params.multi_select === true,
        questions: normalizeQuestions(request.params.questions),
        lockedAnswers: { ...(request.params.answers as Record<string, string> | undefined), ...accepted }
      }}
      transport={{
        answer: answer => respond(request.id, { answer }),
        cancel: () => respond(request.id, {}),
        lock: async (questionId, answer) => {
          requireConversationRuntime(owner, request.coordinates)

          const result = await requestGatewayForAgent<{ status: string }>(
            owner.connectionId,
            'default',
            'clarify.lock',
            { request_id: request.id, question_id: questionId, answer }
          )

          if (result.status !== 'ok') {
            throw new Error(t.composer.conversation.clarifyExpired)
          }
          setAccepted(current => ({ ...current, [questionId]: answer }))
          await refresh()
        }
      }}
    />
  )
}
