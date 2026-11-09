import { host, randomUuid, respondPluginGroupModelRequests, useValue } from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'

import { useCanonicalRoomLive } from './canonical-group-activity'
import { useGroupMethods } from './canonical-group-capabilities'
import { holdCanonicalRoomLive, publishCanonicalRoomLive } from './canonical-group-details'
import type { CanonicalGroupEvent } from './canonical-group-history'
import { useCanonicalGroupLabels } from './canonical-group-labels'
import { markRoomLead } from './canonical-group-lead'
import { useCanonicalMembers } from './canonical-group-members'
import { forgetCanonicalGroup, syncCanonicalGroupName } from './canonical-group-registry'
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
import { actCanonicalGroup, canonicalGroupRequest } from './canonical-groups'
import type { CanonicalGroupBinding, CanonicalPendingAction, CanonicalRoomMember } from './canonical-groups'
import {
  $groupComposerDraftEpoch,
  canonicalGroupComposerDraftKey,
  groupComposerDraftSnapshot,
  updateGroupComposerDraft
} from './group-panes'

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
type RoomState = CanonicalGroupSurfaceState

const sameGroupPayload = (payload: Record<string, unknown>, text: string, attachments: Attachment[], thread?: string) =>
  payload.text === text &&
  JSON.stringify(payload.attachments ?? []) === JSON.stringify(attachments) &&
  // Preparing mints a thread for a new conversation, so only a reply's thread must match.
  (thread === undefined || payload.thread_id === thread)

/** The durable log only grows: an unchanged length and last seq is the same log, so keep its identity
 *  and the derived history (handoffs, outcomes) is not recomputed on every poll. */
const sameLog = (current: readonly { seq: number }[], next: readonly { seq: number }[]) =>
  current.length === next.length && current.at(-1)?.seq === next.at(-1)?.seq

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

export function CanonicalGroupWorkspace({
  binding,
  mainTab = false,
  visible = true,
  onBack,
  showBack = true
}: {
  binding: CanonicalGroupBinding
  mainTab?: boolean
  visible?: boolean
  onBack?: () => void
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
  showBack
}: {
  binding: CanonicalGroupBinding
  mainTab: boolean
  visible: boolean
  onBack?: () => void
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
  // The log is append-only within one authority epoch: each poll reads only what is new.
  const seen = useRef<{ epoch?: number; seq: number }>({ seq: 0 })

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

  const refresh = async (includeHistory = true) => {
    const version = ++revision.current
    const snapshot = await canonicalGroupRequest<RoomState>(binding, 'groups.state', { room_id: binding.roomId })

    if (snapshot.model_requests?.length) {
      await respondPluginGroupModelRequests(
        { ...binding, targetProfile: binding.profile },
        (method, params) => canonicalGroupRequest(binding, method, params),
        binding.roomId,
        snapshot.room.members,
        snapshot.model_requests
      )
    }

    if (
      !includeHistory ||
      (snapshot.room.latest_seq !== undefined &&
        seen.current.epoch === snapshot.room.authority_epoch &&
        seen.current.seq === snapshot.room.latest_seq)
    ) {
      if (alive.current && version === revision.current) {
        syncCanonicalGroupName(binding, snapshot.room.name)
        setState(snapshot)
        setReadError('')
      }

      return snapshot
    }

    const { authority_epoch: epoch, latest_seq: latest } = snapshot.room ?? {}
    // A new authority epoch (or a log behind what was read) starts the log again.
    const fresh = epoch !== seen.current.epoch || (typeof latest === 'number' && latest < seen.current.seq)
    const since = fresh ? 0 : seen.current.seq
    const log: RoomEvent[] = []
    let cursor = since

    for (;;) {
      const page = await canonicalGroupRequest<{ events: RoomEvent[]; has_more?: boolean; next_seq?: number }>(
        binding,
        'groups.log',
        { room_id: binding.roomId, since_seq: cursor, limit: 100 }
      )
      log.push(...page.events)

      if (!page.has_more) {
        break
      }
      const next = page.events.at(-1)?.seq

      if (!next || next <= cursor) {
        throw new Error(labels.invalidLogCursor)
      }
      cursor = next
    }

    if (alive.current && version === revision.current) {
      seen.current = { epoch, seq: log.at(-1)?.seq ?? cursor }
      syncCanonicalGroupName(binding, snapshot.room.name)
      setState(snapshot)
      setEvents(current => {
        const next = fresh ? log : [...current, ...log.filter(event => event.seq > since)]

        return !fresh && sameLog(current, next) ? current : next
      })
      setReadError('')
    }

    return snapshot
  }

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const poll = async () => {
      let active = false

      try {
        // Hidden rooms retain a cheap control poll so a running member can
        // discover models after navigation; only visible rooms reload history.
        const snapshot = await refresh(visible)
        active = !!snapshot.driver_status?.working
      } catch (e) {
        if (!cancelled) {
          setReadError(String(e instanceof Error ? e.message : e))
        }
      }

      if (!cancelled) {
        timer = setTimeout(() => void poll(), visible && active ? 750 : 2000)
      }
    }

    void poll()

    return () => {
      cancelled = true
      // eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate the latest request counter; this ref is not a DOM node
      revision.current++
      clearTimeout(timer)
    }
    // The keyed parent freezes the authority binding for this lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const mutate = async (operation: () => Promise<unknown>, settle: () => unknown = refresh) => {
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
            setReadError(e instanceof Error ? e.message : String(e))
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
      settleUnsent(exact, words, left, labels.sendRefused)
    }

    if (run.posted) {
      throw error
    }
  }

  const sendIntent = async (run: SendRun) => {
    if (!pending && delivered.current) {
      await retireCanonicalGroupSend(binding, delivered.current)
      delivered.current = null
    }

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
        setNotice(cancelled ? labels.stopped : labels.nothingRunning)
        await refresh()
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

      return actCanonicalGroup(binding, action, choice)
    })

  const rename = (name: string) =>
    void mutate(() =>
      canonicalGroupRequest(binding, 'groups.rename', { room_id: binding.roomId, event_id: randomUuid(), name })
    ).catch(() => undefined)

  // Rejects so ConfirmDialog stays open with the error; a disbanded room no longer reads back, so leave it.
  const end = async () => {
    await canonicalGroupRequest(binding, 'groups.disband', { room_id: binding.roomId, cancel_id: randomUuid() })

    if (alive.current) {
      onBack?.()
    }
    forgetCanonicalGroup(binding)
    host.notify({ kind: 'success', message: labels.disbanded(state?.room.name || binding.roomName || '') })
  }

  const driver = state?.driver_status
  const members = state?.room.members ?? []
  const { nameFor } = useCanonicalMembers(binding)
  const { statuses, working } = useCanonicalRoomLive(events, driver, members, reply?.thread)
  useEffect(() => holdCanonicalRoomLive(binding), [binding])
  useEffect(() => {
    publishCanonicalRoomLive(binding, {
      working,
      failed: [...statuses.values()].some(status => status.kind === 'failed' || status.kind === 'unavailable'),
      needsYou: !!driver?.pending_actions?.length
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
        notice={notice}
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
        onRefresh={() => void refresh().catch(e => setReadError(String(e)))}
        onRename={rename}
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
        state={state ? { ...state, room: { ...state.room, members: markRoomLead(members, state.context) } } : null}
        stopping={stopping}
        uploading={uploading}
        visible={visible}
      />
      {recovery.confirmation}
    </>
  )
}
