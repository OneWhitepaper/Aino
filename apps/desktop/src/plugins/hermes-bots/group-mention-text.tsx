/**
 * Semantic @mention rendering for group-room transcripts (#91359).
 *
 * Presentation only: the stored text, the copy button, prompt payloads and
 * `parseGroupChatMentions` are untouched. At render time every `@token` in a
 * text node is classified with the SAME parser the round loop uses, so a token
 * is styled exactly when routing would honour it — unknown handles, e-mail
 * addresses and Matrix ids stay plain prose. Recognized mentions become the
 * app's inline-reference form (`.ref` + `data-ref` kind: `agent` / `human` /
 * `broadcast`), i.e. accent text with weight, never a pill.
 */

import type { ComponentProps, ReactNode } from 'react'
import { Children, Fragment } from 'react'

import { CANONICAL_GROUP_LOCALES } from './canonical-group-locales'
import { groupMemberKey } from './group-membership'
import { parseGroupChatMentions } from './group-rounds'
import { displayName } from './labels'
import type { GroupMember } from './types'

export type GroupMentionKind = 'agent' | 'broadcast' | 'human'

const MENTION = /@([a-z0-9][a-z0-9._-]*)/gi

/** What a lone `@token` means in this room, or null when routing ignores it. */
export function classifyGroupMention(token: string, members: GroupMember[]): GroupMentionKind | null {
  const handle = token.toLowerCase()

  if (handle === 'user') {
    return 'human'
  }

  const parsed = parseGroupChatMentions(`@${token}`, members)

  if (parsed.everyone) {
    return 'broadcast'
  }

  return parsed.mentioned.size ? 'agent' : null
}

interface MentionLabels {
  allMembers?: string
  you?: string
  mentionBot?: string
  mentionEveryone?: string
  mentionUser?: string
}

/** Split one text node into prose and recognized mention spans. */
export function renderGroupMentionText(
  text: string,
  members: GroupMember[],
  labels: MentionLabels = CANONICAL_GROUP_LOCALES.en
): ReactNode {
  const parts: ReactNode[] = []
  let last = 0

  for (const match of text.matchAll(MENTION)) {
    const kind = classifyGroupMention(match[1], members)

    if (!kind) {
      continue
    }

    const start = match.index ?? 0

    // E-mail and URL tokens are content, even when their suffix is a member's handle.
    if (start > 0 && /[\p{L}\p{N}_./@:\\-]/u.test(text[start - 1])) {
      continue
    }

    const targets = kind === 'agent' ? parseGroupChatMentions(match[0], members).mentioned : undefined
    const member = targets?.size === 1 ? members.find(candidate => targets.has(groupMemberKey(candidate))) : undefined

    const label =
      kind === 'broadcast'
        ? (labels.allMembers ?? CANONICAL_GROUP_LOCALES.en.allMembers)
        : kind === 'human'
          ? (labels.you ?? CANONICAL_GROUP_LOCALES.en.you)
          : member
            ? displayName(member)
            : match[1]

    if (start > last) {
      parts.push(text.slice(last, start))
    }

    parts.push(
      <span
        className="aino-group-mention ref font-medium"
        data-ref={kind}
        key={`${start}:${match[0]}`}
        title={labels[({ agent: 'mentionBot', broadcast: 'mentionEveryone', human: 'mentionUser' } as const)[kind]]}
      >
        @{label}
      </span>
    )
    last = start + match[0].length
  }

  if (!parts.length) {
    return text
  }

  if (last < text.length) {
    parts.push(text.slice(last))
  }

  return <Fragment>{parts}</Fragment>
}

function mapTextChildren(children: ReactNode, members: GroupMember[], labels?: MentionLabels): ReactNode {
  return Children.map(children, child =>
    typeof child === 'string' ? renderGroupMentionText(child, members, labels) : child
  )
}

/** `decorateText` hook for the shell's `MessageTextContent`: the same
 *  splitter, applied to the direct text nodes of its paragraph-level
 *  containers (p / li / td). */
export function groupMentionText(members: GroupMember[], labels?: MentionLabels) {
  return (children: ReactNode) => mapTextChildren(children, members, labels)
}

/** Streamdown `components` override (older shells without
 *  `MessageTextContent`): paragraph-level containers re-render
 *  their direct text nodes through the mention splitter. Nested inline
 *  markup (bold, links) and code stay as Streamdown produced them, so a
 *  mention inside a backtick span is left literal on purpose. */
export function groupMentionComponents(members: GroupMember[], labels?: MentionLabels) {
  return {
    li: ({ children, ...props }: ComponentProps<'li'>) => (
      <li {...props}>{mapTextChildren(children, members, labels)}</li>
    ),
    p: ({ children, ...props }: ComponentProps<'p'>) => <p {...props}>{mapTextChildren(children, members, labels)}</p>,
    td: ({ children, ...props }: ComponentProps<'td'>) => (
      <td {...props}>{mapTextChildren(children, members, labels)}</td>
    )
  }
}
