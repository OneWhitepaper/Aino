import { useStore } from '@nanostores/react'
import { computed } from 'nanostores'
import { useEffect, useMemo, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { FileText, Loader2, Plus, X } from '@/lib/icons'
import {
  $conversationAttachments,
  $conversationUploadErrors,
  removeConversationAttachment,
  uploadConversationAttachment
} from '@/store/conversation-attachments'
import { type ConversationOwner, conversationOwnerKey } from '@/store/conversation-owner'
import { $conversationDrafts } from '@/store/conversations'

export function ConversationAttachments({ owner, disabled }: { owner: ConversationOwner; disabled: boolean }) {
  const { t } = useI18n()
  const key = conversationOwnerKey(owner)
  const input = useRef<HTMLInputElement>(null)
  const items = useStore(useMemo(() => computed($conversationAttachments, rows => rows[key]), [key]))
  const error = useStore(useMemo(() => computed($conversationUploadErrors, rows => rows[key]), [key]))
  const draft = useStore(useMemo(() => computed($conversationDrafts, rows => rows[key]), [key]))
  useEffect(() => {
    for (const item of items ?? []) {
      if (item.status === 'ready' && item.attachment && !draft?.attachmentIds.includes(item.attachment.id)) {
        removeConversationAttachment(owner, item.localId)
      }
    }
  }, [items, draft?.attachmentIds, owner])

  return (
    <div className="space-y-2">
      {error && <p role="alert">{error}</p>}
      <input
        aria-label={t.composer.attach}
        className="hidden"
        disabled={disabled}
        multiple
        onChange={event => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''

          for (const file of files) {
            void uploadConversationAttachment(owner, file)
          }
        }}
        ref={input}
        type="file"
      />
      <Button
        aria-label={t.composer.attach}
        disabled={disabled}
        onClick={() => input.current?.click()}
        size="sm"
        type="button"
        variant="ghost"
      >
        <Plus />
        {t.composer.attach}
      </Button>
      <div className="flex flex-wrap gap-2" data-slot="composer-attachments">
        {(items ?? []).map(item => (
          <div className="flex items-center gap-1 rounded-md border px-2 py-1 text-sm" key={item.localId}>
            {item.status === 'uploading' ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <FileText className="size-3" />
            )}
            <span>{item.attachment?.filename ?? item.file.name}</span>
            {item.status === 'uploading' && <span role="status">{t.composer.conversation.uploading}</span>}
            {item.status === 'error' && (
              <>
                <span role="alert">{item.error}</span>
                <Button
                  onClick={() => void uploadConversationAttachment(owner, item.file, item.localId)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {t.composer.conversation.refresh}
                </Button>
              </>
            )}
            <Button
              aria-label={t.composer.removeAttachment(item.file.name)}
              onClick={() => removeConversationAttachment(owner, item.localId)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
