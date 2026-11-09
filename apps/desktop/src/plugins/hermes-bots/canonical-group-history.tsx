import * as sdk from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'

import { type CanonicalGroupAttachment, CanonicalGroupAttachments, fetchCanonicalGroupAttachment } from './canonical-group-attachments'
import { useCanonicalGroupLabels } from './canonical-group-labels'
import { CanonicalMemberAvatar, canonicalMemberName, useCanonicalMembers } from './canonical-group-members'
import type { CanonicalGroupBinding, CanonicalRoomMember } from './canonical-groups'
import type { GroupMentionIdentity } from './group-chat-mentions'
import { addressedGroupMentionComponents, addressedGroupMentionText, readableGroupMentionSearch } from './group-message-mentions'

const MessageTextContent = typeof sdk === 'undefined' ? undefined : sdk.MessageTextContent
const Streamdown = typeof sdk === 'undefined' ? undefined : sdk.Streamdown

export interface CanonicalGroupEvent {
  seq: number
  event_id?: string
  room_id?: string
  kind: string
  payload: {
    text?: string; content?: string; attachments?: CanonicalGroupAttachment[]; member_id?: string
    error?: string; reason?: string; reason_code?: string; status?: string
    discussion_event_id?: string; thread_id?: string; task_id?: string; message_event_id?: string; passed?: boolean
  }
  actor?: { kind?: string; id?: string; display_name?: string }
  created_at?: number
}

interface CanonicalGroupHistoryProps {
  binding: CanonicalGroupBinding
  events: CanonicalGroupEvent[]
  members?: CanonicalRoomMember[]
  disabled?: boolean
  onMention?: (member: CanonicalRoomMember) => void
  searchQuery?: string
}

function eventMember(event: CanonicalGroupEvent, roster: Map<string, CanonicalRoomMember>, isMessage: boolean) {
  const memberId = isMessage
    ? event.actor?.kind === 'member' ? event.actor.id : undefined
    : event.payload.member_id

  return roster.get(memberId ?? '')
}

function eventAuthor(
  event: CanonicalGroupEvent,
  member: CanonicalRoomMember | undefined,
  isMessage: boolean,
  nameFor: (member: CanonicalRoomMember) => string,
  memberGeneric: string
) {
  // The immutable actor identifies the seat. Its old display_name may itself be
  // a protocol address; current seated names share the toolbar's scoped resolver.
  if (member) {return nameFor(member)}

  const savedName = isMessage ? event.actor?.display_name?.trim() : undefined
  const identity = isMessage ? event.actor?.id : event.payload.member_id
  const bot = event.actor?.kind === 'member' || event.kind === 'message.member' || (!isMessage && !!identity)

  if (bot) {return savedName && savedName !== identity ? savedName : memberGeneric}

  return savedName || identity
}

/** Search and its count use the same scoped author label that the transcript displays. */
export function canonicalGroupMessageMatches(
  event: CanonicalGroupEvent,
  binding: CanonicalGroupBinding,
  roster: Map<string, CanonicalRoomMember>,
  query: string,
  nameFor: (member: CanonicalRoomMember) => string = member => canonicalMemberName(member, binding),
  allMembers?: string,
  memberGeneric = ''
): boolean {
  const isMessage = ['message', 'message.user', 'message.member'].includes(event.kind)
  const term = query.trim().toLocaleLowerCase()

  if (!isMessage || !term) {return false}
  const author = eventAuthor(event, eventMember(event, roster, true), true, nameFor, memberGeneric)
  const identities = [...roster.values()].map(member => ({ handle: member.handle, label: nameFor(member) }))

  if (allMembers) {identities.push({ handle: 'everyone', label: allMembers }, { handle: 'all', label: allMembers })}
  const text = event.payload.text || event.payload.content || ''

  return [text, readableGroupMentionSearch(text, identities), author, ...(event.payload.attachments ?? []).map(file => file.name)]
    .some(value => value?.toLocaleLowerCase().includes(term))
}

function EventTime({ timestamp }: { timestamp?: number }) {
  if (typeof timestamp !== 'number') {return null}
  const at = new Date(timestamp * 1000)

  if (!Number.isFinite(at.getTime())) {return null}

  return <time dateTime={at.toISOString()}>{sdk.relativeTime(at.getTime())}</time>
}

function EventBody({ event, identities }: { event: CanonicalGroupEvent; identities: GroupMentionIdentity[] }) {
  const text = event.payload.text || event.payload.content || ''

  return <div className="aino-group-message-text" data-selectable-text="true">
    {/* The shared renderer (layout and large-message safeguards). media={false}: room text
        may come from another machine, so its MEDIA: paths never resolve against this gateway;
        room files keep their own download path below. */}
    {MessageTextContent ? <MessageTextContent decorateText={addressedGroupMentionText(identities)} media={false} text={text} />
      : Streamdown ? <Streamdown components={addressedGroupMentionComponents(identities)}>{text}</Streamdown> : addressedGroupMentionText(identities)(text)}
  </div>
}

