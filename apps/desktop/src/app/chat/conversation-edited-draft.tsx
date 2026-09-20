import { JsonRpcGatewayError } from '@hermes/shared'
import type { ConversationBranchReceipt, ConversationCancelDraftParams } from '@hermes/shared/gateway-events'
import { useMemo, useRef, useState } from 'react'

import { UserEditBubble, UserEditSubmitButton } from '@/components/assistant-ui/thread/user-edit-surface'
import { HumanMessageContainer } from '@/components/assistant-ui/thread/user-message'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { type ConversationOwner, conversationOwnerKey } from '@/store/conversation-owner'
import { $conversationDrafts, cacheConversation, setConversationDraft } from '@/store/conversations'

import { createConversationActions } from './conversation-actions'
import { createConversationHistoryActions } from './conversation-history-actions'

export function ConversationEditedDraft({
  owner,
  branch,
  revision,
  busy,
  uncertain
}: {
  owner: ConversationOwner
  branch: ConversationBranchReceipt
  revision: number
  busy: boolean
  uncertain: boolean
}) {
  const { t } = useI18n()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancellation = useRef<ConversationCancelDraftParams | null>(null)
  const key = conversationOwnerKey(owner)
  const actions = useMemo(() => createConversationActions(owner), [key])
  const draft = branch.draft!

  const run = async (fn: () => Promise<unknown>) => {
    setWorking(true)
    setError(null)

    try {
      await fn()
    } catch (reason) {
      if (reason instanceof JsonRpcGatewayError && reason.code === 4120) {
        cancellation.current = null
        await actions.load().catch(() => undefined)
      }

      setError(String(reason))
    } finally {
      setWorking(false)
    }
  }

  async function cancel() {
    cancellation.current ??= {
      conversation_id: owner.conversationId,
      input_id: draft.input_id,
      expected_revision: Math.max(
        revision,
        $conversationDrafts.get()[conversationOwnerKey(owner)]?.revision ?? revision
      ),
      operation_id: crypto.randomUUID()
    }

    const { conversation } = await createConversationHistoryActions(owner).rpc(
      'conversations.cancel_draft',
      cancellation.current
    )

    cacheConversation(owner, conversation)
    const current = $conversationDrafts.get()[conversationOwnerKey(owner)]

    if (current) {
      setConversationDraft(owner, { ...current, text: '', attachmentIds: [], revision: conversation.revision })
    }

    await actions.load()
  }

  return (
    <HumanMessageContainer>
      <UserEditBubble data-expanded="true">
        <p className="whitespace-pre-wrap pr-7">{draft.text}</p>
        <UserEditSubmitButton
          disabled={busy || working}
          onSubmit={() => void run(() => (uncertain ? actions.retry() : actions.submit()))}
          submitting={working}
        />
        <Button disabled={busy || working || uncertain} onClick={() => void run(cancel)} size="sm" variant="ghost">
          {t.common.cancel}
        </Button>
        {error && <p role="alert">{error}</p>}
      </UserEditBubble>
    </HumanMessageContainer>
  )
}
