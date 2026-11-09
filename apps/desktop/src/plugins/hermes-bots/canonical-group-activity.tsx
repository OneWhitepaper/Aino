import { Button, Codicon, GlyphSpinner } from '@hermes/plugin-sdk'
import { type ReactNode, useEffect, useState } from 'react'

import type { CanonicalGroupEvent } from './canonical-group-history'
import { CanonicalMemberAvatar, useCanonicalMembers } from './canonical-group-members'
import { canonicalCompletedReplies } from './canonical-group-progress'
import type { CanonicalGroupBinding, CanonicalPendingAction, CanonicalRoomMember } from './canonical-groups'
/** Only these live fields are published by `groups.state`. */
import { RoomBotAvatar } from './group-room-avatar'
import { focusThread, isBusyStatus, memberOutcomes, memberStatus, type MemberStatus, type RoomCycle, roomCycle, type RoomLogEvent, type RoomMemberActivity } from './group-room-status'
import { MemberStatusChip, ROOM_AVATAR_SIZE, RoomCycleFooter, type RoomStatusLabels, RoomTypingRow } from './group-room-ui'

/** `groups.state` driver fields that say who is answering. */
export interface CanonicalDriverActivity {
  max_rounds?: null | number
  working?: boolean
  member_activity?: (RoomMemberActivity & {
    member_id: string
    status: string
    activity?: string
    task_id?: string
    execution_generation?: number
  })[]
  pending_actions?: CanonicalPendingAction[]
}

export type CanonicalMemberPhase = 'queued' | 'working' | 'stopping'
type CanonicalMemberActivity = 'thinking' | 'reading' | 'editing' | 'searching' | 'running_command' | 'browser' | 'image' | 'replying' | 'working'

interface ActivityLabels {
  groupWorking: string
  memberQueued: string
  memberWorking: string
  memberReplying: string
  memberStopping: string
  memberApproval: string
  waitingMembers: string
  completedReplies: string
  stopRound: string
  memberGeneric: string
  memberActivities?: Partial<Record<CanonicalMemberActivity, string>>
}

/** Unknown or terminal statuses never masquerade as an active member. */
export function canonicalMemberPhases(driver?: CanonicalDriverActivity): Map<string, CanonicalMemberPhase> {
  const phases = new Map<string, CanonicalMemberPhase>()
  const priority = { queued: 1, working: 2, stopping: 3 }

  for (const { member_id, status } of driver?.member_activity ?? []) {
    const phase = status === 'running' ? 'working' : status === 'stopping' ? 'stopping' : status === 'queued' ? 'queued' : undefined

    if (phase && (!phases.has(member_id) || priority[phase] > priority[phases.get(member_id)!])) {
      phases.set(member_id, phase)
    }
  }

  return phases
}

/** Activity belongs to one live attempt. Missing or ambiguous evidence stays generic. */
export function canonicalMemberStatus(memberId: string, phase: CanonicalMemberPhase | undefined, driver: CanonicalDriverActivity | undefined, labels: ActivityLabels) {
  if (!phase) {return undefined}

  if (phase === 'stopping') {return { phase, label: labels.memberStopping }}

  if (phase === 'queued') {return { phase, label: labels.memberQueued }}

  const attempts = (driver?.member_activity ?? []).filter(row => row.member_id === memberId && row.status === 'running')

  const approval = (driver?.pending_actions ?? []).some(action => action.kind === 'approval' && action.member_id === memberId && attempts.some(attempt =>
    (attempt.task_id === undefined || attempt.task_id === action.task_id) &&
    (attempt.execution_generation === undefined || attempt.execution_generation === action.execution_generation)
  ))

  if (approval) {return { phase: 'approval' as const, label: labels.memberApproval }}

  const activity = attempts.length === 1 ? attempts[0].activity : undefined
  const label = activity === 'replying' ? labels.memberReplying : activity && labels.memberActivities?.[activity as CanonicalMemberActivity]

  return { phase, label: typeof label === 'string' ? label : labels.memberWorking }
}

