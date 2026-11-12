export interface SubagentIdentity {
  id: string
  subagentId?: string
  displayName?: string
  goal?: string
}

/** A display title, never a routing key or a rewrite of the delegated goal. */
export function subagentDisplayName(task: SubagentIdentity, fallback: string): string {
  const supplied = task.displayName?.trim()
  const name = supplied && supplied !== task.id && supplied !== task.subagentId ? supplied : ''

  const title =
    (name || task.goal || fallback)
      .split(/[\r\n。！？!?]|\.(?:\s|$)/u, 1)[0]!
      .replace(/\s+/g, ' ')
      .trim() || fallback

  const characters = Array.from(title)

  if (characters.length <= 24) {
    return title
  }

  const words = title.split(' ')
  const short = words.length > 4 ? words.slice(0, 4).join(' ') : title

  return `${Array.from(short).slice(0, 23).join('').trimEnd()}…`
}

/** Names and goals can change. A child's portrait follows its exact receipt identity. */
export const subagentAvatarSeed = (task: SubagentIdentity, parentSessionId?: string | null): string =>
  JSON.stringify([parentSessionId || '', task.subagentId || task.id])
