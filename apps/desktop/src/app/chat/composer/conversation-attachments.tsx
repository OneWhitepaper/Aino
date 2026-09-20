import { UrlDialog } from './url-dialog'
import { useComposerUrlDialog } from './hooks/use-composer-url-dialog'
import { useStore } from '@nanostores/react'
import { computed } from 'nanostores'
import { useEffect, useMemo, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import {
  $conversationAttachments,
  $conversationUploadErrors,
  removeConversationAttachment,
  uploadConversationAttachment
} from '@/store/conversation-attachments'
import { type ConversationOwner, conversationOwnerKey } from '@/store/conversation-owner'
import { AttachmentList } from './attachments'
import { ContextMenu } from './context-menu'
import { $conversationDrafts } from '@/store/conversations'

export function ConversationAttachments({
  owner,
  disabled,
  onInsertText,
  presentation = 'all'
}: {
  owner: ConversationOwner
  disabled: boolean
  onInsertText?: (text: string) => void
  presentation?: 'all' | 'controls' | 'list'
}) {
  const { t } = useI18n()
  const key = conversationOwnerKey(owner)
  const input = useRef<HTMLInputElement>(null)
  const url = useComposerUrlDialog({ insertText: text => onInsertText?.(text), onAddUrl: text => onInsertText?.(text) })
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
    <div className="contents">
      {error && <p role="alert">{error}</p>}
      {presentation !== 'list' && (
        <>
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
          <ContextMenu
            state={{
              tools: { enabled: !disabled, label: t.composer.attach },
              model: { model: '', provider: '', canSwitch: false },
              voice: { active: false, enabled: false }
            }}
            onPickFiles={() => input.current?.click()}
            onPickImages={() => input.current?.click()}
            onInsertText={text => onInsertText?.(text)}
            onOpenUrlDialog={url.openUrlDialog}
            includeProviders={false}
          />
          <UrlDialog
            open={url.urlOpen}
            inputRef={url.urlInputRef}
            onChange={url.setUrlValue}
            onOpenChange={url.setUrlOpen}
            onSubmit={url.submitUrl}
            value={url.urlValue}
          />
        </>
      )}
      {presentation !== 'controls' && (
        <>
          <AttachmentList
            attachments={(items ?? []).map(item => ({
              id: item.localId,
              kind: 'file',
              label: item.attachment?.filename ?? item.file.name,
              detail: item.error,
              uploadState: item.status === 'ready' ? undefined : item.status
            }))}
            onPreview={null}
            onRemove={id => removeConversationAttachment(owner, id)}
          />
          {(items ?? [])
            .filter(item => item.status === 'error')
            .map(item => (
              <div key={item.localId}>
                <span role="alert">{item.error}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  onClick={() => void uploadConversationAttachment(owner, item.file, item.localId)}
                >
                  {t.composer.conversation.refresh}
                </Button>
              </div>
            ))}
        </>
      )}
    </div>
  )
}