interface GroupReplyStatusProps {
  avatar?: ReactNode
  title: ReactNode
  detail?: ReactNode
  onStop?: () => void
  stopping?: boolean
  busy?: boolean
  stopLabel: string
  phase?: 'replying' | 'queued' | 'stopping' | 'approval' | 'waiting'
}

/** Shared presentation for gateway and retained legacy rooms; neither owns execution. */
export function GroupReplyStatus({ avatar, title, detail, onStop, stopping = false, busy = false, stopLabel, phase = 'replying' }: GroupReplyStatusProps) {
  return <div className="aino-group-round-status" data-phase={phase} data-stopping={stopping || undefined}>
    <div className="aino-group-reply-status" role="status">
      {avatar && <span aria-hidden="true" className="aino-group-reply-avatar">{avatar}</span>}
      <div className="aino-group-reply-copy">
        <div className="aino-group-reply-title">
          <span aria-hidden="true">{phase === 'replying' || phase === 'stopping' ? <GlyphSpinner /> : <Codicon name={phase === 'approval' ? 'shield' : 'clock'} />}</span>
          <span>{title}</span>
        </div>
        {detail && <p className="aino-group-reply-detail">{detail}</p>}
      </div>
    </div>
    {onStop && <Button disabled={busy || stopping} onClick={onStop} size="sm" type="button" variant="outline">
      <Codicon name="debug-stop" />{stopLabel}
    </Button>}
  </div>
}

interface CanonicalGroupWorkingLineProps {
  binding: CanonicalGroupBinding
  driver?: CanonicalDriverActivity
  members?: CanonicalRoomMember[]
  labels: ActivityLabels
  phases: Map<string, CanonicalMemberPhase>
  events?: CanonicalGroupEvent[]
  onStop?: () => void
  busy?: boolean
}

/** Task state is live; room-wide cumulative task counts are deliberately unused. */
export function CanonicalGroupWorkingLine({ binding, driver, members = [], labels, phases, events = [], onStop, busy }: CanonicalGroupWorkingLineProps) {
  const { nameFor } = useCanonicalMembers(binding)
  const active = [...phases].filter(([, phase]) => phase !== 'queued')
  const queue = [...phases].filter(([, phase]) => phase === 'queued')
  const current = active.length ? active : queue
  const statuses = current.map(([id, phase]) => ({ id, status: canonicalMemberStatus(id, phase, driver, labels)! }))
  const memberFor = (id: string) => members.find(member => member.member_id === id)
  const stopping = active.length > 0 && active.every(([, phase]) => phase === 'stopping')

  if (!current.length && !driver?.working) {return null}
  const first = current.length ? memberFor(current[0][0]) : undefined

  const title = statuses.length ? statuses.map(({ id, status }) => {
    const member = memberFor(id)

    return `${member ? nameFor(member) : labels.memberGeneric} · ${status.label}`
  }).join(', ') : labels.groupWorking

  const completed = canonicalCompletedReplies(events, binding)

  const detail = [
    driver?.member_activity ? labels.waitingMembers.replace('{count}', String(queue.length)) : undefined,
    completed === undefined ? undefined : labels.completedReplies.replace('{count}', String(completed))
  ].filter(Boolean).join(' · ')

  const phase = stopping ? 'stopping' : statuses.some(({ status }) => status.phase === 'approval') ? 'approval' : active.length ? 'replying' : queue.length ? 'queued' : 'replying'

  return <GroupReplyStatus
    avatar={first ? <CanonicalMemberAvatar binding={binding} member={first} size={24} /> : undefined}
    busy={busy}
    detail={detail}
    onStop={onStop}
    phase={phase}
    stopLabel={labels.stopRound}
    stopping={stopping}
    title={title}
  />
}

