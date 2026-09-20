import { useStore } from '@nanostores/react'
import { computed } from 'nanostores'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useI18n } from '@/i18n'
import { $conversationPrivateNotices, dismissConversationPrivateNotice } from '@/store/conversation-notices'
import { type ConversationOwner, conversationOwnerKey } from '@/store/conversation-owner'
import { $conversationRuntime } from '@/store/conversation-runtime'
import { $conversationDrafts } from '@/store/conversations'

import type { ParticipantOption } from './composer/expert-selection'

interface ConversationConfigurationProps {
  noticesOnly?: boolean
  owner: ConversationOwner
  participants: ParticipantOption[]
  onRefresh: (participantId: string, generation: number) => Promise<unknown>
}
interface RefreshSelection {
  participantId: string
  displayName: string
  generation: number
}

export function ConversationConfiguration({
  owner,
  participants,
  onRefresh,
  noticesOnly = false
}: ConversationConfigurationProps) {
  const { t } = useI18n()
  const copy = t.composer.conversation
  const key = conversationOwnerKey(owner)
  const notice = useStore(useMemo(() => computed($conversationPrivateNotices, rows => rows[key]), [key]))
  const draft = useStore(useMemo(() => computed($conversationDrafts, rows => rows[key]), [key]))
  const runtime = useStore(useMemo(() => computed($conversationRuntime, rows => rows[key]), [key]))
  const [confirmation, setConfirmation] = useState<RefreshSelection | null>(null)
  const selected = participants.find(item => item.id === draft?.selectedParticipantId)
  const blocked = !runtime?.snapshot || runtime.busy || runtime.submitting || Boolean(runtime.uncertainSend)

  const askRefresh = (id: string) => {
    const target = participants.find(item => item.id === id)

    if (!target || target.unavailableReason || blocked) {
      return
    }

    const generation =
      runtime?.snapshot?.participants.find(item => item.participant.participant_id === id)?.session_generation ?? 1

    setConfirmation({ participantId: id, displayName: target.displayName, generation })
  }

  const applyRefresh = async () => {
    if (!confirmation) {
      return
    }

    try {
      await onRefresh(confirmation.participantId, confirmation.generation)
      setConfirmation(null)
    } catch {
      setConfirmation(null)
    } // The action retains the draft and publishes the exact failure privately.
  }

  return (
    <>
      {noticesOnly && notice && (
        <aside
          aria-label={copy.privateNotice}
          className="mb-3 max-h-72 w-full overflow-y-auto rounded-2xl bg-(--ui-chat-surface-background) p-4 shadow-nous"
          data-private-conversation-notice
        >
          <div className="flex items-center justify-between gap-2">
            <strong>
              {copy.privateNotice} · {notice.displayName}
            </strong>
            <Button
              aria-label={t.common.close}
              onClick={() => dismissConversationPrivateNotice(owner)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <Codicon name="close" />
            </Button>
          </div>
          {notice.command && <code>{notice.command}</code>}
          <pre className="whitespace-pre-wrap break-words text-sm" role={notice.error ? 'alert' : undefined}>
            {notice.output}
          </pre>
          {notice.refreshRequired && (
            <Button disabled={blocked} onClick={() => askRefresh(notice.participantId)} type="button" variant="ghost">
              {copy.refreshConfiguration}
            </Button>
          )}
        </aside>
      )}
      {!noticesOnly && (
        <Popover>
          <PopoverTrigger asChild>
            <Button aria-label={copy.refreshConfiguration} size="icon-xs" type="button" variant="ghost">
              <Codicon name="ellipsis" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" side="top">
            <Button
              disabled={blocked || !selected || Boolean(selected.unavailableReason)}
              onClick={() => selected && askRefresh(selected.id)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {copy.refreshConfiguration}
            </Button>
          </PopoverContent>
        </Popover>
      )}
      <ConfirmDialog
        confirmLabel={t.common.apply}
        description={copy.refreshExplanation}
        onClose={() => setConfirmation(null)}
        onConfirm={applyRefresh}
        open={Boolean(confirmation)}
        title={confirmation?.displayName}
      />
    </>
  )
}
