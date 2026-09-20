import type { ConversationAttachment, ConversationContentRef, ConversationEvent } from '@hermes/shared/gateway-events'
import { useEffect, useState } from 'react'

import { MarkdownTextContent } from '@/components/assistant-ui/markdown-text'
import { UserMessageText } from '@/components/assistant-ui/thread/user-message-text'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { type ConversationOwner, conversationOwnerKey } from '@/store/conversation-owner'

import { readConversationContent } from './conversation-content'

function ReferencedAnswer({ owner, reference }: { owner: ConversationOwner; reference: ConversationContentRef }) {
  const { t } = useI18n()
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setText(null)
    setError(null)
    void readConversationContent(owner, reference, controller.signal)
      .then(bytes => {
        if (!controller.signal.aborted) {
          setText(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
        }
      })
      .catch(reason => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      })

    return () => controller.abort()
  }, [owner, reference, attempt])

  if (error) {
    return (
      <div>
        <p role="alert">{error}</p>
        <Button onClick={() => setAttempt(value => value + 1)} variant="outline">
          {t.composer.conversation.refresh}
        </Button>
      </div>
    )
  }

  if (text === null) {
    return <p role="status">{t.composer.conversation.contentLoading}</p>
  }

  return <MarkdownTextContent text={text} isRunning={false} previewOnly disableArtifacts />
}

function PublicAttachment({ owner, attachment }: { owner: ConversationOwner; attachment: ConversationAttachment }) {
  const { t } = useI18n()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const download = async () => {
    setWorking(true)
    setError(null)

    try {
      const bytes = await readConversationContent(owner, attachment.content_ref)
      const url = URL.createObjectURL(new Blob([bytes], { type: attachment.content_ref.mime_type }))
      const link = document.createElement('a')
      link.href = url
      link.download = attachment.filename
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div>
      <Button
        aria-label={`${t.composer.conversation.downloadAttachment}: ${attachment.filename}`}
        disabled={working}
        onClick={() => void download()}
        size="sm"
        variant="outline"
      >
        {attachment.filename}
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}

export function ConversationContentView({ owner, event }: { owner: ConversationOwner; event: ConversationEvent }) {
  const { t } = useI18n()
  const payload = event.payload
  const reference = payload.content_ref as ConversationContentRef | undefined
  const attachments = (Array.isArray(payload.attachments) ? payload.attachments : []) as ConversationAttachment[]

  return (
    <>
      {payload.content_status === 'referenced' ? (
        reference ? (
          <ReferencedAnswer
            key={`${conversationOwnerKey(owner)}:${event.event_id}`}
            owner={owner}
            reference={reference}
          />
        ) : (
          <p role="alert">{t.composer.conversation.contentInvalid}</p>
        )
      ) : (
        typeof payload.text === 'string' &&
        (event.kind === 'conversation.input' ? (
          <UserMessageText text={payload.text} />
        ) : (
          <MarkdownTextContent
            text={payload.text}
            isRunning={payload.status === 'streaming'}
            previewOnly
            disableArtifacts
          />
        ))
      )}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map(attachment => (
            <PublicAttachment attachment={attachment} key={attachment.id} owner={owner} />
          ))}
        </div>
      )}
    </>
  )
}
