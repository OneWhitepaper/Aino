import type {
  ConversationContentRef,
  ConversationEvent,
  ConversationReactionState
} from '@hermes/shared/gateway-events'
import { useEffect, useMemo, useRef, useState } from 'react'

import { ReadAloudButtonSurface } from '@/components/assistant-ui/thread/assistant-message'
import { MessageActionButtons } from '@/components/assistant-ui/thread/message-action-buttons'
import { ReactionPicker } from '@/components/assistant-ui/thread/message-reactions'
import { UserEditBubble, UserEditSubmitButton } from '@/components/assistant-ui/thread/user-edit-surface'
import { HumanMessageContainer } from '@/components/assistant-ui/thread/user-message'
import { TooltipIconButton } from '@/components/assistant-ui/tooltip-icon-button'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { Pencil, SmilePlusIcon } from '@/lib/icons'
import { isSubmitEnter } from '@/lib/ime'
import { type ConversationOwner, conversationOwnerKey } from '@/store/conversation-owner'
import { conversationRuntime } from '@/store/conversation-runtime'

import { createConversationActions } from './conversation-actions'
import { readConversationContent } from './conversation-content'
import { createConversationHistoryActions } from './conversation-history-actions'

export interface ConversationMessageActionsProps {
  owner: ConversationOwner
  event: ConversationEvent
  disabled: boolean
  reaction?: ConversationReactionState
  onReact: (eventId: string, emoji: string | null) => Promise<void>
  onOpen?: (owner: ConversationOwner) => void
}

export function ConversationMessageActions({
  owner,
  event,
  disabled,
  reaction,
  onReact,
  onOpen
}: ConversationMessageActionsProps) {
  const { t } = useI18n()
  const copy = t.assistant.thread
  const key = conversationOwnerKey(owner)
  const actions = useMemo(() => createConversationHistoryActions(owner), [key])
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)
  const mounted = useRef(true)
  // eslint-disable-next-line no-restricted-syntax -- lifecycle cancellation flag, not a mirrored reactive value
  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
    }
  }, [])

  async function getText() {
    if (event.payload.content_status === 'referenced' && event.payload.content_ref) {
      return new TextDecoder().decode(
        await readConversationContent(owner, event.payload.content_ref as ConversationContentRef)
      )
    }

    return typeof event.payload.text === 'string' ? event.payload.text : ''
  }

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)

    try {
      await operation()
    } catch (reason) {
      if (mounted.current) {
        setError(String(reason))
      }
    } finally {
      if (mounted.current) {
        setBusy(false)
      }
    }
  }

  async function branch(editText?: string) {
    const target = await actions.branch(event, editText)

    if (mounted.current) {
      onOpen?.(target)
    }

    if (editText !== undefined) {
      const targetActions = createConversationActions(target)
      await targetActions.load()
      await targetActions.submit()
    }
  }

  const locked = disabled || busy

  return (
    <>
      {editing && (
        <HumanMessageContainer>
          <UserEditBubble data-expanded="true">
            <textarea
              aria-label={copy.editMessage}
              autoFocus
              className="ui-prompt-input-editor__input min-h-16 max-h-48 w-full resize-none bg-transparent p-0 pr-7 outline-none"
              disabled={locked}
              onChange={event => setText(event.target.value)}
              onKeyDown={event => {
                if (isSubmitEnter(event)) {
                  event.preventDefault()
                  void run(() => branch(text))
                } else if (event.key === 'Escape' && !busy) {
                  setEditing(false)
                }
              }}
              value={text}
            />
            <UserEditSubmitButton
              disabled={locked || (!text.trim() && !(event.payload.attachments as unknown[] | undefined)?.length)}
              onSubmit={() => void run(() => branch(text))}
              submitting={busy}
            />
            <Button disabled={busy} onClick={() => setEditing(false)} size="sm" variant="ghost">
              {t.common.cancel}
            </Button>
          </UserEditBubble>
        </HumanMessageContainer>
      )}
      <div className="flex items-center justify-end gap-1.5 py-1.5" data-slot="aui_msg-actions">
        {event.kind === 'conversation.input' && onOpen && (
          <TooltipIconButton
            disabled={locked}
            onClick={() =>
              void run(async () => {
                setText(await getText())
                setEditing(true)
              })
            }
            tooltip={copy.editMessage}
          >
            <Pencil className="size-3.5" />
          </TooltipIconButton>
        )}
        <MessageActionButtons
          disabled={locked}
          getMessageText={getText}
          onBranch={onOpen ? () => void run(() => branch()) : undefined}
          onRegenerate={
            event.kind === 'conversation.response' &&
            ['settled', 'failed', 'cancelled'].includes(String(event.payload.status))
              ? () => void run(() => actions.regenerate(event))
              : undefined
          }
          readAloud={
            event.kind === 'conversation.response' &&
            conversationRuntime(owner).snapshot?.participants.find(
              item => item.participant.participant_id === event.actor.id
            ) ? (
              <ReadAloudButtonSurface
                getText={getText}
                isCurrent={() => mounted.current}
                messageId={`${key}:${event.event_id}`}
                scope={{
                  connectionId: owner.connectionId,
                  profile: conversationRuntime(owner).snapshot!.participants.find(
                    item => item.participant.participant_id === event.actor.id
                  )!.participant.profile
                }}
              />
            ) : undefined
          }
        />
        <ReactionPicker
          onOpenChange={setPicker}
          onSelect={emoji => {
            setPicker(false)
            void run(() =>
              onReact(
                event.event_id,
                reaction?.reactions.some(row => row.author === 'user' && row.emoji === emoji) ? null : emoji
              )
            )
          }}
          open={picker}
          selected={reaction?.reactions.find(row => row.author === 'user')?.emoji}
        >
          <TooltipIconButton
            data-reacted={Boolean(reaction?.reactions.length) || undefined}
            data-slot="aui_msg-reactions"
            disabled={busy || !reaction}
            onClick={() => setPicker(true)}
            tooltip={copy.react}
          >
            {reaction?.reactions.length ? (
              <span>{reaction.reactions.map(row => row.emoji).join(' ')}</span>
            ) : (
              <SmilePlusIcon className="size-3.5" />
            )}
          </TooltipIconButton>
        </ReactionPicker>
      </div>
      {error && <p role="alert">{error}</p>}
    </>
  )
}
