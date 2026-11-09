import './canonical-group.css'

import {
  Button,
  Codicon,
  Dialog,
  DialogContent,
  DialogTitle,
  SearchField,
  useResizeObserver,
  useStickToBottom
} from '@hermes/plugin-sdk'
import type { GroupConversationModelRequest } from '@hermes/plugin-sdk'
import { useCallback, useId, useRef, useState } from 'react'

import { type CanonicalDriverStatus, canonicalMemberPhases } from './canonical-group-activity'
import { type CanonicalGroupAttachment, CanonicalGroupAttachments } from './canonical-group-attachments'
import { type GroupMethods, offersGroupMethod, offersGroupSafetyMethod } from './canonical-group-capabilities'
import { CanonicalGroupComposer } from './canonical-group-composer'
import { CanonicalGroupHeader, CanonicalGroupInfo } from './canonical-group-header'
import {
  type CanonicalGroupEvent,
  CanonicalGroupHistory,
  canonicalGroupMessageMatches
} from './canonical-group-history'
import { useCanonicalGroupLabels } from './canonical-group-labels'
import { useCanonicalMembers } from './canonical-group-members'
import { CanonicalGroupRoomSettings } from './canonical-group-room-settings'
import type {
  CanonicalGroupBinding,
  CanonicalPendingAction,
  CanonicalRoom,
  CanonicalRoomContext,
  CanonicalRoomMember
} from './canonical-groups'
import type { GroupMentionInputHandle } from './group-chat-parts'

export interface CanonicalGroupSurfaceState {
  room: CanonicalRoom & { authority_epoch?: number }
  context?: CanonicalRoomContext | null
  driver_status?: CanonicalDriverStatus<CanonicalPendingAction> & { max_continues?: number; routing_modes?: string[] }
  model_requests?: GroupConversationModelRequest[]
}

export interface CanonicalGroupSurfaceProps {
  mainTab?: boolean
  methods?: GroupMethods
  stopping?: boolean
  sending?: boolean
  journalError?: string
  notice?: string
  sendHint?: string
  reply?: { name: string; quote: string; thread?: string } | null
  onAbandonRetry?: () => void
  onCancelReply?: () => void
  onContinue?: (discussionEventId: string) => unknown
  onReply?: (member: CanonicalRoomMember | undefined, text: string, thread: string | undefined, author: string) => void
  onJournalReload?: () => void
  binding: CanonicalGroupBinding
  state: CanonicalGroupSurfaceState | null
  events: CanonicalGroupEvent[]
  draft: string
  attachments: CanonicalGroupAttachment[]
  restored: boolean
  pending: boolean
  restoredPending: boolean
  busy: boolean
  uploading: boolean
  visible: boolean
  error: string
  readError: string
  onDraftChange: (draft: string) => void
  onAttachmentsChange: (attachments: CanonicalGroupAttachment[]) => void
  onUploadingChange: (uploading: boolean) => void
  onAction: (action: CanonicalPendingAction, choice?: 'once' | 'deny') => Promise<void>
  onBack?: () => void
  onDisband: () => Promise<void>
  onRename: (name: string) => void
  onRefresh: () => void
  onSend: () => void
  onStop: () => void
}

function surfacePresentation(state: CanonicalGroupSurfaceState | null, restored: boolean, busy: boolean, pending: boolean) {
  const members = state?.room.members ?? []
  const phases = canonicalMemberPhases(state?.driver_status)
  const working = !!state?.driver_status?.working || phases.size > 0
  const locked = !restored || busy || pending || !!state?.room.disbanded_at

  return { members, phases, working, locked }
}

