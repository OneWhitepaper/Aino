import { host, LruCache, randomUuid, respondPluginGroupModelRequests, useValue } from '@hermes/plugin-sdk'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useCanonicalRoomLive, useSameValue } from './canonical-group-activity'
import { useGroupMethods } from './canonical-group-capabilities'
import { holdCanonicalRoomLive, publishCanonicalRoomLive } from './canonical-group-details'
import type { CanonicalGroupEvent } from './canonical-group-history'
import { useCanonicalGroupLabels } from './canonical-group-labels'
import { markRoomLead } from './canonical-group-lead'
import { useCanonicalMembers } from './canonical-group-members'
import { peerRenewalBeforeSend, usePeerRenewal } from './canonical-group-peer-join'
import { forgetCanonicalGroup, registerCanonicalGroup, syncCanonicalGroupName } from './canonical-group-registry'
import {
  attemptCanonicalGroupSend,
  prepareCanonicalGroupSend,
  readCanonicalGroupSend,
  replaceCanonicalGroupSend,
  retireCanonicalGroupSend,
  withdrawCanonicalGroupSend
} from './canonical-group-send'
import type { PreparedCanonicalGroupSend } from './canonical-group-send'
import { useCanonicalGroupSendRecovery } from './canonical-group-send-recovery'
import { CanonicalGroupSurface, type CanonicalGroupSurfaceState } from './canonical-group-surface'
import {
  actCanonicalGroup,
  canonicalGroupProfileRoute,
  canonicalGroupRequest,
  disbandCanonicalGroup
} from './canonical-groups'
import type {
  CanonicalGroupBinding,
  CanonicalPendingAction,
  CanonicalRoom,
  CanonicalRoomMember
} from './canonical-groups'
import {
  $groupComposerDraftEpoch,
  canonicalGroupComposerDraftKey,
  groupComposerDraftSnapshot,
  updateGroupComposerDraft
} from './group-panes'
import { retainRouteSocket } from './route-lease'

type RoomEvent = CanonicalGroupEvent
interface Attachment {
  attachment_id?: string
  event_id?: string
  kind: string
  name: string
  mime: string
  size?: number
}
interface RoomReply {
  member?: CanonicalRoomMember
  name: string
  quote: string
  thread?: string
}
interface Words {
  text: string
  attachments: Attachment[]
}
interface SendRun {
  stopped: boolean
  posted: boolean
  settled: Promise<boolean>
}
type RoomState = CanonicalGroupSurfaceState & { change_events?: boolean }

const sameGroupPayload = (payload: Record<string, unknown>, text: string, attachments: Attachment[], thread?: string) =>
  payload.text === text &&
  JSON.stringify(payload.attachments ?? []) === JSON.stringify(attachments) &&
  // Preparing mints a thread for a new conversation, so only a reply's thread must match.
  (thread === undefined || payload.thread_id === thread)

// A backend that broadcasts groups.changed (groups.state says change_events) moves the view on push; the
// poll is then only a backstop for a lost signal. Older backends keep the 2 s poll.
const ROOM_POLL_MS = 2000
const ROOM_BACKSTOP_MS = 15_000

/** One room read: `current` settles when it ends, `next` is the one read queued behind it, `answered` once its
 *  groups.state reply is in. */
type RoomRead = { current: Promise<void>; next?: Promise<void>; answered?: boolean }

/** The events of one groups.log page read after `cursor`, or null when the page would leave a hole. The log
 *  is append-only with one seq per event, so a page applies only from cursor+1 on: an event the view already
 *  holds is skipped, and a gap is refused, so the view is always a prefix of the room log. */
export function roomLogPageAfter<T extends { seq: number }>(cursor: number, page: readonly T[]): null | T[] {
  const fresh = page.filter(event => event.seq > cursor)

  return fresh.every((event, index) => event.seq === cursor + index + 1) ? fresh : null
}

const canSendNow = (gate: {
  restored: boolean
  busy: boolean
  stopping: boolean
  uploading: boolean
  pending: boolean
  draft: string
  attachments: number
  driver: boolean
}) =>
  gate.restored &&
  !gate.busy &&
  !gate.stopping &&
  !gate.uploading &&
  gate.driver &&
  (gate.pending || !!gate.draft.trim() || gate.attachments > 0)

// Both groups.send dispatchers mark a refusal raised before the user event committed (and only
// that) `admitted: false`: proof that this request posted nothing. A reason or code alone is not:
// the same `invalid_params` or 4111 can follow a committed event.
const admittedNothing = (error: unknown) =>
  (error as { data?: { admitted?: unknown } } | null)?.data?.admitted === false

interface HeldDraft {
  text: string
  attachments: Attachment[]
  reply: RoomReply | null
}

