/** A readable mention is presentation only; its frozen address stays in the draft. */
export interface GroupMentionIdentity {
  handle: string
  label: string
}

export interface GroupMentionSpan extends GroupMentionIdentity {
  start: number
  end: number
  rawStart: number
  rawEnd: number
}

export interface GroupMentionProjection {
  raw: string
  text: string
  spans: GroupMentionSpan[]
}

/** Exact addresses only. Never resolve a display name back to a member. */
export function projectGroupMentions(raw: string, identities: GroupMentionIdentity[]): GroupMentionProjection {
  const addresses = new Map(identities.map(identity => [identity.handle.toLowerCase(), identity]))
  const spans: GroupMentionSpan[] = []
  let text = ''
  let cursor = 0

  for (const match of raw.matchAll(/(^|\s)@([a-z0-9._-]+)(?=$|[^\p{L}\p{N}._-])/giu)) {
    const identity = addresses.get(match[2].toLowerCase())

    if (!identity) {
      continue
    }

    const rawStart = match.index + match[1].length
    const rawEnd = rawStart + match[2].length + 1
    text += raw.slice(cursor, rawStart)
    const start = text.length
    text += `@${identity.label}`
    spans.push({ ...identity, start, end: text.length, rawStart, rawEnd })
    cursor = rawEnd
  }

  return { raw, text: text + raw.slice(cursor), spans }
}

/** DOM selections use displayed UTF-16 offsets, just like textarea.selectionStart. */
export function groupMentionRawOffset(
  projection: GroupMentionProjection,
  offset: number,
  edge: 'start' | 'end' = 'start'
): number {
  let delta = 0

  for (const span of projection.spans) {
    if (offset <= span.start) {
      break
    }

    if (offset < span.end) {
      return edge === 'start' ? span.rawStart : span.rawEnd
    }

    delta += span.rawEnd - span.rawStart - (span.end - span.start)
  }

  return offset + delta
}

export function groupMentionDisplayOffset(projection: GroupMentionProjection, offset: number): number {
  let delta = 0

  for (const span of projection.spans) {
    if (offset <= span.rawStart) {
      break
    }

    if (offset < span.rawEnd) {
      return span.end
    }

    delta += span.end - span.start - (span.rawEnd - span.rawStart)
  }

  return offset + delta
}

/** An edited name loses its binding. Untouched mentions keep their exact address,
 * even when two members have the same name or a member has since been renamed. */
export function editGroupMentions(
  projection: GroupMentionProjection,
  nextText: string,
  caret: number,
  selection?: { start: number; end: number }
): { raw: string; rawCaret: number } {
  const { prefix, oldEnd } = mentionEditWindow(projection.text, nextText, caret, selection)
  const shift = nextText.length - projection.text.length

  const kept = projection.spans
    .filter(
      span =>
        !(prefix < span.end && oldEnd > span.start) && !(prefix === oldEnd && prefix > span.start && prefix < span.end)
    )
    .map(span => ({
      ...span,
      start: span.start >= oldEnd ? span.start + shift : span.start,
      end: span.start >= oldEnd ? span.end + shift : span.end
    }))
    .filter(
      span =>
        (span.start === 0 || /\s/u.test(nextText[span.start - 1])) &&
        (span.end === nextText.length || /[^\p{L}\p{N}._-]/u.test(nextText[span.end]))
    )

  let raw = ''
  let cursor = 0
  let rawCaret = caret

  for (const span of kept) {
    raw += nextText.slice(cursor, span.start)
    const address = projection.raw.slice(span.rawStart, span.rawEnd)

    if (caret >= span.end) {
      rawCaret += address.length - (span.end - span.start)
    } else if (caret > span.start) {
      rawCaret = raw.length + address.length
    }

    raw += address
    cursor = span.end
  }

  return { raw: raw + nextText.slice(cursor), rawCaret }
}

interface MentionEditRange {
  start: number
  end: number
}