/** `groups.state` driver fields that say what the room is waiting on. */
export interface CanonicalDriverStatus<Action extends { kind: string } = { kind: string }> extends Omit<CanonicalDriverActivity, 'pending_actions'> {
  blocked?: boolean
  counts?: Record<string, number>
  pending_actions?: Action[]
}

export interface CanonicalActivityLabels extends RoomStatusLabels {
  groupWorking: string
  memberWorking: string
}

type BusyStatus = Extract<MemberStatus, { kind: 'stalled' | 'working' }>

export const canonicalMemberName = (member: CanonicalRoomMember) => member.display_name || member.handle || member.member_id
const avatarName = (member: CanonicalRoomMember) => member.profile || member.handle || member.member_id

/** Seconds since the epoch, ticking once a second while `live` (elapsed times in the chips). */
export function useNowSeconds(live: boolean): number {
  const [now, setNow] = useState(() => Date.now() / 1000)

  useEffect(() => {
    setNow(Date.now() / 1000)

    if (!live) {return}
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000)

    return () => clearInterval(timer)
  }, [live])

  return now
}

/** The coarse phase the roster has always exposed (`data-phase`); outcomes read as idle. */
const PHASE: Partial<Record<MemberStatus['kind'], string>> = { working: 'working', stalled: 'working', queued: 'queued' }

const statusOf = (statuses: Map<string, MemberStatus>, member: CanonicalRoomMember): MemberStatus =>
  statuses.get(member.member_id) ?? { kind: 'idle' }

export function CanonicalGroupRoster({ members = [], label, labels, statuses }: {
  members?: CanonicalRoomMember[]; label: string; labels: RoomStatusLabels & { lead: string }; statuses: Map<string, MemberStatus>
}) {
  if (!members.length) {return null}

  return <ul aria-label={label} className="flex min-w-0 flex-wrap gap-1.5">
    {members.map(member => {
      const status = statusOf(statuses, member)

      return <MemberStatusChip avatar={<RoomBotAvatar name={avatarName(member)} size={18} />}
        badge={(member as { lead?: unknown }).lead ? labels.lead : undefined} key={member.member_id}
        labels={labels} name={canonicalMemberName(member)} phase={PHASE[status.kind] ?? 'idle'} status={status} />
    })}
  </ul>
}

/** A typing-style row per working member at the end of the transcript. */
export function CanonicalGroupTyping({ members = [], labels, statuses }: {
  members?: CanonicalRoomMember[]; labels: RoomStatusLabels; statuses: Map<string, MemberStatus>
}) {
  return <>{members.map(member => {
    const status = statusOf(statuses, member)

    return isBusyStatus(status)
      ? <RoomTypingRow avatar={<RoomBotAvatar name={avatarName(member)} size={ROOM_AVATAR_SIZE} />} key={member.member_id} labels={labels}
        name={canonicalMemberName(member)} status={status as BusyStatus} />
      : null
  })}</>
}

/** The room's footer: its round cycle once the log names a discussion; before that (or on a
 *  gateway without member activity) the plain working line. */
export function CanonicalGroupCycle({ cycle, driver, members = [], labels, statuses }: {
  cycle: null | RoomCycle; driver?: CanonicalDriverActivity; members?: CanonicalRoomMember[]; labels: CanonicalActivityLabels
  statuses: Map<string, MemberStatus>
}) {
  const busy = members.filter(member => isBusyStatus(statusOf(statuses, member)))

  if (cycle) {
    // Names only (the chips and typing rows carry each member's tool and time), and only the members of
    // the thread whose round the strip shows.
    const named = cycle.kind === 'working' ? busy.filter(member => cycle.members.includes(member.member_id)) : busy

    return <RoomCycleFooter cycle={cycle} labels={labels} working={named.map(canonicalMemberName)} />
  }

  if (!busy.length && !driver?.working) {return null}

  return <RoomCycleFooter cycle={{ kind: 'working', round: 0, members: [] }} labels={labels}
    text={busy.length ? `${labels.memberWorking}: ${busy.map(canonicalMemberName).join(', ')}` : labels.groupWorking} working={[]} />
}