function EventNotice({ event, title, author }: { event: CanonicalGroupEvent; title: string; author?: string }) {
  const labels = useCanonicalGroupLabels()
  const details = [...new Set([event.payload.error, event.payload.reason, event.payload.reason_code].filter(Boolean))].join('\n')
  const serviceUnavailable = /\bruntime_draining\b/.test(details)

  return <details className="aino-group-notice" data-event-seq={event.seq} data-service-unavailable={serviceUnavailable || undefined}>
    <summary className="aino-group-notice-summary">
      <span className="aino-group-notice-heading">
      <sdk.Codicon name={serviceUnavailable || event.kind === 'turn.failed' || event.kind === 'member.unavailable' ? 'warning' : 'info'} />
      <strong>{serviceUnavailable ? labels.serviceUnavailable : title}</strong>
      </span>
      {(author || event.created_at !== undefined) && <span className="aino-group-notice-meta">
      {author && <span>{author}</span>}
      <EventTime timestamp={event.created_at} />
      </span>}
      <span className="aino-group-notice-disclosure"><span>{labels.details}</span><sdk.Codicon name="chevron-down" /></span>
    </summary>
    <div className="aino-group-notice-content">
      {serviceUnavailable && <p className="aino-group-notice-hint">{labels.serviceUnavailableHint}</p>}
      {(details || event.payload.member_id) && <pre data-selectable-text="true">{[details, event.payload.member_id].filter(Boolean).join('\n')}</pre>}
    </div>
  </details>
}

// Previews download the whole file over RPC; larger or unsized images keep only Download.
const IMAGE_PREVIEW_MAX_BYTES = 5 * 1024 * 1024

// Automatic previews share a small download budget per connection, in request order; a file already
// downloading is joined rather than requested again. Manual Download stays outside it. The budget is
// per connection because a remote whose dial hangs holds its slots for good, and must not stall others.
type Preview = Awaited<ReturnType<typeof fetchCanonicalGroupAttachment>>
interface PreviewQueue { slots: number; waiters: Array<() => void> }
const previewDownloads = new Map<string, Promise<Preview>>()
const previewQueues = new Map<string, PreviewQueue>()

function releasePreviewSlot(queue: PreviewQueue) {
  const next = queue.waiters.shift()

  if (next) {next()} else {queue.slots++}
}

function queuePreview(connectionId: string, key: string, fetch: () => Promise<Preview>, onPreview: (preview: Preview) => void) {
  const queue = previewQueues.get(connectionId) ?? { slots: 2, waiters: [] }
  previewQueues.set(connectionId, queue)
  let cancelled = false
  const deliver = (download: Promise<Preview>) => void download.then(preview => { if (!cancelled) {onPreview(preview)} }, () => undefined)

  const run = () => {
    let download = previewDownloads.get(key)

    if (download) {releasePreviewSlot(queue)} else {
      download = fetch().finally(() => { previewDownloads.delete(key); releasePreviewSlot(queue) })
      previewDownloads.set(key, download)
    }

    deliver(download)
  }

  const running = previewDownloads.get(key)

  if (running) {deliver(running)} else if (queue.slots > 0) {queue.slots--; run()} else {queue.waiters.push(run)}

  // A preview that leaves before its turn gives up its place without sending a request.
  return () => {
    cancelled = true
    const at = queue.waiters.indexOf(run)

    if (at >= 0) {queue.waiters.splice(at, 1)}
  }
}

function ImagePreview({ binding, eventId, attachment, disabled }: {
  binding: CanonicalGroupBinding; eventId: string; attachment: CanonicalGroupAttachment; disabled: boolean
}) {
  const [src, setSrc] = useState('')
  const [near, setNear] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const { attachment_id: attachmentId, size } = attachment
  const { connectionId, profile, roomId } = binding
  const previewable = !!attachmentId && size !== undefined && size <= IMAGE_PREVIEW_MAX_BYTES

  // History loads the whole room: fetch only near the viewport. Leaving before its turn gives up the queued place;
  // a started download runs to completion and is shared if the preview returns.
  useEffect(() => {
    const el = box.current

    if (src || disabled || !el) {return}
    const observer = new IntersectionObserver(entries => setNear(entries[entries.length - 1].isIntersecting), { rootMargin: '200px' })
    observer.observe(el)

    return () => observer.disconnect()
  }, [src, disabled])

  useEffect(() => {
    if (disabled || !near || !attachmentId || !previewable) {return}
    let url = ''
    const key = JSON.stringify([connectionId, profile, roomId, eventId, attachmentId])

    // A failed preview leaves the Download button as the way to the file.
    const cancel = queuePreview(connectionId, key, () => fetchCanonicalGroupAttachment({ connectionId, profile, roomId }, eventId, attachmentId), ({ bytes, mime }) => {
      url = URL.createObjectURL(new Blob([bytes], { type: mime }))
      setSrc(url)
    })

    // Dropping `near` makes a re-shown room wait on the observer again, not refetch every preview seen so far at once.
    return () => { cancel(); URL.revokeObjectURL(url); setSrc(''); setNear(false) }
  }, [connectionId, profile, roomId, eventId, attachmentId, disabled, near, previewable])

  return previewable ? <div ref={box}>{src && <img alt={attachment.name} className="max-h-64 max-w-full rounded object-contain" src={src} />}</div> : null
}

