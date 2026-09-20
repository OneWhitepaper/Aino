import type { ConversationActivityCoordinates, SubagentSnapshot } from '@hermes/shared/gateway-events'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import type { ConversationOwner } from '@/store/conversation-owner'

import { controlConversationChild } from './conversation-runtime-controls'

interface ConversationChildProps {
  owner: ConversationOwner
  coordinates?: ConversationActivityCoordinates | null
  child: SubagentSnapshot
  participantName: string
  refresh: () => Promise<unknown>
}

export function ConversationChild({ owner, coordinates, child, participantName, refresh }: ConversationChildProps) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const live = Boolean(coordinates) && (child.status === 'running' || child.status === 'queued')

  const control = async (kind: 'steer' | 'interrupt') => {
    if (!coordinates) {
      return
    }

    setWorking(true)

    try {
      const result = await controlConversationChild(
        owner,
        coordinates,
        child.subagent_id,
        kind === 'steer' ? { kind, text } : { kind }
      )

      const accepted = 'status' in result ? result.status === 'queued' : result.found

      if (!accepted) {
        throw new Error(t.agents.requestRejected)
      }

      setNotice(kind === 'steer' ? t.agents.steerQueued : t.agents.stopRequested)

      if (kind === 'steer') {
        setText('')
      }

      await refresh()
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setWorking(false)
    }
  }

  return (
    <section
      className="space-y-2 border-l pl-3"
      data-subagent-id={child.subagent_id}
      style={{ marginInlineStart: `${Math.min(child.depth ?? 0, 6) * 12}px` }}
    >
      <p>
        {participantName} · {t.composer.conversation.subagent} · {child.status}
      </p>
      <p>{child.goal}</p>
      <small>
        {child.model}
        {child.last_tool ? ` · ${child.last_tool}` : ''}
      </small>
      {live && (
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label={t.agents.steerPlaceholder}
            disabled={working || !coordinates || child.accepting_steer === false}
            onChange={event => setText(event.target.value)}
            value={text}
          />
          <Button
            disabled={working || !coordinates || !text.trim() || child.accepting_steer === false}
            onClick={() => void control('steer')}
          >
            {t.agents.steer}
          </Button>
          <Button disabled={working || !coordinates} onClick={() => void control('interrupt')} variant="outline">
            {t.composer.stop}
          </Button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  )
}
