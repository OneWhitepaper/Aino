import type { ClipboardEvent } from 'react'

import {
  type GroupMentionIdentity,
  type GroupMentionProjection,
  groupMentionRawOffset,
  projectGroupMentions,
  replaceGroupMentionRange
} from './group-chat-mentions'

export const GROUP_MENTION_CLIPBOARD_TYPE = 'application/x-aino-group-mention+json'

interface GroupMentionClipboard {
  version: 1
  scope: string
  text: string
  raw: string
  mentions: GroupMentionIdentity[]
}

/** Plain text is always readable outside Aino. Addresses travel only as scoped
 * metadata, and only when the selection contains complete bound recipients. */
export function copyGroupMentions(projection: GroupMentionProjection, start: number, end: number, scope?: string) {
  const text = projection.text.slice(start, end)
  const selected = projection.spans.filter(span => span.start < end && span.end > start)

  if (!scope || !selected.length || selected.some(span => span.start < start || span.end > end)) {
    return { text }
  }

  const raw = projection.raw.slice(
    groupMentionRawOffset(projection, start),
    groupMentionRawOffset(projection, end, 'end')
  )

  const envelope: GroupMentionClipboard = {
    version: 1,
    scope,
    text,
    raw,
    mentions: selected.map(({ handle, label }) => ({ handle, label }))
  }

  return { text, envelope: JSON.stringify(envelope) }
}

/** Names from another room are ordinary text. A same-room rename is safe:
 * validate the copied label against its stored binding, then use today's label. */
export function readGroupMentionsClipboard(
  serialized: string,
  plain: string,
  scope: string | undefined,
  identities: GroupMentionIdentity[]
): string | undefined {
  if (!scope || !serialized) {
    return undefined
  }

  let envelope: Partial<GroupMentionClipboard>

  try {
    envelope = JSON.parse(serialized)
  } catch {
    return undefined
  }

  if (
    !envelope ||
    envelope.version !== 1 ||
    envelope.scope !== scope ||
    envelope.text !== plain ||
    typeof envelope.raw !== 'string' ||
    !Array.isArray(envelope.mentions) ||
    !envelope.mentions.length
  ) {
    return undefined
  }

  const available = new Set(identities.map(identity => identity.handle.toLowerCase()))

  if (
    envelope.mentions.some(
      identity =>
        !identity ||
        typeof identity.handle !== 'string' ||
        typeof identity.label !== 'string' ||
        !available.has(identity.handle.toLowerCase())
    )
  ) {
    return undefined
  }

  const projection = projectGroupMentions(envelope.raw, envelope.mentions)

  if (projection.text !== plain || projection.spans.length !== envelope.mentions.length) {
    return undefined
  }

  return envelope.raw
}

interface GroupMentionClipboardOptions {
  scope?: string
  projection: GroupMentionProjection
  identities: GroupMentionIdentity[]
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void
  onInvalidMentionPaste?: () => void
  update: (next: { raw: string; rawCaret: number }) => void
  rememberSelection: (selection: { start: number; end: number }) => void
  closePicker: () => void
}

/** Local DOM events only; no system clipboard access or cross-room state. */
export function groupMentionClipboardHandlers({
  scope,
  projection,
  identities,
  onPaste,
  onInvalidMentionPaste,
  update,
  rememberSelection,
  closePicker
}: GroupMentionClipboardOptions) {
  const copy = (event: ClipboardEvent<HTMLTextAreaElement>, cut = false) => {
    const { selectionStart: start, selectionEnd: end } = event.currentTarget
    const copied = copyGroupMentions(projection, start, end, scope)
    rememberSelection({ start, end })

    if (!copied.envelope) {
      return
    }

    event.clipboardData.setData('text/plain', copied.text)
    event.clipboardData.setData(GROUP_MENTION_CLIPBOARD_TYPE, copied.envelope)
    event.preventDefault()

    if (cut) {
      update(replaceGroupMentionRange(projection, start, end, ''))
      closePicker()
    }
  }

  return {
    onCopy: (event: ClipboardEvent<HTMLTextAreaElement>) => copy(event),
    onCut: (event: ClipboardEvent<HTMLTextAreaElement>) => copy(event, true),
    onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const { selectionStart: start, selectionEnd: end } = event.currentTarget
      rememberSelection({ start, end })
      onPaste?.(event)

      if (event.defaultPrevented || event.clipboardData.files?.length) {
        return
      }

      const serialized = event.clipboardData.getData(GROUP_MENTION_CLIPBOARD_TYPE)
      const plain = event.clipboardData.getData('text/plain')
      const raw = readGroupMentionsClipboard(serialized, plain, scope, identities)

      if (!serialized) {
        return
      }

      event.preventDefault()
      // Foreign metadata must not turn a readable label into a different local
      // ASCII handle. The fullwidth mark is visibly unbound and never routes.
      update(replaceGroupMentionRange(projection, start, end, raw ?? plain.replaceAll('@', '＠')))

      if (raw === undefined) {
        onInvalidMentionPaste?.()
      }

      closePicker()
    }
  }
}
