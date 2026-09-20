import { useStore } from '@nanostores/react'
import { computed } from 'nanostores'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { $conversationPrivateNotices, dismissConversationPrivateNotice } from '@/store/conversation-notices'
import { type ConversationOwner, conversationOwnerKey } from '@/store/conversation-owner'
import { $conversationRuntime } from '@/store/conversation-runtime'
import { $conversationDrafts } from '@/store/conversations'

import type { ParticipantOption } from './composer/expert-selection'

interface ConversationConfigurationProps {
  owner: ConversationOwner
  participants: ParticipantOption[]
  onRefresh: (participantId: string, generation: number) => Promise<unknown>
}
interface RefreshSelection {
  participantId: string
  displayName: string
  generation: number
}

export function ConversationConfiguration({ owner, participants, onRefresh }: ConversationConfigurationProps) {
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
    <aside aria-label={copy.privateNotice} className="max-h-72 shrink-0 space-y-2 overflow-y-auto border-t px-4 py-2">
      {notice && (
        <section className="space-y-2 rounded-md border p-3" data-private-conversation-notice>
          <div className="flex items-center justify-between gap-2">
            <strong>
              {copy.privateNotice} · {notice.displayName}
            </strong>
            <Button onClick={() => dismissConversationPrivateNotice(owner)} size="sm" type="button" variant="ghost">
              {t.common.close}
            </Button>
          </div>
          {notice.command && <code>{notice.command}</code>}
          <pre className="whitespace-pre-wrap break-words text-sm" role={notice.error ? 'alert' : undefined}>
            {notice.output}
          </pre>
          {notice.refreshRequired && (
            <>
              <p>{copy.refreshExplanation}</p>
              <Button
                disabled={blocked}
                onClick={() => askRefresh(notice.participantId)}
                type="button"
                variant="outline"
              >
                {copy.refreshConfiguration}
              </Button>
            </>
          )}
        </section>
      )}
      {confirmation ? (
        <div aria-label={copy.refreshConfiguration} className="space-y-2" role="group">
          <strong>{confirmation.displayName}</strong>
          <p className="text-sm">{copy.refreshExplanation}</p>
          <div className="flex gap-2">
            <Button disabled={blocked} onClick={() => void applyRefresh()} type="button">
              {t.common.apply}
            </Button>
            <Button
              disabled={runtime?.submitting}
              onClick={() => setConfirmation(null)}
              type="button"
              variant="outline"
            >
              {t.common.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          disabled={blocked || !selected || Boolean(selected.unavailableReason)}
          onClick={() => selected && askRefresh(selected.id)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {copy.refreshConfiguration}
        </Button>
      )}
    </aside>
  )
}
