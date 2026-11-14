import type { CanonicalGroupRoute } from './canonical-groups'
import { botHandle } from './data'
import { unresolvedGroupMentions } from './group-chat-mentions'
import { groupMemberKey } from './group-membership'
import { parseGroupChatMentions } from './group-rounds'
import { displayName } from './labels'
import { botRosterMeta } from './routing'
import type { BotMeta, GroupMember } from './types'

export function legacyGroupMentionScope(roomKey: string, members: GroupMember[], owner?: CanonicalGroupRoute): string {
  const addresses = members
    .map(member => [
      groupMemberKey(member),
      botHandle(member.name, member),
      member.route?.connectionId ?? member.connectionId ?? owner?.connectionId ?? null,
      member.route?.targetProfile ?? member.targetProfile ?? member.route?.profile ?? member.name
    ])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

  return JSON.stringify(['legacy', roomKey, owner?.connectionId ?? null, owner?.profile ?? null, addresses])
}

/** The existing parser owns aliases. A readable unbound name never becomes a
 * broadcast merely because the exact-address projection cannot recognize it. */
export function unresolvedLegacyGroupMentions(
  text: string,
  members: GroupMember[],
  meta: Record<string, BotMeta>,
  allMembers: string,
  you: string
) {
  const identities = members.map(member => ({
    handle: botHandle(member.name, member),
    label: displayName(member, botRosterMeta(member, meta))
  }))

  const unresolved = unresolvedGroupMentions(text, [
    ...identities,
    { handle: 'everyone', label: allMembers },
    { handle: 'all', label: allMembers },
    { handle: 'user', label: you }
  ])

  return unresolved.filter(token => {
    const resolved = parseGroupChatMentions(token.text, members)

    return !resolved.everyone && !resolved.mentioned.size
  })
}

export function legacyGroupRecipientNames(
  text: string,
  members: GroupMember[],
  meta: Record<string, BotMeta>,
  allMembers: string
): string {
  const addressed = parseGroupChatMentions(text, members)

  if (addressed.everyone || !addressed.mentioned.size) {
    return allMembers
  }

  const counts = new Map<string, number>()

  for (const member of members) {
    if (!addressed.mentioned.has(groupMemberKey(member))) {
      continue
    }

    const name = displayName(member, botRosterMeta(member, meta))
    counts.set(name, (counts.get(name) || 0) + 1)
  }

  return [...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)).join(', ')
}
