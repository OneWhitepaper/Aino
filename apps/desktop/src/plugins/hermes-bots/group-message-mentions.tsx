import type { ComponentProps, ReactNode } from 'react'
import { Children } from 'react'

import { type GroupMentionIdentity, projectGroupMentions } from './group-chat-mentions'

/** Hosted rooms address immutable handles; presentation never resolves a mutable name. */
export function addressedGroupMentionText(identities: GroupMentionIdentity[]) {
  return (children: ReactNode) =>
    Children.map(children, child => {
      if (typeof child !== 'string') {
        return child
      }

      const projected = projectGroupMentions(child, identities)
      const parts: ReactNode[] = []
      let last = 0

      for (const span of projected.spans) {
        parts.push(projected.text.slice(last, span.start))
        parts.push(
          <span
            className="aino-group-mention ref font-medium"
            data-ref={['all', 'everyone'].includes(span.handle) ? 'broadcast' : 'agent'}
            key={`${span.start}:${span.handle}`}
          >
            {projected.text.slice(span.start, span.end)}
          </span>
        )
        last = span.end
      }

      return parts.length ? (
        <>
          {parts}
          {projected.text.slice(last)}
        </>
      ) : (
        child
      )
    })
}

/** Older shells preserve the same prose-only decoration without mounting another renderer. */
export function addressedGroupMentionComponents(identities: GroupMentionIdentity[]) {
  const decorate = addressedGroupMentionText(identities)

  return {
    li: ({ children, ...props }: ComponentProps<'li'>) => <li {...props}>{decorate(children)}</li>,
    p: ({ children, ...props }: ComponentProps<'p'>) => <p {...props}>{decorate(children)}</p>,
    td: ({ children, ...props }: ComponentProps<'td'>) => <td {...props}>{decorate(children)}</td>
  }
}

/** Search aliases match rendered prose; code and link text keep their literal identity. */
export function readableGroupMentionSearch(text: string, identities: GroupMentionIdentity[]): string {
  let fence: { marker: string; length: number } | undefined
  let prose = ''
  let result = ''

  const flush = () => {
    // These nodes are intentionally not offered to Markdown's decorateText hook.
    const protectedInline = /(`+)([\s\S]*?)\1(?!`)|!?\[[^\]]*\]\([^)]*\)|<[^>]*>|https?:\/\/\S+/g
    let last = 0

    for (const match of prose.matchAll(protectedInline)) {
      result += projectGroupMentions(prose.slice(last, match.index), identities).text + match[0]
      last = match.index + match[0].length
    }

    result += projectGroupMentions(prose.slice(last), identities).text
    prose = ''
  }

  for (const [index, original] of text.split('\n').entries()) {
    const line = `${index ? '\n' : ''}${original}`
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(original)?.[1]

    if (fence) {
      if (
        marker?.[0] === fence.marker &&
        marker.length >= fence.length &&
        !original.slice(original.indexOf(marker) + marker.length).trim()
      ) {
        fence = undefined
      }

      result += line

      continue
    }

    if (marker || /^(?: {4}|\t)/.test(original)) {
      flush()

      if (marker) {
        fence = { marker: marker[0], length: marker.length }
      }

      result += line

      continue
    }

    prose += line
  }

  flush()

  return result
}