export function CanonicalGroupHistory({ binding, events, members = [], disabled = false, onMention, searchQuery = '' }: CanonicalGroupHistoryProps) {
  const labels = useCanonicalGroupLabels()
  const { nameFor } = useCanonicalMembers(binding)
  const roster = new Map(members.map(member => [member.member_id, member]))

  const identities = [...members.map(member => ({ handle: member.handle, label: nameFor(member) })),
    { handle: 'everyone', label: labels.allMembers }, { handle: 'all', label: labels.allMembers }]

  const notices = new Map([
    ['turn.failed', labels.turnFailed],
    ['turn.cancelled', labels.turnCancelled],
    ['turn.deferred', labels.turnDeferred],
    ['member.unavailable', labels.memberUnavailable],
    ['room.stop_requested', labels.roomStopped],
    ['room.disbanded', labels.roomDisbanded],
    ['authority.lost', labels.authorityLost]
  ])

  const query = searchQuery.trim().toLocaleLowerCase()

  const visibleEvents = events.flatMap(event => {
    const ended = (!event.room_id || event.room_id === binding.roomId) && event.kind === 'room.activity' && event.payload.status === 'settled'

    const notice = event.kind === 'room.activity' && event.payload.status === 'bounded'
      ? labels.workLimitReached : notices.get(event.kind)

    const isMessage = event.kind === 'message' || event.kind === 'message.user' || event.kind === 'message.member'

    if (!notice && !isMessage && !ended) {return []}

    return [{ event, notice, isMessage, ended }]
  })

  if (!visibleEvents.length) {
    return <div className="aino-group-empty">
      <div aria-hidden="true" className="aino-group-empty-avatars">
        {members.slice(0, 4).map(member => <CanonicalMemberAvatar binding={binding} key={member.member_id} member={member} size={42} />)}
      </div>
      <h2>{labels.emptyTitle}</h2>
      <p>{labels.emptyHint}</p>
    </div>
  }

  return <>{visibleEvents.map(({ event, notice, isMessage, ended }) => {
    if (ended) {return <div className="aino-group-system-line" data-event-seq={event.seq} key={event.seq}>
      <sdk.Codicon name="dash" /><span>{labels.roundEnded}</span><EventTime timestamp={event.created_at} />
    </div>}

    const member = eventMember(event, roster, isMessage)
    const author = eventAuthor(event, member, isMessage, nameFor, labels.memberGeneric)
    const unknownMember = !member && author === labels.memberGeneric

    if (notice) {return <EventNotice author={author} event={event} key={event.seq} title={notice} />}

    const previewEventId = event.room_id === binding.roomId ? event.event_id : undefined
    const text = event.payload.text || event.payload.content || ''
    // The room log identifies a user principal, not whether it is this desktop's user.
    // Human messages use the right side without replacing their historical author with “me”.
    const human = event.kind === 'message.user' || event.actor?.kind === 'user'
    const avatarMember = member ?? { member_id: event.actor?.id ?? '', profile: event.actor?.id ?? '', handle: author ?? '' }

    const matches = canonicalGroupMessageMatches(event, binding, roster, query, nameFor, labels.allMembers, labels.memberGeneric)

    return <article className="aino-group-message" data-event-seq={event.seq} data-own={human ? 'true' : 'false'}
      data-search-dim={query ? !matches : undefined} data-search-match={query ? matches : undefined} key={event.seq}>
      <div aria-hidden="true" className="aino-group-message-avatar">
        {human ? <span className="aino-group-human-avatar"><sdk.Codicon name="account" /></span>
          : <CanonicalMemberAvatar binding={binding} member={avatarMember} size={32} />}
      </div>
      <div className="aino-group-message-main">
        <div className="aino-group-message-meta">
          {author && <strong title={unknownMember ? event.actor?.id : undefined}>{author}</strong>}
          <EventTime timestamp={event.created_at} />
        </div>
        <div className="aino-group-message-bubble">
          {text && <EventBody event={event} identities={identities} />}
          {previewEventId && event.payload.attachments?.filter(a => a.kind === 'image').map(a =>
            <ImagePreview attachment={a} binding={binding} disabled={disabled} eventId={previewEventId} key={a.attachment_id ?? a.name} />)}
          {!!event.payload.attachments?.length && <CanonicalGroupAttachments
            attachments={event.payload.attachments.map(attachment => ({ ...attachment, event_id: event.event_id }))}
            binding={binding} disabled={disabled || !event.event_id || event.room_id !== binding.roomId} readOnly />}
        </div>
        <div className="aino-group-message-actions">
          {member && onMention && <sdk.Tip label={labels.reply}>
            <sdk.Button aria-label={`${labels.reply} ${nameFor(member)}`} disabled={disabled} onClick={() => onMention(member)} size="icon" type="button" variant="ghost">
              <sdk.Codicon name="reply" />
            </sdk.Button>
          </sdk.Tip>}
          {!!text.trim() && <sdk.CopyButton appearance="icon" buttonSize="icon" text={text} />}
        </div>
      </div>
    </article>
  })}</>
}