/** Every member's status, the room's cycle and whether it works, from one poll's state + log. Outcomes are
 *  read per thread; the round comes from the live tasks' own thread (`replyThread`'s when it has work). */
export function useCanonicalRoomLive(events: CanonicalGroupEvent[], driver: CanonicalDriverActivity | undefined, members: CanonicalRoomMember[], replyThread?: string) {
  const activity = driver?.member_activity
  const anyLive = !!activity?.some(row => row.status !== 'queued')
  const now = useNowSeconds(anyLive)
  const log = events as RoomLogEvent[]
  const focus = focusThread(log, replyThread)
  const outcomes = memberOutcomes(log)

  return {
    cycle: roomCycle(log, activity, driver?.max_rounds, focus),
    statuses: new Map(members.map(member => [member.member_id, memberStatus(member.member_id, activity, outcomes, now)])),
    working: !!driver?.working || !!activity?.length
  }
}

interface AttentionLabels {
  statusBlocked: string
  statusApprovals: string
  statusAttention: string
}

/** What the room waits on: a blocked room, approvals and other pending actions. A gateway whose driver
 *  is down sends no driver status at all, and the room says its driver is unavailable instead. */
export function canonicalRoomAttention(driver: CanonicalDriverStatus | undefined, labels: AttentionLabels): string[] {
  const actions = driver?.pending_actions ?? []
  const approvals = actions.filter(action => action.kind === 'approval').length
  const parts = []

  // The gateway also calls a room blocked while a stopped task settles: that is Stop at work, not a
  // block, unless an unresolved task holds the room as well.
  if (driver?.blocked && (driver.counts?.indeterminate || !driver.counts?.stopping)) {parts.push(labels.statusBlocked)}

  if (approvals) {parts.push(labels.statusApprovals.replace('{count}', String(approvals)))}

  if (actions.length > approvals) {parts.push(labels.statusAttention.replace('{count}', String(actions.length - approvals)))}

  return parts
}

/** Shown beside the working line and roster, never instead of them: one member's failure
 *  does not hide the others' live work. */
export function CanonicalGroupAttention({ driver, labels }: { driver?: CanonicalDriverStatus; labels: AttentionLabels }) {
  const parts = canonicalRoomAttention(driver, labels)

  return parts.length ? <p aria-live="polite" className="text-xs text-(--ui-text-secondary)">{parts.join(' · ')}</p> : null
}

/** The room's read, action, journal and driver notices, above its log. */
export function CanonicalGroupNotices({ readError, error, journalError, notice, unavailable, labels, onRefresh, onJournalReload }: {
  readError: string
  error: string
  journalError: string
  notice: string
  unavailable: boolean
  labels: { refresh: string; driverUnavailable: string; journalLoadFailed: string; journalReload: string; details: string }
  onRefresh: () => void
  onJournalReload: () => void
}) {
  return <>
    {readError && <div className="px-3 py-1.5 text-xs text-destructive" role="alert">{readError}<Button onClick={onRefresh}>{labels.refresh}</Button></div>}
    {error && <div className="px-3 py-1.5 text-xs text-destructive" role="alert">{error}</div>}
    {journalError && <div className="px-3 py-1.5 text-xs text-destructive" role="alert">
      <p>{labels.journalLoadFailed}</p>
      <Button onClick={onJournalReload}>{labels.journalReload}</Button>
      <details><summary>{labels.details}</summary>{journalError}</details>
    </div>}
    {notice && <p aria-live="polite" className="px-3 py-1.5 text-xs text-(--ui-text-secondary)">{notice}</p>}
    {unavailable && <p className="px-3 py-1.5 text-xs text-(--ui-text-tertiary)">{labels.driverUnavailable}</p>}
  </>
}
