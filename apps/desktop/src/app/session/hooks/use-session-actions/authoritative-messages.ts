import { type ChatMessage, QUESTION_CARD_TOOLS, toChatMessages } from '@/lib/chat-messages'
import { type NewChatWorkspaceTarget, setCurrentUsage } from '@/store/session'
import type { SessionMessage, SessionResumeResult } from '@/types/hermes'

import { reconcilePersistedLiveTurn } from './persisted-live-turn'
import { appendLiveSessionProjection, reconcileDurableHistory } from './utils'

// Reflect a stored row's persisted token counts into the live usage atom
// (total is derived, so callers can't drift it out of sync with input/output).
export function applyStoredUsage(stored: { input_tokens?: number | null; output_tokens?: number | null }) {
  const input = stored.input_tokens || 0
  const output = stored.output_tokens || 0

  setCurrentUsage(current => ({ ...current, input, output, total: input + output }))
}

export function reconcileAuthoritativeChatMessages(
  authoritativeMessages: ChatMessage[],
  previousMessages: ChatMessage[],
  liveProjection?: Pick<SessionResumeResult, 'inflight' | 'queued' | 'session_id'>,
  sourceRows?: SessionMessage[]
): ChatMessage[] {
  if (liveProjection && sourceRows) {
    const reconciled = reconcilePersistedLiveTurn(authoritativeMessages, previousMessages, sourceRows, liveProjection)

    if (reconciled) {
      return reconciled
    }
  }

  return reconcileDurableHistory(
    liveProjection ? appendLiveSessionProjection(authoritativeMessages, liveProjection) : authoritativeMessages,
    previousMessages
  )
}

export function reconcileAuthoritativeMessages(
  authoritativeMessages: SessionResumeResult['messages'],
  previousMessages: ChatMessage[],
  liveProjection?: Pick<SessionResumeResult, 'inflight' | 'queued' | 'session_id'>
): ChatMessage[] {
  return reconcileAuthoritativeChatMessages(
    toChatMessages(authoritativeMessages),
    previousMessages,
    liveProjection,
    authoritativeMessages
  )
}

/** Drop the pre-hydration request-id row without copying the other messages.
 *  A copied clarify row looks like a concurrent edit and hydration keeps both. */
export function withoutEarlyClarifyProjection(messages: ChatMessage[], requestId: string): ChatMessage[] {
  let changed = false
  const next: ChatMessage[] = []

  for (const message of messages) {
    const parts = message.parts.filter(
      part =>
        !(
          part.type === 'tool-call' &&
          QUESTION_CARD_TOOLS.has(part.toolName) &&
          part.result === undefined &&
          part.toolCallId === requestId
        )
    )

    if (parts.length === message.parts.length) {
      next.push(message)

      continue
    }

    changed = true

    if (parts.length > 0) {
      next.push({ ...message, parts })
    }
  }

  return changed ? next : messages
}

/** Session-state patch for a restored blocking prompt row; the first non-null projection is used. */
export function livePromptStreamId(
  ...projections: ({ streamId: string } | null)[]
): { awaitingResponse: false; sawAssistantPayload: true; streamId: string } | Record<string, never> {
  const live = projections.find(Boolean)

  return live ? { awaitingResponse: false, sawAssistantPayload: true, streamId: live.streamId } : {}
}

export function normalizeNewChatWorkspaceTarget(target: NewChatWorkspaceTarget): NewChatWorkspaceTarget {
  return typeof target === 'string' ? target.trim() || null : target
}
