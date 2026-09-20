import { useStore } from '@nanostores/react'
import { computed } from 'nanostores'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { isSubmitEnter } from '@/lib/ime'
import { $conversationAttachments } from '@/store/conversation-attachments'
import { conversationOwnerKey } from '@/store/conversation-owner'
import { $conversationRuntime } from '@/store/conversation-runtime'
import { $conversationDrafts, setConversationDraft } from '@/store/conversations'

import { ConversationAttachments } from './conversation-attachments'
import { type ConversationComposerContext, selectConversationExpert } from './expert-selection'
import { ExpertSelector } from './expert-selector'
import { ComposerInputSurface } from './input-surface'
import { ComposerSubmitButton } from './submit-button'

export interface ConversationComposerProps extends ConversationComposerContext {
  busy: boolean
  submitting: boolean
  unavailable: boolean
  onSubmit: () => void
}

/** Minimal composer shares the design-system input/actions; session slash/queue middleware is deliberately session-owned. */
export function ConversationComposer({
  owner,
  participants,
  busy,
  submitting,
  unavailable,
  onSubmit
}: ConversationComposerProps) {
  const { t } = useI18n()
  const key = conversationOwnerKey(owner)
  const draft = useStore(useMemo(() => computed($conversationDrafts, rows => rows[key]), [key]))

  const model = useStore(
    useMemo(
      () =>
        computed(
          [$conversationRuntime, $conversationDrafts],
          (runtimes, drafts) => runtimes[key]?.runtimes[drafts[key]?.selectedParticipantId ?? '']?.model_snapshot
        ),
      [key]
    )
  )

  const uploads = useStore(useMemo(() => computed($conversationAttachments, rows => rows[key]), [key]))
  const [mentions, setMentions] = useState(false)
  const selected = participants.find(option => option.id === draft?.selectedParticipantId)

  const disabled =
    !draft ||
    unavailable ||
    !selected ||
    Boolean(selected.unavailableReason) ||
    submitting ||
    busy ||
    Boolean(uploads?.some(item => item.status !== 'ready')) ||
    (!draft.text.trim() && draft.attachmentIds.length === 0)

  const updateText = (text: string) => {
    if (draft) {
      setConversationDraft(owner, { ...draft, text })
    }
  }

  return (
    <form
      className="space-y-2 border-t p-4"
      onSubmit={event => {
        event.preventDefault()

        if (!disabled) {
          onSubmit()
        }
      }}
    >
      <div className="flex items-center gap-2">
        <ExpertSelector owner={owner} participants={participants} />
        <Button
          aria-label={t.composer.conversation.mention}
          onClick={() => setMentions(value => !value)}
          type="button"
          variant="ghost"
        >
          {' '}
          @{' '}
        </Button>
      </div>
      {mentions && (
        <div
          aria-label={t.composer.expertSelector.choose}
          className="max-h-48 overflow-auto rounded-md border"
          role="listbox"
        >
          {participants.map(option => (
            <button
              aria-selected={option.id === draft?.selectedParticipantId}
              className="block w-full px-3 py-2 text-left disabled:opacity-50"
              disabled={Boolean(option.unavailableReason)}
              key={option.id}
              onClick={() => {
                selectConversationExpert({ owner, participants }, option.id)
                setMentions(false)
              }}
              role="option"
              title={option.unavailableReason || option.sourceId}
              type="button"
            >
              {option.displayName} · {option.sourceLabel}
            </button>
          ))}
        </div>
      )}
      <ConversationAttachments disabled={!draft || unavailable || submitting} owner={owner} />
      <ComposerInputSurface
        aria-label={t.composer.message}
        className="min-h-16 rounded-md border px-2"
        disabled={!draft}
        kind="plain"
        onChange={event => updateText(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            setMentions(false)
          }

          if (isSubmitEnter(event) && !event.shiftKey) {
            event.preventDefault()

            if (!disabled) {
              onSubmit()
            }
          }
        }}
        value={draft?.text ?? ''}
      />
      <p className="text-xs text-(--ui-text-tertiary)">
        {model?.model
          ? [model.model, model.provider, model.model_source].filter(Boolean).join(' · ')
          : t.composer.conversation.modelUnavailable}
      </p>
      {selected?.unavailableReason && <p role="alert">{selected.unavailableReason}</p>}
      <p className="text-xs text-(--ui-text-tertiary)">{t.composer.conversation.textOnly}</p>
      <ComposerSubmitButton disabled={disabled} />
    </form>
  )
}