function matchesEditWindow(before: string, after: string, range?: MentionEditRange): range is MentionEditRange {
  if (!range || range.start < 0 || range.end < range.start || range.end > before.length) {
    return false
  }

  const inserted = after.length - before.length + range.end - range.start

  return (
    inserted >= 0 &&
    after.slice(0, range.start) === before.slice(0, range.start) &&
    after.slice(range.start + inserted) === before.slice(range.end)
  )
}

function mentionEditWindow(before: string, after: string, caret: number, selection?: MentionEditRange) {
  const shift = after.length - before.length

  // Text diff alone cannot tell which of two identically named recipients was
  // deleted. Prefer the native selection/caret when it proves the edit window.
  const candidates = [
    selection,
    shift < 0 ? { start: caret, end: caret - shift } : { start: caret - shift, end: caret - shift }
  ]

  const exact = candidates.find(range => matchesEditWindow(before, after, range))

  if (exact) {
    return { prefix: exact.start, oldEnd: exact.end }
  }

  let prefix = 0

  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix++
  }

  let suffix = 0

  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) {
    suffix++
  }

  return { prefix, oldEnd: before.length - suffix }
}

export function replaceGroupMentionRange(
  projection: GroupMentionProjection,
  start: number,
  end: number,
  address: string
) {
  const rawStart = groupMentionRawOffset(projection, start)
  const rawEnd = groupMentionRawOffset(projection, end, 'end')

  return {
    raw: projection.raw.slice(0, rawStart) + address + projection.raw.slice(rawEnd),
    rawCaret: rawStart + address.length
  }
}

/** A typed or externally pasted name has no binding. The composer must ask the
 * user to pick a recipient rather than silently broadcasting that message. */
export function unresolvedGroupMentions(
  raw: string,
  identities: GroupMentionIdentity[]
): Array<{ start: number; end: number; text: string }> {
  const labels = [...new Set(identities.map(identity => identity.label))].sort((a, b) => b.length - a.length)
  const ignored = groupMentionCodeRanges(raw)
  const unresolved: Array<{ start: number; end: number; text: string }> = []

  for (const match of raw.matchAll(/[@＠]/gu)) {
    const start = match.index

    if (
      ignored.some(range => start >= range.start && start < range.end)
    ) {
      continue
    }

    const tail = raw.slice(start + 1)

    const email =
      raw[start] === '@' &&
      /[a-z0-9.!#$%&'*+/=?^_`{|}~-]$/iu.test(raw.slice(0, start)) &&
      /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}(?:$|[^a-z0-9.-])/iu.test(tail)

    const address = /^[a-z0-9][a-z0-9._:-]*/iu.exec(tail)?.[0]

    if (
      email ||
      (raw[start] === '@' &&
        address &&
        identities.some(identity => identity.handle.toLowerCase() === address.toLowerCase()))
    ) {
      continue
    }

    const label = labels.find(
      label => tail.startsWith(label) && (tail.length === label.length || /[^\p{L}\p{N}._-]/u.test(tail[label.length]))
    )

    const token = label || /^[\p{L}\p{N}._:-]+/u.exec(tail)?.[0]

    if (token) {
      unresolved.push({ start, end: start + token.length + 1, text: raw[start] + token })
    }
  }

  return unresolved
}

function groupMentionCodeRanges(raw: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let fence: { start: number; marker: string; size: number } | undefined
  let offset = 0

  for (const line of raw.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]

    if (marker && !fence) {
      fence = { start: offset, marker: marker[0], size: marker.length }
    } else if (
      fence &&
      marker?.[0] === fence.marker &&
      marker.length >= fence.size &&
      /^ {0,3}(?:`+|~+)\s*$/.test(line)
    ) {
      ranges.push({ start: fence.start, end: offset + line.length })
      fence = undefined
    }

    offset += line.length + 1
  }

  if (fence) {
    ranges.push({ start: fence.start, end: raw.length })
  }

  for (const match of raw.matchAll(/(`+)([\s\S]*?)\1/gu)) {
    ranges.push({ start: match.index, end: match.index + match[0].length })
  }

  return ranges
}
