import type { ConversationProjectRef, ConversationRecord } from '@hermes/shared/gateway-events'

import { type ConversationOwner, conversationOwnerKey } from '@/store/conversation-owner'
import { conversationRuntime } from '@/store/conversation-runtime'
import { $conversationDrafts, cacheConversation, setConversationDraft } from '@/store/conversations'
import { requestGatewayForAgent } from '@/store/gateway'

/** Backend owns the atomic generation transition; this controller never rewrites a session cwd. */
export async function changeConversationProject(
  owner: ConversationOwner,
  project: ConversationProjectRef | null,
  revision: number,
  load: () => Promise<unknown>,
  request = requestGatewayForAgent
) {
  const state = conversationRuntime(owner)

  if (state.busy || state.submitting || state.uncertainSend) {
    throw new Error('Wait for conversation work to finish before changing project')
  }

  if (project && project.install_id !== owner.installId) {
    throw new Error('Project belongs to another installation')
  }

  const result = await request<{ conversation: ConversationRecord }>(
    owner.connectionId,
    'default',
    'conversations.set_project',
    {
      conversation_id: owner.conversationId,
      project_ref: project,
      expected_revision: revision
    }
  )

  cacheConversation(owner, result.conversation)
  const draft = $conversationDrafts.get()[conversationOwnerKey(owner)]

  if (draft) {
    setConversationDraft(owner, { ...draft, revision: result.conversation.revision })
  }
  await load()
}
