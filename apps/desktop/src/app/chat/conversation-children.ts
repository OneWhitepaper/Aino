import type {
  ConversationActivityCoordinates,
  SubagentEventPayload,
  SubagentSnapshot,
  SubagentStatus
} from '@hermes/shared/gateway-events'

import type { ConversationRuntime } from '@/store/conversation-runtime'

interface ConversationChildRow {
  key: string
  child: SubagentSnapshot
  coordinates: ConversationActivityCoordinates
  controlCoordinates?: ConversationActivityCoordinates
  summary?: string
}
const terminal = new Set<SubagentStatus>(['completed', 'failed', 'error', 'timeout', 'interrupted'])

const lifecycleTypes = new Set([
  'subagent.spawn_requested',
  'subagent.start',
  'subagent.progress',
  'subagent.thinking',
  'subagent.tool',
  'subagent.complete'
])

const childKey = (coordinates: ConversationActivityCoordinates, id: string) =>
  JSON.stringify([coordinates.participant_id, coordinates.session_generation, coordinates.runtime_id, id])

/** Completed children often disappear from the live registry before the next snapshot; retained activity owns their history. */
export function conversationChildren(runtime: ConversationRuntime): ConversationChildRow[] {
  const rows = new Map<string, ConversationChildRow>()

  for (const activity of Object.values(runtime.activities)) {
    for (const event of activity.events) {
      if (!lifecycleTypes.has(event.type)) {
        continue
      }

      const payload = event.payload as SubagentEventPayload | undefined

      if (!payload?.subagent_id) {
        continue
      }

      const key = childKey(activity.coordinates, payload.subagent_id)
      const previous = rows.get(key)
      const completed = event.type === 'subagent.complete'

      const status = completed
        ? payload.status && terminal.has(payload.status)
          ? payload.status
          : 'failed'
        : (payload.status ?? (event.type === 'subagent.spawn_requested' ? 'queued' : 'running'))

      rows.set(key, {
        key,
        coordinates: previous?.coordinates ?? activity.coordinates,
        child: {
          ...previous?.child,
          subagent_id: payload.subagent_id,
          ...(payload.goal ? { goal: payload.goal } : {}),
          ...(payload.model ? { model: payload.model } : {}),
          ...(payload.parent_id ? { parent_id: payload.parent_id } : {}),
          ...(payload.depth != null ? { depth: payload.depth } : {}),
          ...(payload.tool_name ? { last_tool: payload.tool_name } : {}),
          ...(payload.tool_count != null ? { tool_count: payload.tool_count } : {}),
          status: previous?.child.status && terminal.has(previous.child.status) ? previous.child.status : status
        },
        summary: payload.summary || (completed ? payload.text : undefined) || previous?.summary
      })
    }
  }

  for (const [participantId, snapshot] of Object.entries(runtime.runtimes)) {
    const coordinates = snapshot.activity ?? snapshot.background_activities[0]

    if (!coordinates || coordinates.participant_id !== participantId) {
      continue
    }

    for (const child of snapshot.subagents) {
      const key = childKey(coordinates, child.subagent_id)
      const previous = rows.get(key)
      const settled = previous?.child.status && terminal.has(previous.child.status)
      rows.set(key, {
        ...previous,
        key,
        coordinates: previous?.coordinates ?? coordinates,
        child: settled ? previous.child : { ...previous?.child, ...child },
        // Retained history can never authorize a control; the current snapshot must still own the child.
        controlCoordinates:
          !settled && (child.status === 'running' || child.status === 'queued') ? coordinates : undefined
      })
    }
  }

  return [...rows.values()]
}
