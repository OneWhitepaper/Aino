import type { ConversationContentRef, ConversationContentResult } from '@hermes/shared/gateway-events'

import { translateNow } from '@/i18n'
import { type ConversationOwner, conversationOwnerKey } from '@/store/conversation-owner'
import { requestGatewayForAgent } from '@/store/gateway'

/** The public ref and every page must agree before any bytes are displayed or downloaded. */
export async function readConversationContent(
  source: ConversationOwner,
  reference: ConversationContentRef,
  signal?: AbortSignal
): Promise<Uint8Array<ArrayBuffer>> {
  const owner = Object.freeze({ ...source })
  conversationOwnerKey(owner)
  const ref = Object.freeze({ ...reference })
  const invalid = () => new Error(translateNow('composer.conversation.contentInvalid'))

  if (!Number.isSafeInteger(ref.size_bytes) || ref.size_bytes < 0 || !/^[a-f0-9]{64}$/i.test(ref.sha256) || !ref.id) {
    throw invalid()
  }

  const chunks: Uint8Array[] = []
  let offset = 0

  for (;;) {
    signal?.throwIfAborted()

    const page = await requestGatewayForAgent<ConversationContentResult>(
      owner.connectionId,
      'default',
      'conversations.content',
      { conversation_id: owner.conversationId, content_id: ref.id, offset_bytes: offset, limit_bytes: 65536 }
    )

    signal?.throwIfAborted()
    let bytes: Uint8Array

    try {
      bytes = Uint8Array.from(atob(page.data_base64), char => char.charCodeAt(0))
    } catch {
      throw invalid()
    }

    const next = offset + bytes.byteLength

    if (
      page.sha256.toLowerCase() !== ref.sha256.toLowerCase() ||
      !Number.isSafeInteger(page.next_offset) ||
      page.next_offset !== next ||
      next > ref.size_bytes ||
      bytes.byteLength > 65536 ||
      (page.has_more && (next <= offset || next >= ref.size_bytes)) ||
      (!page.has_more && next !== ref.size_bytes)
    ) {
      throw invalid()
    }

    chunks.push(bytes)
    offset = next

    if (!page.has_more) {
      break
    }
  }

  const full = new Uint8Array(ref.size_bytes)
  let position = 0

  for (const chunk of chunks) {
    full.set(chunk, position)
    position += chunk.byteLength
  }

  const digest = await crypto.subtle.digest('SHA-256', full)
  signal?.throwIfAborted()
  const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')

  if (sha256 !== ref.sha256.toLowerCase()) {
    throw invalid()
  }

  return full
}
