import { avatarColor, botAppearance, BotFace } from './avatar'
import { GroupReplyStatus } from './canonical-group-activity'
import type { GroupActivityEntry } from './group-activity'
import type { GroupChatRoom } from './group-chat'
import { useBots } from './i18n'
import { displayName } from './labels'
import { botRosterMeta } from './routing'
import type { BotMeta } from './types'

interface LegacyGroupReplyStatusProps {
  room: GroupChatRoom
  activity: GroupActivityEntry[]
  allMeta: Record<string, BotMeta>
  waitingForAnswer: boolean
  onStop: () => void
}

/** Older gateways keep their existing epoch-scoped coordinator and activity feed. */
export function LegacyGroupReplyStatus({
  room,
  activity,
  allMeta,
  waitingForAnswer,
  onStop
}: LegacyGroupReplyStatusProps) {
  const b = useBots()

  if (!room.running) {
    return null
  }
  const thread = activity.at(-1)?.thread
  const current = activity.filter(event => event.thread === thread)
  const latestByMember = new Map(current.filter(event => event.member).map(event => [event.member, event]))
  const queued = [...latestByMember.values()].filter(event => event.kind === 'queued').length
  const replied = new Set(current.filter(event => event.kind === 'replied').map(event => `${event.member}:${event.at}`))
    .size
  const member = room.turn
  const appearance = member ? botAppearance(member.name, botRosterMeta(member, allMeta)) : undefined

  const detail = [
    queued ? b.canonical.waitingMembers.replace('{count}', String(queued)) : undefined,
    replied ? b.canonical.completedReplies.replace('{count}', String(replied)) : undefined
  ]
    .filter(Boolean)
    .join(' · ')

  const state = waitingForAnswer ? b.group.waitingForAnswer : b.canonical.memberReplying

  return (
    <GroupReplyStatus
      avatar={
        member && appearance ? (
          <BotFace
            color={avatarColor(appearance.color, member.name)}
            image={appearance.image}
            name={member.name}
            shape={appearance.shape}
            size={24}
          />
        ) : undefined
      }
      detail={detail}
      onStop={onStop}
      phase={waitingForAnswer ? 'waiting' : 'replying'}
      stopLabel={b.canonical.stopRound}
      title={
        member
          ? `${displayName(member, botRosterMeta(member, allMeta))} · ${state}`
          : waitingForAnswer
            ? b.group.waitingForAnswer
            : b.group.roomWorking
      }
    />
  )
}
