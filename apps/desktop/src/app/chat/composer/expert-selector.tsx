import { useStore } from '@nanostores/react'
import { computed } from 'nanostores'
import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { ChevronDown, X } from '@/lib/icons'
import { conversationOwnerKey } from '@/store/conversation-owner'
import { $conversationDrafts, $conversationRecords, setConversationDraft } from '@/store/conversations'

import { type ConversationComposerContext, selectConversationExpert } from './expert-selection'

export interface ExpertSelectorProps extends ConversationComposerContext {
  disabled?: boolean
}

export function ExpertSelector({ owner, participants, disabled = false }: ExpertSelectorProps) {
  const { t } = useI18n()
  const copy = t.composer.expertSelector
  const key = conversationOwnerKey(owner)

  const selectedId = useStore(
    useMemo(() => computed($conversationDrafts, drafts => drafts[key]?.selectedParticipantId), [key])
  )

  const general = useStore(useMemo(() => computed($conversationRecords, records => records[key]?.general), [key]))
  const selected = participants.find(option => option.id === selectedId)

  const label =
    selected?.displayName ?? (selectedId === general?.participant_id ? general?.display_name : copy.unavailable)

  const clear = () => {
    const draft = $conversationDrafts.get()[key]

    if (draft && general) {
      setConversationDraft(owner, { ...draft, selectedParticipantId: general.participant_id })
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-1" data-slot="expert-selector">
      <DropdownMenu key={key}>
        <DropdownMenuTrigger asChild>
          <Button aria-label={copy.choose} disabled={disabled || !selectedId} size="sm" type="button" variant="ghost">
            <span className="max-w-48 truncate">{label}</span>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-w-[calc(100vw-2rem)] min-w-56" side="top">
          <DropdownMenuLabel>{copy.nextReply}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            onValueChange={id => {
              selectConversationExpert({ owner, participants }, id)
            }}
            value={selectedId ?? ''}
          >
            {participants.map(participant => (
              <DropdownMenuRadioItem
                disabled={disabled || Boolean(participant.unavailableReason)}
                key={participant.id}
                textValue={`${participant.displayName} ${participant.sourceLabel}`}
                title={participant.sourceId}
                value={participant.id}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{participant.displayName}</span>
                  <span className="text-(--ui-text-tertiary)">{participant.sourceLabel}</span>
                  {participant.unavailableReason && (
                    <span className="whitespace-normal text-(--ui-text-secondary)">
                      {participant.unavailableReason}
                    </span>
                  )}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {selectedId && general && selectedId !== general.participant_id && (
        <Button
          aria-label={copy.clear}
          disabled={disabled}
          onClick={clear}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <X />
        </Button>
      )}
    </div>
  )
}
