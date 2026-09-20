import type { ConversationExportCursor, ConversationExportResult } from '@hermes/shared/gateway-events'

import { downloadTextFile } from '@/lib/download-text'
import type { ConversationOwner } from '@/store/conversation-owner'
import { requestGatewayForAgent } from '@/store/gateway'

/** Export is backend-projected public data; renderer never traverses private profile files. */
export async function exportConversation(
  source: ConversationOwner,
  request = requestGatewayForAgent,
  download = downloadTextFile
) {
  const owner = Object.freeze({ ...source })
  let cursor: ConversationExportCursor | null = null
  let filename: string | null = null
  const chunks: string[] = []
  const visited = new Set<string>()

  do {
    const page: ConversationExportResult = await request(owner.connectionId, 'default', 'conversations.export', {
      conversation_id: owner.conversationId,
      cursor
    })

    filename ??= page.filename
    chunks.push(page.chunk)
    cursor = page.cursor

    if (cursor) {
      const key = JSON.stringify(cursor)

      if (visited.has(key)) {
        throw new Error('Conversation export cursor did not advance')
      }
      visited.add(key)
    }
  } while (cursor)

  if (!filename) {
    throw new Error('Conversation export filename is unavailable')
  }
  download(filename, chunks.join(''), 'application/json')
}
