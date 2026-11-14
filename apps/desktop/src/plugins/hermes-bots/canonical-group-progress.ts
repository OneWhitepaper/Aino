import type { CanonicalGroupEvent } from './canonical-group-history'
import type { CanonicalGroupBinding } from './canonical-groups'

/** A reply is a committed member message; room task totals span all history. */
export function canonicalCompletedReplies(
  events: CanonicalGroupEvent[],
  binding: CanonicalGroupBinding
): number | undefined {
  const unique = new Map<string, CanonicalGroupEvent>()

  for (const event of events) {
    if (!event.room_id || event.room_id === binding.roomId) {
      unique.set(event.event_id || `seq:${event.seq}`, event)
    }
  }

  const ordered = [...unique.values()].sort((a, b) => a.seq - b.seq)
  const source = replySource(ordered)

  return source ? completedRepliesForSource(ordered, source) : undefined
}

function replySource(ordered: CanonicalGroupEvent[]): CanonicalGroupEvent | undefined {
  const pending = new Map<string, CanonicalGroupEvent>()
  let latest: CanonicalGroupEvent | undefined

  for (const event of ordered) {
    if (event.kind === 'message.user') {
      latest = event

      if (event.event_id && event.payload.thread_id) {
        pending.set(event.payload.thread_id, event)
      }
    } else if (event.kind === 'room.stop_requested' || event.kind === 'room.disbanded') {
      pending.clear()
    } else if (event.kind === 'room.activity' && ['settled', 'bounded'].includes(event.payload.status || '')) {
      const thread = event.payload.thread_id

      if (thread && pending.get(thread)?.event_id === event.payload.discussion_event_id) {
        pending.delete(thread)
      }
    }
  }

  // The live status does not name its thread, so overlapping unfinished
  // threads cannot truthfully share one "current message" counter.
  if (pending.size > 1) {
    return undefined
  }

  if (latest && (!latest.event_id || !latest.payload.thread_id)) {
    return undefined
  }

  const source = pending.size ? [...pending.values()][0] : latest

  if (!source?.event_id || !source.payload.thread_id) {
    return undefined
  }

  return source
}

function completedRepliesForSource(ordered: CanonicalGroupEvent[], source: CanonicalGroupEvent): number {
  const related = ordered.filter(
    event =>
      event.seq > source.seq &&
      event.payload.discussion_event_id === source.event_id &&
      event.payload.thread_id === source.payload.thread_id
  )

  const messages = new Map(
    related.filter(event => event.kind === 'message.member' && event.event_id).map(event => [event.event_id, event])
  )

  const replies = new Set<string>()

  for (const event of related) {
    if (event.kind !== 'turn.settled' || event.payload.passed !== false) {
      continue
    }

    const message = messages.get(event.payload.message_event_id)

    if (
      message &&
      event.payload.member_id &&
      (message.payload.member_id || message.actor?.id) === event.payload.member_id
    ) {
      replies.add(event.payload.task_id || message.event_id!)
    }
  }

  return replies.size
}
