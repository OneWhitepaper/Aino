import { host, useValue } from '@hermes/plugin-sdk'

import { avatarColor, botAppearance, BotFace } from './avatar'
import type { CanonicalGroupBinding, CanonicalRoomMember } from './canonical-groups'
import { $botMeta, $lastRoster } from './data'
import { displayName } from './labels'
import { botRosterMeta } from './routing'
import type { BotMeta, RosterRow } from './types'

function memberPresentationName(
  member: CanonicalRoomMember,
  row: RosterRow | undefined,
  meta: BotMeta | undefined
): string {
  const namedRow =
    row &&
    (row.name === 'default' ||
      meta?.title?.trim() ||
      row.display_name?.trim() ||
      row.title ||
      row.ui_meta?.['hermes-bots']?.title)

  return (
    (namedRow && row ? displayName(row, meta) : meta?.title?.trim()) ||
    member.display_name?.trim() ||
    member.handle ||
    member.profile ||
    member.member_id
  )
}

/** A room's frozen @handle is an address. Presentation may use a newer title,
 * but only from the same connection and target profile as the room member. */
export function resolveCanonicalMember(
  member: CanonicalRoomMember,
  binding?: CanonicalGroupBinding,
  roster: RosterRow[] = [],
  allMeta: Record<string, BotMeta> = {},
  activeConnectionId?: string | null
) {
  const row = binding
    ? roster.find(bot => {
        const connectionId =
          bot.route?.connectionId ||
          bot.connectionId ||
          (!bot.remoteSource && !bot.sourceScoped ? activeConnectionId : undefined)

        const profile = bot.route?.targetProfile || bot.targetProfile || bot.route?.profile || bot.name

        return connectionId === binding.connectionId && profile === member.profile
      })
    : undefined

  const qualifiedMeta = binding ? allMeta[`${binding.connectionId}::${row?.name || member.profile}`] : undefined

  const rowMeta =
    row && (row.sourceScoped || row.remoteSource || binding?.connectionId === activeConnectionId)
      ? botRosterMeta(row, allMeta)
      : undefined

  // Bare metadata belongs to the active source. Never borrow a same-name bot
  // from whichever gateway happens to be in front of a foreign room.
  const localMeta = binding?.connectionId === activeConnectionId ? allMeta[member.profile] : undefined
  const meta = qualifiedMeta || rowMeta || localMeta

  const name = memberPresentationName(member, row, meta)

  return { name, appearance: botAppearance(row?.name || member.profile || member.member_id, meta) }
}

export function canonicalMemberName(...args: Parameters<typeof resolveCanonicalMember>): string {
  return resolveCanonicalMember(...args).name
}

export function useCanonicalMembers(binding?: CanonicalGroupBinding) {
  const roster = useValue($lastRoster)
  const meta = useValue($botMeta)
  const activeConnectionId = useValue(host.state.connectionId)

  const resolve = (member: CanonicalRoomMember) =>
    resolveCanonicalMember(member, binding, roster, meta, activeConnectionId)

  return {
    nameFor: (member: CanonicalRoomMember) => resolve(member).name,
    appearanceFor: (member: CanonicalRoomMember) => resolve(member).appearance
  }
}

export function CanonicalMemberAvatar({
  member,
  binding,
  size = 32
}: {
  member: CanonicalRoomMember
  binding?: CanonicalGroupBinding
  size?: number
}) {
  const { appearanceFor } = useCanonicalMembers(binding)
  const { shape, color, image } = appearanceFor(member)

  return (
    <span aria-hidden="true" className="aino-group-member-avatar" style={{ width: size, height: size }}>
      <BotFace
        color={avatarColor(color, member.profile)}
        image={image}
        name={member.profile}
        shape={shape}
        size={size}
      />
    </span>
  )
}

export function CanonicalGroupAvatarStack({
  members = [],
  binding,
  limit = 3
}: {
  members?: CanonicalRoomMember[]
  binding?: CanonicalGroupBinding
  limit?: number
}) {
  return (
    <span aria-hidden="true" className="aino-group-avatar-stack">
      {members.slice(0, limit).map(member => (
        <CanonicalMemberAvatar binding={binding} key={member.member_id} member={member} size={26} />
      ))}
      {members.length > limit && <span className="aino-group-avatar-overflow">+{members.length - limit}</span>}
    </span>
  )
}
