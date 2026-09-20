import type {
  ConversationAttachment,
  ConversationAttachResult,
  ConversationCapabilities
} from '@hermes/shared/gateway-events'
import { atom } from 'nanostores'

import { base64FromDataUrl } from '@/app/session/hooks/use-prompt-actions/utils'
import { translateNow } from '@/i18n'

import { type ConversationOwner, conversationOwnerKey } from './conversation-owner'
import { $conversationDrafts, setConversationDraft } from './conversations'
import { requestGatewayForAgent } from './gateway'

export interface ConversationDraftAttachment {
  localId: string
  file: File
  status: 'uploading' | 'ready' | 'error'
  attachment?: ConversationAttachment
  error?: string
}
const uploadQueues = new Map<string, Promise<void>>()
const readers = new Map<string, FileReader>()
export const $conversationUploadErrors = atom<Record<string, string>>({})
export const $conversationAttachments = atom<Record<string, ConversationDraftAttachment[]>>({})

function update(owner: ConversationOwner, localId: string, patch: Partial<ConversationDraftAttachment>) {
  const key = conversationOwnerKey(owner)
  $conversationAttachments.set({
    ...$conversationAttachments.get(),
    [key]: ($conversationAttachments.get()[key] ?? []).map(item =>
      item.localId === localId ? { ...item, ...patch } : item
    )
  })
}

function fileData(file: File, localId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    readers.set(localId, reader)

    reader.onload = () => {
      readers.delete(localId)
      resolve(base64FromDataUrl(String(reader.result)))
    }

    reader.onabort = () => {
      readers.delete(localId)
      reject(new DOMException('Upload removed', 'AbortError'))
    }

    reader.onerror = () => {
      readers.delete(localId)
      reject(reader.error ?? new Error(translateNow('composer.conversation.fileReadFailed')))
    }

    reader.readAsDataURL(file)
  })
}

export async function uploadConversationAttachment(
  source: ConversationOwner,
  file: File,
  retryId?: string
): Promise<void> {
  const owner = Object.freeze({ ...source })
  const key = conversationOwnerKey(owner)

  if (!$conversationDrafts.get()[key]) {
    return
  }

  if (
    !retryId &&
    ($conversationDrafts.get()[key]?.attachmentIds.length ?? 0) +
      ($conversationAttachments.get()[key]?.filter(item => item.status !== 'ready').length ?? 0) >=
      128
  ) {
    $conversationUploadErrors.set({
      ...$conversationUploadErrors.get(),
      [key]: translateNow('composer.conversation.attachmentCountExceeded')
    })

    return
  }

  const localId = retryId ?? crypto.randomUUID()

  if (retryId) {
    const current = $conversationAttachments.get()[key]?.find(item => item.localId === retryId)

    if (!current || current.status !== 'error') {
      return
    }

    update(owner, localId, { status: 'uploading', error: undefined })
  } else {
    $conversationAttachments.set({
      ...$conversationAttachments.get(),
      [key]: [...($conversationAttachments.get()[key] ?? []), { localId, file, status: 'uploading' }]
    })
  }

  const execute = async () => {
    try {
      if (!$conversationAttachments.get()[key]?.some(item => item.localId === localId)) {
        return
      }

      const capabilities = await requestGatewayForAgent<ConversationCapabilities>(
        owner.connectionId,
        'default',
        'conversations.capabilities',
        {}
      )

      const maxCount = capabilities.max_attachments

      if (!Number.isSafeInteger(maxCount) || maxCount == null || maxCount < 1) {
        throw new Error(translateNow('composer.conversation.attachmentLimitUnavailable'))
      }

      const draftCount = $conversationDrafts.get()[key]?.attachmentIds.length ?? 0
      const pendingCount = $conversationAttachments.get()[key]?.filter(item => item.status !== 'ready').length ?? 0

      if (draftCount + pendingCount > maxCount) {
        throw new Error(translateNow('composer.conversation.attachmentCountExceeded'))
      }

      const maxBytes = capabilities.max_attachment_bytes

      if (!Number.isSafeInteger(maxBytes) || maxBytes == null || maxBytes <= 0) {
        throw new Error(translateNow('composer.conversation.attachmentLimitUnavailable'))
      }

      if (file.size > maxBytes) {
        throw new Error(translateNow('composer.conversation.attachmentTooLarge'))
      }

      if (!$conversationAttachments.get()[key]?.some(item => item.localId === localId)) {
        return
      }

      const data_base64 = await fileData(file, localId)

      if (!$conversationAttachments.get()[key]?.some(item => item.localId === localId)) {
        return
      }

      const result = await requestGatewayForAgent<ConversationAttachResult>(
        owner.connectionId,
        'default',
        'conversations.attach',
        {
          conversation_id: owner.conversationId,
          filename: file.name,
          mime_type: file.type || 'application/octet-stream',
          data_base64
        }
      )

      const draft = $conversationDrafts.get()[key]

      // Removed uploads never reappear; switching experts only changes the target, not this owner.
      if (!draft || !$conversationAttachments.get()[key]?.some(item => item.localId === localId)) {
        return
      }

      if (!result.attachment.id || result.attachment.content_ref.size_bytes !== file.size) {
        throw new Error(translateNow('composer.conversation.contentInvalid'))
      }

      setConversationDraft(owner, {
        ...draft,
        attachmentIds: [...new Set([...draft.attachmentIds, result.attachment.id])]
      })
      update(owner, localId, { status: 'ready', attachment: result.attachment, error: undefined })
    } catch (reason) {
      update(owner, localId, { status: 'error', error: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  const previous = uploadQueues.get(owner.connectionId) ?? Promise.resolve()
  const task = previous.then(execute, execute)
  uploadQueues.set(owner.connectionId, task)

  try {
    await task
  } finally {
    if (uploadQueues.get(owner.connectionId) === task) {
      uploadQueues.delete(owner.connectionId)
    }
  }
}

export function removeConversationAttachment(owner: ConversationOwner, localId: string): void {
  const key = conversationOwnerKey(owner)
  const current = $conversationAttachments.get()[key] ?? []
  const item = current.find(entry => entry.localId === localId)
  readers.get(localId)?.abort()
  $conversationUploadErrors.set({ ...$conversationUploadErrors.get(), [key]: '' })
  const draft = $conversationDrafts.get()[key]

  if (
    draft &&
    item?.attachment &&
    !current.some(other => other.localId !== localId && other.attachment?.id === item.attachment?.id)
  ) {
    setConversationDraft(owner, {
      ...draft,
      attachmentIds: draft.attachmentIds.filter(id => id !== item.attachment!.id)
    })
  }

  $conversationAttachments.set({
    ...$conversationAttachments.get(),
    [key]: current.filter(entry => entry.localId !== localId)
  })
}