/** Words already held (from an earlier converged Send) are this window's own and never replaced:
 *  newer words join them, so both come back once the room's intent is finished with. */
function holdDraft(held: HeldDraft | null, next: HeldDraft): HeldDraft {
  if (!held) {
    return next
  }

  const ids = new Set(held.attachments.map(attachment => attachment.attachment_id))

  return {
    text: [held.text, next.text].filter(text => text.trim()).join('\n\n'),
    attachments: [
      ...held.attachments,
      ...next.attachments.filter(attachment => !attachment.attachment_id || !ids.has(attachment.attachment_id))
    ],
    reply: held.reply
  }
}

/** A Send is delivered only by a receipt for this exact intent. */
function confirmSend(result: unknown, eventId: string, unconfirmed: string) {
  const receipt = result as { accepted?: unknown; client_event_id?: unknown } | null

  if (
    !receipt ||
    typeof receipt !== 'object' ||
    Array.isArray(receipt) ||
    (Object.hasOwn(receipt, 'accepted') && receipt.accepted !== true) ||
    receipt.client_event_id !== eventId
  ) {
    throw new Error(unconfirmed)
  }
}

const NO_MEMBERS: CanonicalRoomMember[] = []

export function CanonicalGroupWorkspace({
  binding,
  mainTab = false,
  visible = true,
  onBack,
  onReplaced,
  showBack = true
}: {
  binding: CanonicalGroupBinding
  mainTab?: boolean
  visible?: boolean
  onBack?: () => void
  onReplaced?: (key: string) => void
  showBack?: boolean
}) {
  const draftEpoch = useValue($groupComposerDraftEpoch)

  // Remount on identity changes: old polls and pending confirmations never cross rooms.
  return (
    <CanonicalRoomView
      binding={binding}
      key={JSON.stringify([draftEpoch, binding.connectionId, binding.profile, binding.roomId])}
      mainTab={mainTab}
      onBack={onBack}
      onReplaced={onReplaced}
      showBack={showBack}
      visible={visible}
    />
  )
}

