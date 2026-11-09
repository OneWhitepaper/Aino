import { Button, Codicon, GlyphSpinner } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

import type { CanonicalGroupEvent } from './canonical-group-history'
import { CanonicalMemberAvatar, useCanonicalMembers } from './canonical-group-members'
import { canonicalCompletedReplies } from './canonical-group-progress'
import type { CanonicalGroupBinding, CanonicalPendingAction, CanonicalRoomMember } from './canonical-groups'

/** Only these live fields are published by `groups.state`. */
export interface CanonicalDriverActivity {
  working?: boolean
  member_activity?: {
    member_id: string
    status: string
    activity?: string
    task_id?: string
    execution_generation?: number
  }[]
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
