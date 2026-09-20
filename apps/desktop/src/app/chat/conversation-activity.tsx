import { ToolEntrySurface } from '@/components/assistant-ui/tool/fallback'
import { MarkdownTextContent } from '@/components/assistant-ui/markdown-text'
import { AssistantMessageContent } from '@/components/assistant-ui/thread/assistant-message'
import { conversationOwnerKey } from '@/store/conversation-owner'
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
  return (
    <div className="space-y-3">
      {Object.entries(runtime.activities).map(([key, activity]) => (
        <section data-turn-id={activity.coordinates.turn_id} key={key}>
          {!activity.finalEventId && activity.text && (
            <div className="whitespace-pre-wrap">
              <strong>{participantName(activity.coordinates.participant_id)}</strong>
              <AssistantMessageContent>
                <MarkdownTextContent text={activity.text} isRunning previewOnly disableArtifacts />
              </AssistantMessageContent>
            </div>
          )}
          {activity.events
            .filter((event, index, events) => {
              if (event.type !== 'tool.start' && event.type !== 'tool.complete') return false
              const id = (event.payload as { tool_id?: string }).tool_id
              return (
                !id ||
                !events
                  .slice(index + 1)
                  .some(
                    later => later.type === 'tool.complete' && (later.payload as { tool_id?: string }).tool_id === id
                  )
              )
            })
            .map((event, index) => {
              const payload = event.payload as {
                name?: string
                tool_id?: string
                summary?: string
                result_text?: string
                args?: unknown
                is_error?: boolean
              }
              return (
                <div
                  key={`${event.seq ?? index}:${event.type}`}
                  aria-label={`${participantName(activity.coordinates.participant_id)} · ${payload?.name}`}
                >
                  <ToolEntrySurface
                    scoped
                    messageId={`${conversationOwnerKey(owner)}:${key}:${event.seq ?? index}`}
                    messageRunning={event.type === 'tool.start' && !activity.finalEventId}
                    part={{
                      type: 'tool-call',
                      toolName: payload.name ?? 'tool',
                      toolCallId: payload.tool_id,
                      args: payload.args,
                      result:
                        event.type === 'tool.complete' ? (payload.result_text ?? payload.summary ?? '') : undefined,
                      isError: payload.is_error
                    }}
                  />
                </div>
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
