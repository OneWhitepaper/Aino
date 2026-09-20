import { useI18n } from '@/i18n'
import type { ConversationOwner } from '@/store/conversation-owner'
import type { ConversationRuntime } from '@/store/conversation-runtime'

import { ConversationChild } from './conversation-child'
import { conversationChildren } from './conversation-children'
import { ConversationPendingRequest } from './conversation-pending-request'

interface ConversationActivityProps {
  owner: ConversationOwner
  refresh: () => Promise<unknown>
  runtime: ConversationRuntime
  participantName: (id: string) => string
  respond: (id: string, result: Record<string, unknown>) => void
}

export function ConversationActivity({ runtime, participantName, respond, owner, refresh }: ConversationActivityProps) {
  const { t } = useI18n()

  return (
    <div className="space-y-3">
      {Object.entries(runtime.activities).map(([key, activity]) => (
        <section data-turn-id={activity.coordinates.turn_id} key={key}>
          {!activity.finalEventId && activity.text && (
            <div className="whitespace-pre-wrap">
              <strong>{participantName(activity.coordinates.participant_id)}</strong>
              <p>{activity.text}</p>
            </div>
          )}
          {activity.events
            .filter(event => event.type === 'tool.start' || event.type === 'tool.complete')
            .map((event, index) => {
              const payload = event.payload as { name?: string; summary?: string; result_text?: string }

              return (
                <details key={`${event.seq ?? index}:${event.type}`}>
                  <summary>
                    {participantName(activity.coordinates.participant_id)} · {payload?.name} ·{' '}
                    {event.type === 'tool.start' ? t.desktop.activity.running : t.desktop.activity.completed}
                  </summary>
                  <pre className="whitespace-pre-wrap break-words">{payload?.summary || payload?.result_text}</pre>
                </details>
              )
            })}
        </section>
      ))}
      {conversationChildren(runtime).map(row => (
        <section
          data-participant-id={row.coordinates.participant_id}
          data-turn-id={row.coordinates.turn_id}
          key={row.key}
        >
          <ConversationChild
            child={row.child}
            coordinates={row.controlCoordinates}
            owner={owner}
            participantName={participantName(row.coordinates.participant_id)}
            refresh={refresh}
          />
          {row.summary && <p className="whitespace-pre-wrap text-sm">{row.summary}</p>}
        </section>
      ))}
      {Object.values(runtime.pendingRequests).map(request => (
        <div data-turn-id={request.coordinates.turn_id} key={request.id}>
          <p>{participantName(request.coordinates.participant_id)}</p>
          <ConversationPendingRequest owner={owner} refresh={refresh} request={request} respond={respond} />
        </div>
      ))}
    </div>
  )
}