/** Presentation stays room-local. All mutations and durable send intents remain in the workspace. */
export function CanonicalGroupSurface(props: CanonicalGroupSurfaceProps) {
  const { binding, state, events, restored, pending, busy, visible, onBack, onDisband, onRename, onStop } = props

  const labels = useCanonicalGroupLabels()
  const { nameFor } = useCanonicalMembers(binding)
  const { scrollRef, contentRef } = useStickToBottom({ initial: 'instant', resize: 'instant' })
  const root = useRef<HTMLElement>(null)
  const input = useRef<GroupMentionInputHandle>(null)
  const search = useRef<HTMLInputElement>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const [narrow, setNarrow] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const mentionAfterClose = useRef<string | null>(null)
  const infoId = useId()
  const { members, phases, working, locked } = surfacePresentation(state, restored, busy, pending)

  const resize = useCallback((entries: readonly ResizeObserverEntry[]) => {
    if (entries[0]) {
      setNarrow(entries[0].contentRect.width < 1100)
    }
  }, [])

  useResizeObserver(resize, root)

  const mention = (member: CanonicalRoomMember) => {
    // Frozen handles, never the mutable display title, are the gateway's mention addresses.
    if (narrow && infoOpen) {
      mentionAfterClose.current = member.handle
      setInfoOpen(false)
    } else {
      input.current?.mention(member.handle)
    }
  }

  const toggleSearch = () => {
    setSearchOpen(!searchOpen)

    if (searchOpen) {
      setQuery('')
    } else {
      requestAnimationFrame(() => search.current?.focus())
    }
  }

  const groupFiles = events.flatMap(event =>
    event.room_id === binding.roomId && event.event_id
      ? (event.payload.attachments ?? []).map(attachment => ({ ...attachment, event_id: event.event_id }))
      : []
  )

  const files = groupFiles.length ? (
    <CanonicalGroupAttachments attachments={groupFiles} binding={binding} disabled={!visible} downloads={offersGroupMethod(props.methods, 'groups.attachment.download')} readOnly />
  ) : undefined

  const info = (
    <CanonicalGroupInfo
      available={state ? !!state.driver_status : undefined}
      binding={binding}
      busy={busy}
      canDisband={offersGroupMethod(props.methods, 'groups.disband')}
      canRename={offersGroupMethod(props.methods, 'groups.rename')}
      driver={state?.driver_status}
      files={files}
      id={infoId}
      management={<CanonicalGroupRoomSettings autoRouting={!!state?.driver_status?.routing_modes?.includes('auto')} binding={binding}
        context={state?.context} disabled={busy || !offersGroupMethod(props.methods, 'groups.context')} members={members.map(member => ({ ...member, display_name: nameFor(member) }))} onSaved={props.onRefresh} />}
      onClose={() => setInfoOpen(false)}
      onDisband={onDisband}
      onMention={locked ? undefined : mention}
      onRename={onRename}
      phases={phases}
      renderPane={(pane, managing) =>
        narrow ? (
          <Dialog onOpenChange={setInfoOpen} open={visible && infoOpen && narrow && !managing}>
            <DialogContent
              aria-describedby={undefined}
              bodyClassName="aino-group-info-dialog-body"
              className="aino-group-info-dialog"
              onCloseAutoFocus={event => {
                const handle = mentionAfterClose.current

                if (handle !== null) {
                  event.preventDefault()
                  mentionAfterClose.current = null
                  input.current?.mention(handle)
                }
              }}
              showCloseButton={false}
            >
              <DialogTitle className="sr-only">{labels.groupInfo}</DialogTitle>
              {pane}
            </DialogContent>
          </Dialog>
        ) : (
          pane
        )
      }
      room={state?.room}
      visible={visible}
    />
  )

  const searchTerm = query.trim().toLocaleLowerCase()

  const roster = new Map(members.map(member => [member.member_id, member]))

  const matches = events.filter(event =>
    canonicalGroupMessageMatches(event, binding, roster, searchTerm, nameFor, labels.allMembers, labels.memberGeneric)
  ).length

  return (
    <section aria-label={state?.room.name || labels.loadingGroup} className="aino-group-workspace" ref={root}>
      <CanonicalGroupHeader
        available={state ? !!state.driver_status : undefined}
        binding={binding}
        busy={busy}
        canStop={working}
        driver={state?.driver_status}
        infoOpen={infoOpen}
        infoPanelId={`${infoId}-panel`}
        mainTab={props.mainTab}
        onBack={onBack}
        onDisband={onDisband}
        onInfoOpenChange={setInfoOpen}
        onMention={locked ? undefined : mention}
        onRename={onRename}
        onSearch={toggleSearch}
        onStop={onStop}
        phases={phases}
        room={state?.room}
      />
      <div className="aino-group-layout">
        <div className="aino-group-chat">
          {searchOpen && (
            <div className="aino-group-search">
              <SearchField
                aria-label={labels.searchMessages}
                containerClassName="flex-1"
                inputRef={search}
                onChange={setQuery}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    toggleSearch()
                  }
                }}
                placeholder={labels.searchPlaceholder}
                value={query}
                variant="box"
              />
              {searchTerm && <span aria-live="polite">{matches || labels.noResults}</span>}
              <Button aria-label={labels.closeSearch} onClick={toggleSearch} size="icon-sm" variant="ghost">
                <Codicon name="close" />
              </Button>
            </div>
          )}
          <div className="aino-group-messages-scroll" ref={scrollRef} role="log">
            <div className="aino-group-messages" ref={contentRef}>
              <CanonicalGroupHistory
                binding={binding}
                disabled={!visible}
                downloads={offersGroupMethod(props.methods, 'groups.attachment.download')}
                events={events}
                members={members}
                onMention={locked ? undefined : mention}
                onReply={locked ? undefined : props.onReply}
                pause={{ busy, stopping: props.stopping, maxContinues: state?.driver_status?.max_continues,
                  onContinue: offersGroupMethod(props.methods, 'groups.continue') ? props.onContinue : undefined,
                  onStop: offersGroupSafetyMethod(props.methods, 'groups.stop') ? onStop : undefined }}
                searchQuery={query}
              />
            </div>
          </div>
          <CanonicalGroupComposer {...props} inputRef={input} />
        </div>
        {infoOpen && info}
      </div>
    </section>
  )
}
