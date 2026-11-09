import { host, randomUuid, respondPluginGroupModelRequests, useValue } from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'

import type { CanonicalGroupEvent } from './canonical-group-history'
import { useCanonicalGroupLabels } from './canonical-group-labels'
import { forgetCanonicalGroup, syncCanonicalGroupName } from './canonical-group-registry'
import { prepareCanonicalGroupSend, readCanonicalGroupSend, retireCanonicalGroupSend } from './canonical-group-send'
import type { PreparedCanonicalGroupSend } from './canonical-group-send'
import { CanonicalGroupSurface, type CanonicalGroupSurfaceState } from './canonical-group-surface'
import { actCanonicalGroup, canonicalGroupRequest } from './canonical-groups'
import type { CanonicalGroupBinding, CanonicalPendingAction } from './canonical-groups'
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

const sameGroupPayload = (payload: Record<string, unknown>, text: string, attachments: Attachment[]) =>
  payload.text === text && JSON.stringify(payload.attachments ?? []) === JSON.stringify(attachments)

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
  const [state, setState] = useState<CanonicalGroupSurfaceState | null>(null)
  const [events, setEvents] = useState<RoomEvent[]>([])
  const [error, setError] = useState('')
  const [readError, setReadError] = useState('')
  const [composerKey] = useState(() => canonicalGroupComposerDraftKey(binding))
  const [composerDraft, setComposerDraft] = useState(() => groupComposerDraftSnapshot(composerKey))
  const [uploading, setUploading] = useState(false)
  const [restored, setRestored] = useState(false)
  const [pending, setPending] = useState<PreparedCanonicalGroupSend | null>(null)
  // Only a journal entry found on mount is "restored"; this window's own in-flight send also sets `pending`.
  const [restoredPending, setRestoredPending] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const alive = useRef(true)
  const revision = useRef(0)
  const historySequence = useRef<number | undefined>(undefined)
  // Pending intent is a separate durable record; displaying it must not replace
  // this window's unsent text when another window prepared that intent.
  const draft = pending ? String(pending.params.payload.text ?? '') : composerDraft.main

  const attachments = pending
    ? ((pending.params.payload.attachments as Attachment[] | undefined) ?? [])
    : (composerDraft.canonicalAttachments ?? [])

  const setDraft = (text: string) =>
    setComposerDraft(updateGroupComposerDraft(composerKey, current => ({ ...current, main: text })))

  const setAttachments = (value: Attachment[]) => {
    // Upload replies may outlive this pane or its account-owned cache lifetime.
    if (!alive.current || canonicalGroupComposerDraftKey(binding) !== composerKey) {
      return
    }

    setComposerDraft(updateGroupComposerDraft(composerKey, current => ({ ...current, canonicalAttachments: value })))
  }

  // eslint-disable-next-line no-restricted-syntax -- journal hydration and mounted lifetime, not a reactive store mirror
  useEffect(() => {
    alive.current = true
    let cancelled = false
    void readCanonicalGroupSend(binding)
      .then(entry => {
        if (cancelled) {
          return
        }

        if (entry) {
          setPending(entry)
          setRestoredPending(true)
        }

        setRestored(true)
      })
      .catch(e => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
        }
      })

    return () => {
      cancelled = true
      alive.current = false
      // eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate the latest request counter; this ref is not a DOM node
      revision.current++
    }
  }, [binding])

  const refresh = async (includeHistory = true) => {
    const version = ++revision.current

    const snapshot = await canonicalGroupRequest<CanonicalGroupSurfaceState>(binding, 'groups.state', {
      room_id: binding.roomId
    })

    if (snapshot.model_requests?.length) {
      await respondPluginGroupModelRequests({ ...binding, targetProfile: binding.profile },
        (method, params) => canonicalGroupRequest(binding, method, params),
        binding.roomId, snapshot.room.members, snapshot.model_requests)
    }

    if (!includeHistory || (snapshot.room.latest_seq !== undefined && historySequence.current === snapshot.room.latest_seq)) {
      if (alive.current && version === revision.current) {
        syncCanonicalGroupName(binding, snapshot.room.name)
        setState(snapshot)
        setReadError('')
      }

      return snapshot
    }

    const log: RoomEvent[] = []
    let cursor = 0

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
      historySequence.current = snapshot.room.latest_seq
      syncCanonicalGroupName(binding, snapshot.room.name)
      setState(snapshot)
      setEvents(log)
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
        try { await settle() }
        catch (e) { if (alive.current) {setReadError(e instanceof Error ? e.message : String(e))} }
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

  const send = () => {
    if (
      !restored ||
      busyRef.current ||
      uploading ||
      !state?.driver_status ||
      state.room.disbanded_at ||
      (!pending && !draft.trim() && !attachments.length)
    ) {
      return
    }

    void mutate(async () => {
      const before = groupComposerDraftSnapshot(composerKey)
      const exact = pending ?? (await prepareCanonicalGroupSend(binding, { text: draft, attachments }))

      if (!alive.current) {
        return
      }

      setPending(exact)
      await canonicalGroupRequest(exact.binding, 'groups.send', exact.params)
      await retireCanonicalGroupSend(exact.binding, exact.params.event_id)

      // An ACK retires only the exact draft it sent, even if the pane was
      // parked meanwhile. A newer edit or another window's intent keeps ours.
      const current = groupComposerDraftSnapshot(composerKey)

      const next = current.revision === before.revision &&
        sameGroupPayload(exact.params.payload, before.main, before.canonicalAttachments ?? [])
        ? updateGroupComposerDraft(composerKey, value => ({ ...value, main: '', canonicalAttachments: [] }))
        : current

      if (alive.current) {
        setPending(null)
        setRestoredPending(false)
        setComposerDraft(next)
      }
    }).catch(() => undefined)
  }

  const act = (action: CanonicalPendingAction, choice?: 'once' | 'deny') =>
    mutate(() => actCanonicalGroup(binding, action, choice))

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

  return (
    <CanonicalGroupSurface
      attachments={attachments}
      binding={binding}
      busy={busy}
      draft={draft}
      error={error}
      events={events}
      mainTab={mainTab}
      onAction={act}
      onAttachmentsChange={setAttachments}
      onBack={showBack ? onBack : undefined}
      onDisband={end}
      onDraftChange={setDraft}
      onRefresh={() =>
        void refresh().catch(e => {
          if (alive.current) {
            setReadError(String(e))
          }
        })
      }
      onRename={rename}
      onSend={send}
      onStop={() =>
        void mutate(() =>
          canonicalGroupRequest(binding, 'groups.stop', { room_id: binding.roomId, cancel_id: randomUuid() })
        ).catch(() => undefined)
      }
      onUploadingChange={setUploading}
      pending={!!pending}
      readError={readError}
      restored={restored}
      restoredPending={restoredPending}
      state={state}
      uploading={uploading}
      visible={visible}
    />
  )
}