function CanonicalRoomView({
  binding: initialBinding,
  mainTab,
  visible,
  onBack,
  onReplaced,
  showBack
}: {
  binding: CanonicalGroupBinding
  mainTab: boolean
  visible: boolean
  onBack?: () => void
  onReplaced?: (key: string) => void
  showBack: boolean
}) {
  const [binding] = useState(() => ({ ...initialBinding }))
  const labels = useCanonicalGroupLabels()
  const methods = useGroupMethods(binding, visible)
  const [state, setState] = useState<RoomState | null>(null)
  const [events, setEvents] = useState<RoomEvent[]>([])
  const [error, setError] = useState('')
  const [readError, setReadError] = useState('')
  const [composerKey] = useState(() => canonicalGroupComposerDraftKey(binding))
  const [composerDraft, setComposerDraft] = useState(() => groupComposerDraftSnapshot(composerKey))
  const [uploading, setUploading] = useState(false)
  const [restored, setRestored] = useState(false)
  const [journalError, setJournalError] = useState('')
  const [journalAttempt, setJournalAttempt] = useState(0)
  const [pending, setPending] = useState<PreparedCanonicalGroupSend | null>(null)
  // Only a journal entry found on mount is "restored"; this window's own in-flight send also sets `pending`.
  const [restoredPending, setRestoredPending] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const alive = useRef(true)
  const [stopping, setStopping] = useState(false)
  const stopPending = useRef(false)
  // One cancellation intent survives uncertain replies until new work starts or Stop is confirmed.
  const stopIntent = useRef<string | null>(null)
  const [notice, setNotice] = useState('')
  const [sendHint, setSendHint] = useState('')
  const revision = useRef(0)
  // This window's typed draft while it sends the room's one pending intent another window prepared.
  const heldDraft = useRef<HeldDraft | null>(composerDraft.canonicalHeld ?? null)
  const [reply, setReplyValue] = useState<RoomReply | null>(composerDraft.canonicalReply ?? null)
  // A handed-back journal entry keeps its thread even without a visible reply chip.
  const draftThread = useRef<string | undefined>(undefined)
  // An intent handed back for editing (nothing of it admitted): the next Send replaces it.
  const editing = useRef<string | null>(null)
  // A delivered intent whose journal cleanup failed: retired before the next Send may prepare.
  const delivered = useRef<string | null>(null)
  // The Send in progress, which a Stop pressed now must cover; `settled` says whether it may have posted.
  const sending = useRef<SendRun | null>(null)

  const draft = pending ? String(pending.params.payload.text ?? '') : composerDraft.main

  const attachments = pending
    ? ((pending.params.payload.attachments as Attachment[] | undefined) ?? [])
    : (composerDraft.canonicalAttachments ?? [])

  const sentDraft = useRef<{ revision: number; payload: Record<string, unknown> } | null>(null)
  const ownsDraft = () => canonicalGroupComposerDraftKey(binding) === composerKey

  const setDraft = (value: string | ((text: string) => string)) => {
    if (!alive.current || !ownsDraft()) {
      return
    }

    setComposerDraft(
      updateGroupComposerDraft(composerKey, current => ({
        ...current,
        main: typeof value === 'function' ? value(current.main) : value
      }))
    )
  }

  const setAttachments = (value: Attachment[]) => {
    if (!alive.current || !ownsDraft()) {
      return
    }

    setComposerDraft(updateGroupComposerDraft(composerKey, current => ({ ...current, canonicalAttachments: value })))
  }

  const setReply = (value: RoomReply | null | ((current: RoomReply | null) => RoomReply | null)) => {
    if (!alive.current || !ownsDraft()) {
      return
    }

    const next = updateGroupComposerDraft(composerKey, current => ({
      ...current,
      canonicalReply: typeof value === 'function' ? value(current.canonicalReply ?? null) : value
    }))

    setReplyValue(next.canonicalReply ?? null)
    setComposerDraft(next)
  }

  const holdWords = (value: HeldDraft) => {
    heldDraft.current = holdDraft(heldDraft.current, value)

    if (ownsDraft()) {
      setComposerDraft(
        updateGroupComposerDraft(composerKey, current => ({ ...current, canonicalHeld: heldDraft.current }))
      )
    }
  }

  // eslint-disable-next-line no-restricted-syntax -- mounted lifetime, not a reactive store mirror
  useEffect(() => {
    alive.current = true

    return () => {
      alive.current = false
      revision.current++
    }
  }, [])

  // Send stays locked until the journal is read: a pending intent must never be sent twice. A
  // failed read only reads again; it never writes, so a journal that recovers keeps its intent.
  // eslint-disable-next-line no-restricted-syntax -- journal hydration, not a reactive store mirror
  useEffect(() => {
    let cancelled = false
    setJournalError('')
    void readCanonicalGroupSend(binding)
      .then(entry => {
        if (cancelled) {
          return
        }

        // An intent handed back for editing (nothing of it in the room) reopens as an editable draft.
        if (entry?.handedBack) {
          editing.current = entry.params.event_id
        } else if (entry) {
          setPending(entry)
          setRestoredPending(true)
        }

        if (entry) {
          draftThread.current = entry.params.payload.thread_id as string | undefined

          if (entry.handedBack && !groupComposerDraftSnapshot(composerKey).main.trim()) {
            setDraft(String(entry.params.payload.text ?? ''))
            setAttachments((entry.params.payload.attachments as Attachment[] | undefined) ?? [])
          }
        }

        setRestored(true)
      })
      .catch(e => {
        if (!cancelled) {
          setJournalError(e instanceof Error ? e.message : String(e))
        }
      })

    return () => {
      cancelled = true
    }
  }, [binding, journalAttempt])

  const readFailure = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)

    return /timed out|timeout/i.test(message)
      ? labels.readTimedOut
      : [labels.readTimedOut, labels.invalidLogCursor].includes(message)
        ? message
        : labels.groupsUnreachable
  }

  // The applied log and its authority epoch, read only after its last seq (the cursor): a refresh asks for what
  // is new, not the whole room.
  const applied = useRef<{ epoch?: number; log: RoomEvent[] }>({ log: [] })
  const changeEvents = useRef(false)
  const latestDriver = useRef<RoomState['driver_status']>(undefined)

  // One room read at a time for every caller (poll, push, a mutation's settle, Refresh, settings saved). A call
  // during a read queues ONE read after it (shared by every caller that lands meanwhile) and resolves when that
  // read ends, so a caller never waits for a busy room to fall quiet and no two reads overlap. A mutation's
  // settle drops the read in flight (refreshAfterChange).
  // `answered`: its groups.state reply is in, so a reconnect from here on may have lost pushes it did not see.
  const reading = useRef<RoomRead | null>(null)
  // The shown view's poll timer: every read clears it when it starts and re-arms it when it ends.
  const pollTimer = useRef<{ started: () => void; ended: (failed: boolean) => void } | null>(null)

  const refresh = (): Promise<void> => {
    const flight = reading.current

    if (flight) {
      flight.next ??= flight.current.catch(() => undefined).then(() => (alive.current ? refresh() : undefined))

      return flight.next
    }

    // Published before its first request goes out, so an event that request causes (its own dial's
    // gateway.ready) already sees it in flight; `current` settles as the read does.
    let settle!: (outcome: Promise<void>) => void

    const read: RoomRead = {
      current: new Promise<void>(resolve => {
        settle = resolve
      })
    }

    reading.current = read
    pollTimer.current?.started()
    settle(
      readRoom(read)
        .then(
          () => {
            pollTimer.current?.ended(false)
          },
          error => {
            pollTimer.current?.ended(true)

            throw new Error(readFailure(error), { cause: error })
          }
        )
        .finally(() => {
          if (reading.current === read) {
            reading.current = null
          }
        })
    )

    return read.current
  }

  // After a mutation: a read in flight started before it, so its answer is dropped and one more read follows.
  const refreshAfterChange = () => {
    revision.current++

    return refresh()
  }

  // The log pages after `cursor`, each validated to start right after the last: collected, then joined onto
  // the applied prefix once instead of recopied per page.
  const readLogAfter = async (cursor: number) => {
    const pages: RoomEvent[][] = []

    for (;;) {
      const page = await canonicalGroupRequest<{ events: RoomEvent[]; has_more?: boolean }>(binding, 'groups.log', {
        room_id: binding.roomId,
        since_seq: cursor,
        limit: 100
      })

      const fresh = roomLogPageAfter(cursor, page.events)

      // A hole, or a page that says there is more but brings nothing: the cursor cannot move.
      if (!fresh || (page.has_more && !fresh.length)) {
        throw new Error(labels.invalidLogCursor)
      }

      if (fresh.length) {
        pages.push(fresh)
        cursor = fresh[fresh.length - 1].seq
      }

      if (!page.has_more) {
        return pages
      }
    }
  }

  const readRoom = async (read: RoomRead) => {
    const version = ++revision.current
    const snapshot = await canonicalGroupRequest<RoomState>(binding, 'groups.state', { room_id: binding.roomId })
    read.answered = true

    if (snapshot.model_requests?.length) {
      await respondPluginGroupModelRequests(
        { ...binding, targetProfile: binding.profile },
        (method, params) => canonicalGroupRequest(binding, method, params),
        binding.roomId,
        snapshot.room.members,
        snapshot.model_requests
      )
    }

    const { authority_epoch: epoch, latest_seq: latest } = snapshot.room ?? {}
    const base = applied.current
    // The log only grows within one authority epoch. A new epoch (the room re-hosted) or a log behind the view
    // starts it again, even when the new log is as long as the old.
    let log = epoch !== base.epoch || (latest ?? Infinity) < (base.log.at(-1)?.seq ?? 0) ? [] : base.log

    // A state that names no event past the cursor (a status-only push, an idle backstop) reads no log page.
    // An append after the state read moves next_seq, so its own push (or the backstop) brings it.
    const cursor = log.at(-1)?.seq ?? 0
    const pages = !visible || latest === cursor ? [] : await readLogAfter(cursor)

    // Nothing new keeps the same array: status-only pushes and backstop polls allocate nothing per event.
    log = pages.length ? log.concat(...pages) : log

    if (alive.current && version === revision.current) {
      // An unchanged log keeps its identity, so the derived history (handoffs, outcomes) is not recomputed.
      applied.current = { epoch, log }
      changeEvents.current = snapshot.change_events === true
      latestDriver.current = snapshot.driver_status
      syncCanonicalGroupName(binding, snapshot.room.name)
      setState(snapshot)

      // The stop notice tells people to use Retry or Discard on kept turns: it stays while any wait.
      if (
        snapshot.driver_status &&
        !snapshot.driver_status.working &&
        !snapshot.driver_status.counts?.stopping &&
        !snapshot.driver_status.pending_actions?.length
      ) {
        setNotice(current => (current === 'stopped' ? '' : current))
      }

      setEvents(log)
      setReadError('')
    }
  }

  // eslint-disable-next-line no-restricted-syntax -- the shown view's poll timer, socket lease and push listeners
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let release: (() => void) | null = null

    const poll = () => {
      void refresh().catch(e => {
        if (!cancelled) {
          setReadError(readFailure(e))
        }
      })
    }

    // A read that ends re-arms the one timer, so a push mid-wait restarts the wait. The slow backstop needs
    // pushes that can arrive: a backend that sends them, and the route's socket held open (the lease, below).
    // A failed read (the route may be down, so its pushes are lost too) retries on the fast poll, whoever
    // started it; each fast read dials the route, and that ready asks for a missing lease again.
    pollTimer.current = {
      started: () => clearTimeout(timer),
      ended: failed => {
        clearTimeout(timer)
        timer = setTimeout(
          poll,
          visible && changeEvents.current && release && !failed
            ? ROOM_BACKSTOP_MS
            : visible && latestDriver.current?.working
              ? 750
              : ROOM_POLL_MS
        )
      }
    }

    // groups.changed only reaches this window over an open socket to the room's backend; a secondary
    // route's socket (a local room under a remote primary, too) otherwise closes between reads, and the
    // slow backstop would then be the only update. A lease that lands after the view closed is let go; one
    // that failed is asked for again when the route reconnects.
    let leasing = false

    const lease = () => {
      if (release || leasing) {
        return
      }

      leasing = true
      void retainRouteSocket(canonicalGroupProfileRoute(binding)).then(granted => {
        leasing = false

        if (cancelled) {
          granted?.()
        } else {
          release = granted
        }
      })
    }

    // An untagged event comes from the local/legacy primary socket, which may carry this room's route too.
    const fromThisRoute = (event: unknown) => {
      const source = String((event as { connectionId?: string }).connectionId || '').trim()

      return !source || source === binding.connectionId
    }

    // One naming rooms refreshes only their views (no list: something process-wide moved). The same broadcast
    // reaches this window once per socket open to its backend: a broadcast_id this view already read for is a
    // copy, and queues no second read. A push without one (an older backend) always reads.
    const seenBroadcasts = new LruCache<string, true>(64) // copies land ms apart: a short memory is enough

    const unsubscribe =
      typeof host.onEvent === 'function'
        ? host.onEvent('groups.changed', event => {
            const { room_ids: rooms, broadcast_id: id } =
              (event as { payload?: { room_ids?: unknown; broadcast_id?: unknown } }).payload ?? {}

            if (cancelled || !fromThisRoute(event) || (Array.isArray(rooms) && !rooms.includes(binding.roomId))) {
              return
            }

            if (typeof id === 'string' && id) {
              if (seenBroadcasts.has(id)) {
                return
              }

              seenBroadcasts.set(id, true)
            }

            poll()
          })
        : undefined

    // A reconnect loses every push sent while the route's socket was down: re-read now, not at the backstop.
    // A read dials the route itself: a gateway.ready before its groups.state reply is the read's own dial. One
    // after the reply is a real reconnect the read may have missed, but only while the lease holds the socket
    // open: without it every request (the read's log pages too) redials, so a ready during an answered read
    // is its own dial again, re-reading on it would loop, and no push could have reached a closed socket.
    const unsubscribeReady =
      typeof host.onEvent === 'function'
        ? host.onEvent('gateway.ready', event => {
            if (cancelled || !fromThisRoute(event)) {
              return
            }

            lease()

            if (!reading.current || (reading.current.answered && release)) {
              poll()
            }
          })
        : undefined

    lease()
    poll()

    return () => {
      cancelled = true
      revision.current++
      clearTimeout(timer)
      pollTimer.current = null
      unsubscribe?.()
      unsubscribeReady?.()
      release?.()
    }
    // The keyed parent freezes the authority binding for this lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const mutate = async (operation: () => Promise<unknown>, settle: () => unknown = refreshAfterChange) => {
    if (busyRef.current) {
      throw new Error(labels.groupWorking)
    }

    busyRef.current = true
    setBusy(true)
    setError('')

    try {
      await operation()

      if (alive.current) {
        // The mutation is already acknowledged. A failed read must not invite
        // another destructive write with a now-stale execution generation.
        try {
          await settle()
        } catch (e) {
          if (alive.current) {
            const failure = e instanceof Error && e.cause instanceof Error ? e.cause : e
            setReadError(failure instanceof Error ? failure.message : String(failure))
          }
        }
      }
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : String(e))
      }

      // ConfirmDialog must retain a rejected destructive action and its exact snapshot.
      throw e
    } finally {
      busyRef.current = false

      if (alive.current) {
        setBusy(false)
      }
    }
  }

  // The room's intent is finished with: this window's own words come back, else nothing.
  const releaseComposer = () => {
    if (!ownsDraft()) {
      return
    }

    const current = groupComposerDraftSnapshot(composerKey)
    const sent = sentDraft.current

    const held = heldDraft.current
    const canRetire = sent && current.revision === sent.revision
    const same = sent && sameGroupPayload(sent.payload, current.main, current.canonicalAttachments ?? [])

    const next =
      canRetire && (held || same)
        ? updateGroupComposerDraft(composerKey, value => ({
            ...value,
            main: held?.text ?? '',
            canonicalAttachments: held?.attachments ?? [],
            canonicalReply: held?.reply ?? null,
            canonicalHeld: null
          }))
        : current

    heldDraft.current = null
    draftThread.current = next.canonicalReply?.thread
    sentDraft.current = null

    if (alive.current) {
      setPending(null)
      setReplyValue(next.canonicalReply ?? null)
      setRestoredPending(false)
      setComposerDraft(next)
    }
  }

  const releaseAbandoned = (entry: PreparedCanonicalGroupSend, draftRevision: number) => {
    const current = groupComposerDraftSnapshot(composerKey)

    const same =
      current.revision === draftRevision &&
      sameGroupPayload(
        entry.params.payload,
        current.main,
        current.canonicalAttachments ?? [],
        current.canonicalReply?.thread
      )

    const own = same
      ? { text: '', attachments: [], reply: null }
      : { text: current.main, attachments: current.canonicalAttachments ?? [], reply: current.canonicalReply ?? null }

    const held = current.canonicalHeld ?? heldDraft.current

    const words =
      held &&
      (held.reply?.thread !== own.reply?.thread ||
        !sameGroupPayload({ text: held.text, attachments: held.attachments }, own.text, own.attachments))
        ? holdDraft(held, own)
        : own

    const next = updateGroupComposerDraft(composerKey, value => ({
      ...value,
      main: words.text,
      canonicalAttachments: words.attachments,
      canonicalReply: words.reply,
      canonicalHeld: null
    }))

    heldDraft.current = null
    sentDraft.current = null
    editing.current = null
    draftThread.current = next.canonicalReply?.thread
    setPending(null)
    setRestoredPending(false)
    setComposerDraft(next)
    setReplyValue(next.canonicalReply ?? null)
    setError('')
    setSendHint('')
    setNotice(labels.retryAbandoned)
  }

  const recovery = useCanonicalGroupSendRecovery({
    pending,
    composerKey,
    visible,
    labels,
    blocked: busy || stopping || uploading,
    isCurrent: () => alive.current && ownsDraft(),
    onAbandoned: releaseAbandoned,
    onError: setError
  })

  // Another window finished with this intent: resending it could post it twice, and so could
  // offering its words as a new message.
  const finishedElsewhere = () => {
    releaseComposer()
    setSendHint(labels.sendSettledElsewhere)
  }

  // A request of the intent provably posted nothing (`left`: requests that still may have, null when
  // another window finished with it). With none left its words come back for editing while the
  // journal keeps them, until a Send replaces them; this window's own held words wait until then.
  const settleUnsent = (
    exact: PreparedCanonicalGroupSend,
    words: Words,
    left: null | number | undefined,
    hint: string
  ) => {
    if (left === null) {
      finishedElsewhere()
    } else if (left === 0) {
      editing.current = exact.params.event_id
      draftThread.current = exact.params.payload.thread_id as string | undefined
      setReply(current => (current?.thread === draftThread.current ? current : null))
      setPending(null)
      setRestoredPending(false)
      setDraft(words.text)
      setAttachments(words.attachments)
      setSendHint(hint)
    } else {
      setSendHint(labels.sendMaybe)
    }
  }

  // Without the gateway's proof the request may have posted: Retry resends this exact intent,
  // which the gateway recognizes, so it is never posted twice. A proven refusal is fully explained
  // by the hint beside the restored draft; its raw reason code (`invalid_params`) is not shown.
  const settleFailedSend = async (exact: PreparedCanonicalGroupSend, words: Words, run: SendRun, error: unknown) => {
    run.posted = !admittedNothing(error)

    const left = run.posted
      ? undefined
      : await withdrawCanonicalGroupSend(exact.binding, exact.params.event_id).catch(() => undefined)

    if (alive.current) {
      const preparation = (error as { data?: { preparation_message?: unknown } } | null)?.data?.preparation_message
      settleUnsent(
        exact,
        words,
        left,
        typeof preparation === 'string' && preparation.trim() ? preparation : labels.sendRefused
      )
    }

    if (run.posted) {
      throw error
    }
  }

  const retireDeliveredIntent = async () => {
    if (!pending && delivered.current) {
      await retireCanonicalGroupSend(binding, delivered.current)
      delivered.current = null
    }
  }

  const sendIntent = async (run: SendRun) => {
    await retireDeliveredIntent()
    const typed = { text: draft, attachments, thread_id: reply?.thread ?? draftThread.current }
    const replacing = editing.current

    const exact =
      pending ??
      (replacing
        ? await replaceCanonicalGroupSend(binding, replacing, typed)
        : await prepareCanonicalGroupSend(binding, typed))

    editing.current = null

    if (!alive.current) {
      return
    }

    if (!exact) {
      // Another window finished with the intent being edited: these words may already be posted.
      setSendHint(labels.sendSettledElsewhere)

      return
    }

    // Another window won the room's slot: send its intent first, keep this window's words.
    if (!pending && !sameGroupPayload(exact.params.payload, draft, attachments, reply?.thread)) {
      holdWords({ ...typed, reply })
    }

    const words = {
      text: String(exact.params.payload.text ?? ''),
      attachments: (exact.params.payload.attachments as Attachment[] | undefined) ?? []
    }

    sentDraft.current = { revision: groupComposerDraftSnapshot(composerKey).revision, payload: exact.params.payload }
    setPending(exact)
    // The durable intent is saved before a peer renewal; Stop can hold it back.
    await peerRenewalBeforeSend(exact.binding, state, methods)

    if (!alive.current) {
      return
    }

    if ((await attemptCanonicalGroupSend(exact.binding, exact.params.event_id)) === null) {
      if (alive.current) {
        finishedElsewhere()
      }

      return
    }

    if (run.stopped) {
      // Stop came first: this request never leaves.
      const left = await withdrawCanonicalGroupSend(exact.binding, exact.params.event_id)

      if (alive.current) {
        settleUnsent(exact, words, left, labels.sendStopped)
      }

      return
    }

    run.posted = true

    try {
      confirmSend(
        await canonicalGroupRequest(exact.binding, 'groups.send', exact.params),
        exact.params.event_id,
        labels.unconfirmedSend
      )
    } catch (error) {
      return settleFailedSend(exact, words, run, error)
    }

    // A valid receipt is authoritative: a failed cleanup only defers it to this window's next Send.
    await retireCanonicalGroupSend(exact.binding, exact.params.event_id).catch(error => {
      delivered.current = exact.params.event_id
      console.warn('[canonical-group-send]', error)
    })

    releaseComposer()
  }

  const send = () => {
    // A Stop still fencing behind the last Send would cancel this one too: it waits until Stop is done.
    if (
      !restored ||
      busyRef.current ||
      recovery.confirming ||
      stopPending.current ||
      uploading ||
      !state?.driver_status ||
      state.room.disbanded_at ||
      (!pending && !draft.trim() && !attachments.length)
    ) {
      return
    }

    stopIntent.current = null
    setSendHint('')
    setNotice('')
    let settle!: (mayHavePosted: boolean) => void

    const run: SendRun = {
      stopped: false,
      posted: false,
      settled: new Promise<boolean>(resolve => {
        settle = resolve
      })
    }

    sending.current = run
    void mutate(() =>
      sendIntent(run).finally(() => {
        if (sending.current === run) {
          sending.current = null
        }

        settle(run.posted)
      })
    ).catch(() => undefined)
  }

  const requestStop = async (fresh = false) => {
    if (fresh) {
      stopIntent.current = null
    }

    const cancelId = (stopIntent.current ??= randomUuid())

    const result = await canonicalGroupRequest<{ cancelled?: unknown } | undefined>(binding, 'groups.stop', {
      room_id: binding.roomId,
      cancel_id: cancelId
    })

    const cancelled = result?.cancelled

    if (typeof cancelled !== 'number' || !Number.isSafeInteger(cancelled) || cancelled < 0) {
      throw new Error(labels.pendingActionUnconfirmed)
    }

    if (stopIntent.current === cancelId) {
      stopIntent.current = null
    }

    return cancelled
  }

  // Stop has its own busy state: it stays available while a Send is in flight, and covers it. A
  // Send not yet sent is held back; one on the wire may post after this fence, so once it settles
  // (unless it provably posted nothing) a fresh cancel_id fences again behind it.
  const stop = async () => {
    if (stopPending.current) {
      return
    }

    stopPending.current = true
    const covered = sending.current

    if (covered) {
      covered.stopped = true
    }

    setStopping(true)
    setNotice('')
    setError('')

    try {
      // A retried Stop replays its lost id, which covers only work up to that first fence.
      const replay = stopIntent.current !== null
      const first = requestStop()
      first.catch(() => undefined)

      let cancelled =
        covered && (await covered.settled) ? (await first.catch(() => 0)) + (await requestStop(true)) : await first

      // The replay stopped nothing while the room still works: that work came after its fence.
      if (replay && !cancelled && state?.driver_status?.working) {
        cancelled = await requestStop(true)
      }

      if (alive.current) {
        setNotice('stopped')
        await refreshAfterChange()
      }
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      stopPending.current = false

      if (alive.current) {
        setStopping(false)
      }
    }
  }

  const continueDiscussion = (discussionEventId: string) =>
    mutate(() =>
      canonicalGroupRequest(binding, 'groups.continue', {
        room_id: binding.roomId,
        discussion_event_id: discussionEventId
      })
    ).catch(() => undefined)

  const act = (action: CanonicalPendingAction, choice?: 'once' | 'deny') =>
    mutate(() => {
      if (action.kind === 'retry') {
        stopIntent.current = null
      }

      return actCanonicalGroup(binding, action, choice).catch(error => {
        const reasons = new Map([
          ['session_busy', labels.discardStopPending],
          // Older members use the same reason as a network failure, with this detail on the wire.
          [
            'peer_unreachable',
            typeof error?.data?.detail === 'string' &&
            error.data.detail.includes('gateway is too old to confirm this turn never started')
              ? labels.discardPeerUpdateRequired
              : labels.discardPeerUnreachable
          ]
        ])

        const message =
          action.kind === 'discard'
            ? reasons.get(error?.data?.reason)
            : action.kind === 'retry' && error?.data?.reason === 'session_busy'
              ? labels.retryBusy
              : undefined

        const member = state?.room.members?.find(member => member.member_id === action.member_id)

        throw message ? new Error(message.replace('{name}', member ? nameFor(member) : labels.memberGeneric)) : error
      })
    })

  const rename = (name: string) =>
    void mutate(async () => {
      const { room } = await canonicalGroupRequest<{ room: CanonicalRoom }>(binding, 'groups.rename', {
        room_id: binding.roomId,
        event_id: randomUuid(),
        name
      })

      registerCanonicalGroup(binding, room)
    }).catch(() => undefined)

  // Rejects so ConfirmDialog stays open with the error; a disbanded room no longer reads back, so leave it.
  const end = async () => {
    if (!(await disbandCanonicalGroup(binding, labels))) {
      throw new Error(labels.disbandUnconfirmed)
    }

    if (alive.current) {
      onBack?.()
    }

    forgetCanonicalGroup(binding)
    host.notify({ kind: 'success', message: labels.disbanded(state?.room.name || binding.roomName || '') })
  }

  usePeerRenewal(binding, state, methods, visible)
  const driver = state?.driver_status
  const members = useSameValue(state?.room.members ?? NO_MEMBERS)
  const { nameFor } = useCanonicalMembers(binding)

  const surfaceState = useMemo(
    () => (state ? { ...state, room: { ...state.room, members: markRoomLead(members, state.context) } } : null),
    [state, members]
  )

  const { statuses, working } = useCanonicalRoomLive(events, driver, members, reply?.thread)
  useEffect(() => holdCanonicalRoomLive(binding), [binding])
  useEffect(() => {
    publishCanonicalRoomLive(binding, {
      working,
      failed: [...statuses.values()].some(status => status.kind === 'failed' || status.kind === 'unavailable'),
      needsYou: !!driver?.pending_actions?.length,
      updatedAt: state?.room.updated_at === undefined ? undefined : state.room.updated_at * 1000,
      workerProfiles: [
        ...new Set(members.filter(member => (member.target?.kind ?? 'local') === 'local').map(member => member.profile))
      ].sort()
    })
  })

  const replyTo = (
    member: CanonicalRoomMember | undefined,
    text: string,
    thread: string | undefined,
    author: string
  ) => {
    setReply({
      member,
      name: member ? nameFor(member) : author,
      quote:
        text
          .split('\n')
          .map(line => line.trim())
          .find(Boolean) ?? '',
      thread
    })

    if (member) {
      const tag = `@${member.handle}`
      setDraft(current => (current.trimStart().startsWith(tag) ? current : `${tag} ${current}`))
    }
  }

  return (
    <>
      <CanonicalGroupSurface
        attachments={attachments}
        binding={binding}
        busy={busy || recovery.confirming}
        draft={draft}
        error={error}
        events={events}
        journalError={journalError}
        mainTab={mainTab}
        methods={methods}
        notice={notice === 'stopped' ? labels.stopped : notice}
        onAbandonRetry={recovery.begin}
        onAction={act}
        onAttachmentsChange={setAttachments}
        onBack={showBack ? onBack : undefined}
        onCancelReply={() => {
          draftThread.current = undefined
          setReply(null)
        }}
        onContinue={continueDiscussion}
        onDisband={end}
        onDraftChange={setDraft}
        onJournalReload={() => setJournalAttempt(value => value + 1)}
        onRefresh={() => void refresh().catch(e => setReadError(readFailure(e)))}
        onRename={rename}
        onReplaced={onReplaced}
        onReply={replyTo}
        onSend={send}
        onStop={() => void stop()}
        onUploadingChange={setUploading}
        pending={!!pending}
        readError={readError}
        reply={reply}
        restored={restored}
        restoredPending={restoredPending}
        sendHint={sendHint}
        sending={!!sending.current}
        state={surfaceState}
        stopping={stopping}
        uploading={uploading}
        visible={visible}
      />
      {recovery.confirmation}
    </>
  )
}
