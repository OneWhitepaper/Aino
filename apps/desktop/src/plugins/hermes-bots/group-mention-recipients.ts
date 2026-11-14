import type { GroupMentionIdentity } from './group-chat-mentions'

export interface CanonicalMentionRecipients {
  handles: string[]
  all: boolean
}

/** Mirror hosted_room_discussion.resolve_mentions for the delivery summary.
 * The gateway scans raw text, including code and email; display projection's
 * prose boundaries must never change who the summary says will receive it. */
export function canonicalMentionRecipients(
  raw: string,
  members: readonly GroupMentionIdentity[]
): CanonicalMentionRecipients {
  const available = new Map<string, string>()

  for (const member of members) {
    const key = member.handle.toLowerCase()

    if (!available.has(key)) {
      available.set(key, member.handle)
    }
  }

  const mentioned = new Set<string>()
  let broadcast = false

  for (const match of raw.matchAll(/@([A-Za-z0-9][A-Za-z0-9._:-]*)/g)) {
    const handle = match[1].toLowerCase()

    if (handle === 'all' || handle === 'everyone') {
      broadcast = true
    } else if (available.has(handle)) {
      mentioned.add(handle)
    }
  }

  const all = broadcast || mentioned.size === 0

  return {
    handles: [...available].filter(([handle]) => all || mentioned.has(handle)).map(([, handle]) => handle),
    all
  }
}
