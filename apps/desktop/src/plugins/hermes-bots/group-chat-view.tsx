/**
 * The group-chat room surface: the merged room view, its settings dialog, the
 * MAIN-window tab it opens into, and the two room-lifecycle mutations that
 * surface drives — disband and rename.
 *
 * Disband and rename live here rather than beside the pane registry because a
 * rename re-opens the room's main tab, and that tab renders this file's
 * workspace: settings dialog → rename → open → main view → workspace is one
 * cycle, so it is one module. The tab registry and the composer drafts they
 * touch stay below, in `group-panes.ts`.
 */

import * as sdk from '@hermes/plugin-sdk'
import {
  Alert,
  AlertDescription,
  atom,
  Button,
  cn,
  Codicon,
  ConfirmDialog,
  CopyButton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  host,
  Input,
  queryClient,
  relativeTime,
  RowButton,
  Tip,
  ToggleRow,
  useGatewayActivationEpoch,
  useI18n,
  useValue
} from '@hermes/plugin-sdk'
import type { ClipboardEvent, DragEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { groupCreationSource, groupDrivenByDesktop, groupExecutionMode } from './canonical-group-capabilities'
import type { GroupExecutionMode } from './canonical-group-capabilities'
import type { CanonicalGroupMessages } from './canonical-group-locales'
import type { CanonicalGroupOrigin } from './canonical-group-registry'
import {
  $canonicalGroupBindings,
  canonicalGroupBindingFor,
  canonicalGroupKeyRoute,
  publishCanonicalGroup,
  refreshGatewayGroupRooms,
  registerCanonicalGroup,
  resolveCanonicalGroup
} from './canonical-group-registry'
import { CanonicalGroupWorkspace } from './canonical-group-workspace'
import { canonicalGroupCreateError, canonicalGroupRequest, canonicalGroupRoster, createCanonicalGroup, onCanonicalConnection } from './canonical-groups'
import type { CanonicalGroupRoute } from './canonical-groups'
import {
  $botMeta,
  $lastRoster,
  botHandle,
  botMetaV2Active,
  botSourceStatus,
  noteBotMetaWrite,
  persistBotMetaSnapshot,
  ROSTER_KEY,
  saveBotMeta
} from './data'
import {
  $groupActivity,
  currentGroupActivity,
  GROUP_ACTIVITY_GLYPHS,
  groupActivityLabel,
  groupActivityTone
} from './group-activity'
import type { GroupActivityEntry } from './group-activity'
import { filesToGroupAttachments, pickGroupAttachments } from './group-attachments'
import {
  $groupChats,
  $groupChatWorkspace,
  $groupClarify,
  $groupNeedsYou,
  groupChatRoomKey,
  groupThreadOf,
  rememberGroupChatTombstone,
  scheduleGroupChatServerSync,
  setGroupChatHoldDetection,
  setGroupChatImage,
  updateGroupChat
} from './group-chat'
import type { GroupChatRoom } from './group-chat'
import { GroupClarifyCard, GroupImageControls, GroupMentionInput } from './group-chat-parts'
import type { GroupRoomPrompt } from './group-chat-parts'
import { GroupMemberPicker } from './group-chat-view-members'
import { compressGroupMemberHistory } from './group-compress'
import { stickyGroupEngine } from './group-engine'
import { sweepExternalGroupWrites } from './group-external-writes'
import { GroupHoldStatus } from './group-hold-status'
import {
  botGroups,
  groupChatMemberBots,
  groupDisbandMetadataPlan,
  groupMemberKey,
  groupWorkspaceOwnerKey,
  liveGroupChatNames
} from './group-membership'
import { groupMentionComponents, groupMentionText } from './group-mention-text'
import {
  $groupComposerDraftEpoch,
  clearGroupComposerDraft,
  closeGroupChatMainTab,
  dropGroupMainTab,
  groupChatMainTabs,
  groupComposerDraftKey,
  groupComposerDraftSnapshot,
  groupOpenRoute,
  migrateGroupComposerDraft,
  recordGroupMainTab,
  recordGroupOpenOrigin,
  restoreGroupComposerDraft
} from './group-panes'
import { ROOM_AVATAR_SIZE } from './group-room-ui'
import { groupReplyMentionTag, sendToGroupChat, stopGroupThread } from './group-rounds'
import { clearGroupClarify, renameGroupClarify } from './group-turns'
import { botsText, useBots } from './i18n'
import { displayName } from './labels'
import { useLegacyGroupBrowserHandoff, useLegacyGroupComposer } from './legacy-group-composer'
import {
  legacyGroupMentionScope,
  legacyGroupRecipientNames,
  unresolvedLegacyGroupMentions
} from './legacy-group-mentions'
import { LegacyGroupMenu } from './legacy-group-menu'
import { LegacyGroupReplyStatus } from './legacy-group-reply-status'
import { legacyGroupActivitySummary } from './legacy-group-status'
import { botRosterMeta, groupTranscriptSpeaker, groupTranscriptSpeakerMeta, setBotsWorkspaceOwner } from './routing'
import { bumpBotOpenGeneration, getPluginCtx, ID } from './shared'
import type { Attachment, BotMeta, GroupChat, GroupMember, GroupMessage, RosterRow } from './types'

const Streamdown = typeof sdk === 'undefined' ? undefined : sdk.Streamdown
// The 1:1 chat's message renderer: `MEDIA:` lines become inline players and
// images instead of a raw path (#93728), and a fenced block gets the app's own
// code card — stock Streamdown lays a code block's header and body out as
// inline siblings, so the body sat shifted right and its tail was clipped with
// no scrollbar (#91878). Feature-detected: an older shell without the export
// keeps the raw Streamdown path.
const MessageTextContent = typeof sdk === 'undefined' ? undefined : sdk.MessageTextContent

/** Soft-disband a group chat: remove only this group from every local member's
 *  membership list (the metadata syncs cross-machine via ui_meta), drop the
 *  room log from the atom + plugin storage, and close the room view if it's
 *  open. Other group memberships and the members' per-group gateway sessions
 *  ("Group: <roomId>", or legacy "Group: <name>") are intentionally KEPT. */
export async function disbandGroupChat(group: string, members: RosterRow[]) {
  // Invalidate any in-flight round-robin FIRST: bump the epoch so a running
  // drive bails at its next member boundary instead of appending to a room
  // the user just discarded.
  const all = {
    ...$groupChats.get()
  }

  const prior = all[group] || {}
  const metaBefore = $botMeta.get()
  const cleanup = groupDisbandMetadataPlan(group, members, prior, $lastRoster.get(), metaBefore)
  let metadataPersistence: Promise<unknown> = Promise.resolve()

  if (cleanup.patches.size) {
    const nextMeta = {
      ...metaBefore
    }

    for (const [key, patch] of cleanup.patches) {
      nextMeta[key] = {
        ...(nextMeta[key] || {}),
        ...patch
      }
      noteBotMetaWrite(key)
    }

    // Paint the deletion before any remote write can stall. This also removes
    // orphaned legacy metadata that cannot safely be routed to a source.
    $botMeta.set(nextMeta)
    metadataPersistence = persistBotMetaSnapshot(
      nextMeta,
      botMetaV2Active || Object.keys(nextMeta).some(key => key.includes('::'))
    )
  }

  delete all[group]

  // Remember the disband durably BEFORE any remote write can stall: the
  // pending sync job alone forgets it once the retry ladder gives up or the
  // window closes, and a gateway mirror that missed the tombstone push would
  // resurrect the room on every later pull (#105275).
  await rememberGroupChatTombstone(group, prior.roomId, prior.syncRevision)

  // Keep a runtime-only tombstone while a drive may still be mid-turn; it
  // carries no log and is flagged so persistence and name-dedup skip it —
  // updateGroupChat writes the WHOLE atom map, so an unflagged tombstone
  // would be persisted by the next unrelated room write and its name would
  // count as taken, suffixing a same-name recreate to "<name> 2" forever.
  if (prior.running) {
    all[group] = {
      log: [],
      watermarks: {},
      sessions: {},
      epoch: (prior.epoch || 0) + 1,
      running: false,
      tombstone: true
    }
  }

  $groupChats.set(all)

  if ($groupChatWorkspace.get() === group) {
    $groupChatWorkspace.set(null)
  }

  // Retire the room's MAIN-window tab too (host.openWorkspace path).
  closeGroupChatMainTab(group)

  const needs = {
    ...$groupNeedsYou.get()
  }

  delete needs[group]
  $groupNeedsYou.set(needs)
  clearGroupClarify(group)

  // Persist the room map WITHOUT the disbanded room so it can't come back
  // on the next window load.
  try {
    const durable: Record<string, GroupChat> = {}

    for (const [name, room] of Object.entries($groupChats.get())) {
      if (name !== group && Array.isArray(room.log)) {
        durable[name] = {
          log: room.log,
          watermarks: room.watermarks,
          sessions: room.sessions || {},
          sessionOwners: room.sessionOwners || {},
          members: Array.isArray(room.members) ? room.members : [],
          roomId: typeof room.roomId === 'string' && room.roomId ? room.roomId : null,
          ...stickyGroupEngine(room),
          image: room.image || null,
          syncRevision: Math.max(0, Number(room.syncRevision || 0))
        }
      }
    }

    await Promise.resolve(getPluginCtx()?.storage?.set?.('group-chats', durable))
  } catch {
    /* storage unavailable — the atom reset above still empties the room */
  }

  scheduleGroupChatServerSync($groupChats.get(), {
    allowEmpty: true,
    deletedRooms: [group]
  })
  await metadataPersistence

  // Persist the cleanup to every exact owner we can prove. saveBotMeta never
  // throws (local storage + best-effort profiles.configure per owner), so a
  // flaky gateway cannot strand the local disband halfway.
  for (const [key, owner] of cleanup.owners) {
    const patch = cleanup.patches.get(key)

    if (patch) {
      await saveBotMeta(owner, patch)
    }
  }

  // Converge on server truth: the cached roster still carries the pre-disband
  // ui_meta (the write-fence in mergeServerMeta keeps it from resurrecting
  // the membership, but a fresh snapshot is what makes every surface agree).
  if (typeof queryClient !== 'undefined' && queryClient?.invalidateQueries) {
    queryClient.invalidateQueries({
      queryKey: ROSTER_KEY
    })
  }
}

/** Rename a group chat. The group's NAME is its identity everywhere — the
 *  room-map key, each local member's ui_meta membership list, and derived
 *  state — so a rename re-keys all of them. Member gateway sessions are kept
 *  as-is: stored sids keep resuming, so no history is lost. The room's
 *  immutable roomId (the member-session title) is preserved across the
 *  rename, so even a member whose sid is later lost falls back to the same
 *  "Group: <roomId>" title lookup instead of a fresh "Group: <new name>".
 *  Returns the new name, or null when the target name is taken. */
export async function renameGroupChat(oldName: string, newName: string, members: GroupMember[] | null | undefined) {
  const next = String(newName || '')
    .trim()
    .slice(0, 64)

  if (!next || next === oldName) {
    return oldName
  }

  // Renames are explicit user intent: reject a collision honestly instead of
  // silently suffixing like creation does. Disband tombstones don't hold
  // their name — the room is gone, only its epoch survives briefly.
  const taken = new Set(liveGroupChatNames())

  for (const meta of Object.values($botMeta.get() || {})) {
    for (const existing of botGroups(meta)) {
      taken.add(existing)
    }
  }

  taken.delete(oldName)

  if (taken.has(next)) {
    host.notify({
      kind: 'error',
      message: botsText().group.nameTaken(next)
    })

    return null
  }

  // Move the room record wholesale — log, watermarks, sessions, members,
  // picture, and runtime flags all belong to the same room under its new name.
  const all: Record<string, GroupChat> = {
    ...$groupChats.get()
  }

  const room = all[oldName]

  if (room) {
    migrateGroupComposerDraft(groupComposerDraftKey(oldName, room), groupComposerDraftKey(next, room))
  }

  delete all[oldName]

  if (room) {
    all[next] = room
  }

  $groupChats.set(all)

  const needs: Record<string, boolean> = {
    ...$groupNeedsYou.get()
  }

  if (oldName in needs) {
    needs[next] = needs[oldName]
    delete needs[oldName]
    $groupNeedsYou.set(needs)
  }

  // Mirrored clarify cards key by group name; a pending prompt's attention
  // must follow the room to its new name, not disappear.
  renameGroupClarify(oldName, next)

  // Local memberships: swap the name inside each member's canonical groups
  // list (syncs cross-machine via ui_meta). Remote members' seating lives in
  // the room record we just moved.
  for (const member of members || []) {
    if (!member?.name) {
      continue
    }

    const meta = botRosterMeta(member, $botMeta.get()) || {}
    const groups = [...new Set(botGroups(meta).map(g => (g === oldName ? next : g)))]
    await saveBotMeta(member, {
      groups,
      group: groups[0] || null
    })
  }

  // Persist the re-keyed map (updateGroupChat writes the whole durable map).
  updateGroupChat(next, (r: GroupChatRoom) => r, {
    sync: false
  })
  // A rename is one revisioned state transition: the new identity is updated
  // and the old identity is tombstoned together, so cold hydration cannot
  // merge the pre-rename room back into the roster.
  scheduleGroupChatServerSync($groupChats.get(), {
    changedRooms: [next],
    deletedRooms: [oldName]
  })

  // Follow the open views to the new identity.
  if ($groupChatWorkspace.get() === oldName) {
    $groupChatWorkspace.set(next)
  }

  if (groupChatMainTabs.has(oldName)) {
    const route = groupOpenRoute(oldName)
    closeGroupChatMainTab(oldName)
    openGroupChat(next, 'name', route)
  }

  // Same convergence as disband: drop the pre-rename roster snapshot so the
  // old name can't linger anywhere the fence doesn't cover.
  if (typeof queryClient !== 'undefined' && queryClient?.invalidateQueries) {
    queryClient.invalidateQueries({
      queryKey: ROSTER_KEY
    })
  }

  return next
}

interface GroupChatSettingsDialogProps {
  group: string
  members?: GroupMember[]
  onClose: () => void
  onManageMembers?: () => void
  onRenamed?: (group: string) => void
  open: boolean
}

/** Edit an existing group chat's name and picture. Renames re-key the room
 *  and every local member's membership (renameGroupChat); the picture rides
 *  the room record. Both apply on Save so a cancelled dialog changes nothing. */
function GroupChatSettingsDialog({
  group,
  members,
  open,
  onClose,
  onManageMembers,
  onRenamed
}: GroupChatSettingsDialogProps) {
  const { t } = useI18n()
  const b = useBots()
  const rooms: Record<string, GroupChatRoom> = useValue($groupChats)
  const current = (rooms[group] || {}).image || null
  const currentHoldDetection = (rooms[group] || {}).holdDetection !== false
  const [name, setName] = useState(group)
  const [image, setImage] = useState(current)
  const [holdDetection, setHoldDetection] = useState(currentHoldDetection)
  const [compressing, setCompressing] = useState<null | string>(null)
  useEffect(() => {
    if (open) {
      setName(group)
      setImage(current)
      setHoldDetection(currentHoldDetection)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group])

  // Per-member "Compress history" (#102291): the member's hidden plumbing
  // session is reachable from nowhere else, so the room that shows the
  // symptom (empty replies) owns the repair. One member at a time — the
  // gateway refuses a second compress while one holds the lock.
  const compressMember = async (member: GroupMember) => {
    const memberName = displayName(member, botRosterMeta(member, $botMeta.get()))
    setCompressing(groupMemberKey(member))
    host.notify({ kind: 'info', message: b.group.compressing(memberName) })

    try {
      const outcome = await compressGroupMemberHistory(group, member)

      if (outcome.compressed === 0 && outcome.pending === 0) {
        host.notify({ kind: 'info', message: b.group.compressNothing(memberName) })
      } else {
        host.notify({
          kind: 'success',
          message: b.group.compressDone(memberName, outcome.compressed + outcome.pending, outcome.lines.join('; '))
        })
      }
    } catch (error) {
      host.notify({
        kind: 'error',
        message: b.group.compressFailed(memberName, error instanceof Error ? error.message : String(error))
      })
    } finally {
      setCompressing(null)
    }
  }

  const save = async () => {
    const finalName = await renameGroupChat(group, name, members)

    if (finalName === null) {
      return // collision — dialog stays open for a different name
    }

    if (image !== current) {
      setGroupChatImage(finalName, image)
    }

    if (holdDetection !== currentHoldDetection) {
      setGroupChatHoldDetection(finalName, holdDetection)
    }

    onClose()

    if (finalName !== group) {
      onRenamed?.(finalName)
    }
  }

  return (
    <Dialog
      onOpenChange={value => {
        if (!value) {
          onClose()
        }
      }}
      open={open}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{b.group.settingsTitle}</DialogTitle>
          <DialogDescription>{b.group.settingsDesc}</DialogDescription>
        </DialogHeader>
        <GroupImageControls
          image={image}
          onImage={setImage}
          seedMembers={(members || []).map(member => member.name)}
          seedName={name.trim() || group}
        />
        <form
          onSubmit={event => {
            event.preventDefault()
            void save()
          }}
        >
          <Input
            aria-label={b.group.nameLabel}
            autoFocus
            maxLength={64}
            onChange={event => setName(event.target.value)}
            value={name}
          />
        </form>
        <ToggleRow
          checked={holdDetection}
          description={b.group.holdDetectionHint}
          label={b.group.holdDetection}
          onChange={setHoldDetection}
        />
        {(members || []).length > 0 ? (
          <ul className="flex flex-col gap-1" data-testid="group-settings-members">
            {(members || []).map(member => {
              const key = groupMemberKey(member)
              const memberName = displayName(member, botRosterMeta(member, $botMeta.get()))

              return (
                <li className="flex items-center justify-between gap-2 text-sm" key={key}>
                  <span className="truncate">{memberName}</span>
                  <Tip label={b.group.compressHistoryHint(memberName)}>
                    <Button
                      aria-label={`${b.group.compressHistory}: ${memberName}`}
                      disabled={compressing !== null}
                      onClick={() => void compressMember(member)}
                      size="sm"
                      variant="secondary"
                    >
                      <Codicon name={compressing === key ? 'loading' : 'fold'} spinning={compressing === key} />
                      {b.group.compressHistory}
                    </Button>
                  </Tip>
                </li>
              )
            })}
          </ul>
        ) : null}
        {onManageMembers ? (
          <Button
            className="w-fit"
            onClick={() => {
              onClose()
              onManageMembers()
            }}
            size="sm"
            variant="secondary"
          >
            <Codicon name="organization" />
            {`${b.canonical.manageMembers} (${(members || []).length})`}
          </Button>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose} variant="secondary">
            {t.common.cancel}
          </Button>
          <Button disabled={!name.trim()} onClick={() => void save()}>
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── threads: the Slack/Discord shape ─────────────────────────────────────────
// Every room entry belongs to a THREAD. Messaging the room composer starts a
// new thread with the whole group; replying inside a thread continues that
// work. Member turns are scoped to the thread that triggered them — deltas,
// watermarks, and responder resolution all key on the thread id.

interface GroupChatWorkspaceProps {
  group: string
  /** Where `group` came from (see CanonicalGroupOrigin). Defaults to 'name',
   *  which fails closed: a name never parses as a `canonical:` key. */
  origin?: CanonicalGroupOrigin
  /** The room opener freezes its source; foreground navigation never retargets it. */
  route?: CanonicalGroupRoute
  members: GroupMember[]
  onBack?: () => void
  /** Main tabs already expose Close; only the in-pane fallback needs Back. */
  mainTab?: boolean
  visible?: boolean
}

export function GroupChatWorkspace(props: GroupChatWorkspaceProps) {
  const draftEpoch = useValue($groupComposerDraftEpoch)
  const bindings = useValue($canonicalGroupBindings)
  const openedConnection = props.route?.connectionId
  const openedProfile = props.route?.profile

  const route = useMemo(
    () =>
      canonicalGroupKeyRoute(props.group, props.origin ?? 'name') ?? {
        connectionId: openedConnection ?? host.state.connectionId.get() ?? '',
        profile: openedProfile ?? host.state.profile.get()
      },
    [props.group, props.origin, openedConnection, openedProfile]
  )

  const binding = canonicalGroupBindingFor(bindings, route, props.group, props.origin ?? 'name')
  const record: GroupChatRoom | undefined = useValue($groupChats)[props.group]

  // The in-panel fallback has no tab to close, so leaving deselects the room, as in the legacy view.
  if (binding) {
    return (
      <CanonicalGroupWorkspace
        binding={binding}
        mainTab={props.mainTab}
        onBack={props.onBack ?? (() => $groupChatWorkspace.set(null))}
        showBack={!props.mainTab}
        visible={props.visible}
      />
    )
  }

  // Created across machines: no gateway here can own the room, so this Desktop
  // drives it, even after a membership edit leaves every bot on one machine.
  if (canonicalGroupKeyRoute(props.group, props.origin ?? 'name') === null && groupDrivenByDesktop(record, props.members, route.connectionId)) {
    return <LegacyGroupChatWorkspace {...props} key={draftEpoch} />
  }

  return <GroupExecutionGate {...props} key={draftEpoch} route={route} />
}

type GateLookup = 'pending' | 'missing' | 'failed'
interface GateOpenCopy { opening: string; lookupFailed: string; missing: string }
/** Why a gateway connection cannot open group chats right now; each reason has its own words. */
type GateUnavailable = 'unsupported' | 'stopped' | 'unreachable'

/** A server without the group surface (JSON-RPC method-not-found), or an answer this Desktop can't
 *  read, is too old; an answer whose room driver isn't running is stopped; anything else, a socket
 *  that isn't open included, did not reach the gateway. */
function gateUnavailable(value: unknown, error?: unknown): GateUnavailable {
  if (error !== undefined) {return (error as { code?: unknown } | null)?.code === -32601 ? 'unsupported' : 'unreachable'}

  return (value as { driver?: unknown } | null)?.driver === false ? 'stopped' : 'unsupported'
}

const UNAVAILABLE_COPY = { unsupported: 'groupsUnsupported', stopped: 'groupDriverStopped', unreachable: 'groupsUnreachable' } as const

interface GatePlan {
  classic: boolean
  message: string
  problem: string
  canCreate: boolean
  retry: 'capability' | 'lookup' | null
}

/** What a room with no gateway binding shows: on a classic connection its classic workspace, as on
 *  main; on a gateway connection (or while that is unknown) what happened, why, what to do, and what
 *  happens to its earlier messages. Only a classic room whose Bots can form a gateway group here is
 *  offered Start new group. Workspace routing decides which rooms reach this gate. */
function groupGatePlan({ mode, unavailable, lookup, props, route, canonical, open }: {
  mode: GroupExecutionMode | 'checking'
  unavailable: GateUnavailable
  lookup: GateLookup
  props: GroupChatWorkspaceProps
  route: { connectionId: string; profile: string }
  canonical: CanonicalGroupMessages
  open: GateOpenCopy
}): GatePlan {
  const plan = { classic: false, problem: '', canCreate: false, retry: null }

  if (mode === 'legacy') {return { ...plan, classic: true, message: '' }}

  if (mode !== 'canonical') {
    return mode === 'checking' ? { ...plan, message: canonical.checkingDriver }
      : { ...plan, message: canonical[UNAVAILABLE_COPY[unavailable]], retry: 'capability' }
  }

  // A `canonical:` key names an existing gateway room; it never seeds a new one.
  const classicRoom = canonicalGroupKeyRoute(props.group, props.origin ?? 'name') === null

  if (lookup !== 'missing') {
    const message = lookup === 'pending' ? open.opening : classicRoom ? canonical.groupsUnreachable : open.lookupFailed

    return { ...plan, message, retry: lookup === 'pending' ? null : 'lookup' }
  }

  if (!classicRoom) {return { ...plan, message: open.missing, retry: 'lookup' }}
  const checked = canonicalGroupRoster(route, props.members)

  if (!('problem' in checked)) {return { ...plan, message: canonical.legacyRoom, canCreate: true }}

  if (checked.problem !== 'otherConnection') {
    return { ...plan, message: canonical.legacyRoomBlocked, problem: canonicalGroupCreateError({ canonicalGroupProblem: checked.problem }, canonical) }
  }

  const elsewhere = [...new Set(props.members.filter(member => !onCanonicalConnection(route, member))
    .map(member => member.connectionLabel || member.connectionId).filter((label): label is string => Boolean(label)))]

  return { ...plan, message: canonical.legacyRoomElsewhere,
    problem: elsewhere.length ? canonical.otherConnections.replace('{connections}', elsewhere.join(', ')) : '' }
}

/** A classic room's earlier messages under the gate: read only and fully inert (no MEDIA:, file or
 *  session resolution, no directive cards; only a public web link opens, on a click). */
function GateEarlierMessages({ room, labels }: { room: GroupChatRoom | undefined; labels: CanonicalGroupMessages }) {
  if (!room?.log?.length) {return null}

  return <section aria-label={labels.earlierMessages} className="grid gap-2 border-t border-(--ui-stroke-secondary) pt-3">
    <p className="text-xs text-(--ui-text-tertiary)">{labels.earlierMessages}</p>
    {room.log.map((entry, index) => <div className="grid gap-0.5 text-xs" data-selectable-text="true" key={entry.id ?? `${entry.at}:${index}`}>
      <strong className="text-[0.7rem] font-semibold">{entry.from.kind === 'user' ? labels.you : entry.from.name}</strong>
      {MessageTextContent ? <MessageTextContent media={false} previewOnly text={entry.text} /> : entry.text}
    </div>)}
  </section>
}

function GroupExecutionGate(props: GroupChatWorkspaceProps & { route: CanonicalGroupRoute }) {
  const b = useBots()
  const { t } = useI18n()
  const ambientConnectionId = useValue(host.state.connectionId)
  const ambientProfile = useValue(host.state.profile)
  const { connectionId, profile } = props.route
  const gateway = useValue(host.state.gateway)
  const activationEpoch = useGatewayActivationEpoch()
  const source = JSON.stringify([connectionId, profile, gateway, activationEpoch])
  const [capability, setCapability] = useState<{ source: string; mode: GroupExecutionMode; unavailable: GateUnavailable } | null>(null)
  const current = capability?.source === source ? capability : null
  const mode = current ? current.mode : 'checking'
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // #140805: 'found' means the binding was adopted and the workspace re-renders
  // onto it; only 'missing' (the authority answered, no such room) may offer creation.
  const [lookup, setLookup] = useState<{ source: string; status: GateLookup } | null>(null)
  const [lookupAttempt, setLookupAttempt] = useState(0)
  const [capabilityAttempt, setCapabilityAttempt] = useState(0)
  const classicRoom = useValue($groupChats)[props.group]
  const lookupStatus = lookup?.source === source ? lookup.status : 'pending'
  useEffect(() => {
    if (mode !== 'canonical') {
      return
    }

    let cancelled = false
    setLookup({ source, status: 'pending' })
    setError('')
    const route = { connectionId: connectionId ?? '', profile }
    const origin = props.origin ?? 'name'
    void resolveCanonicalGroup(route, props.group, origin)
      .then(resolved => {
        if (cancelled) {
          return
        }

        if (resolved) {
          publishCanonicalGroup(route, props.group, resolved, origin)
        } else {
          setLookup({ source, status: 'missing' })
        }
      })
      .catch(e => {
        if (!cancelled) {
          setLookup({ source, status: 'failed' })
          setError(e instanceof Error ? e.message : String(e))
        }
      })

    return () => {
      cancelled = true
    }
  }, [mode, source, props.group, props.origin, lookupAttempt, connectionId, profile])
  useEffect(() => {
    let cancelled = false
    setCapability(null)
    setError('')

    if (gateway !== 'open' && connectionId === ambientConnectionId && profile === ambientProfile) {
      setCapability({ source, mode: 'unavailable', unavailable: 'unreachable' })

      return
    }

    void canonicalGroupRequest<unknown>({ connectionId: connectionId ?? '', profile }, 'groups.capabilities')
      .then(result => { if (!cancelled) {setCapability({ source, mode: groupExecutionMode(result), unavailable: gateUnavailable(result) })} })
      .catch(e => {
        if (!cancelled) {
          setCapability({ source, mode: 'unavailable', unavailable: gateUnavailable(undefined, e) })
          setError(String(e))
        }
      })

    return () => { cancelled = true }
  }, [connectionId, profile, gateway, source, capabilityAttempt, ambientConnectionId, ambientProfile])

  const route = { connectionId: connectionId ?? '', profile }

  const plan = groupGatePlan({ mode, unavailable: current?.unavailable ?? 'unreachable', lookup: lookupStatus, props, route,
    canonical: b.canonical, open: t.gatewayGroupOpen })

  if (plan.classic) {return <LegacyGroupChatWorkspace {...props} />}
  const { canCreate } = plan

  return <section aria-label={props.group} className="grid gap-3 p-3">
    {!props.mainTab && <h2>{props.group}</h2>}
    <p>{plan.message}</p>
    {plan.problem && <p role="status">{plan.problem}</p>}
    {error && <p role="alert">{error}</p>}
    {plan.retry && <Button onClick={() => (plan.retry === 'capability' ? setCapabilityAttempt : setLookupAttempt)(value => value + 1)}>
      {t.common.retry}</Button>}
    {canCreate && <Button disabled={busy} onClick={() => {
      const sourceCurrent = groupCreationSource(route, activationEpoch)

      if (!sourceCurrent()) {
        setError(b.canonical.driverUnavailable)

            return
          }

      setBusy(true)
      void createCanonicalGroup(route, props.group, props.members)
        .then(({ room }) => {
          refreshGatewayGroupRooms()

          if (sourceCurrent()) {openGroupChat(registerCanonicalGroup(route, room), 'key')}
        })
        .catch(e => { if (sourceCurrent()) {setError(canonicalGroupCreateError(e, b.canonical))} }).finally(() => setBusy(false))
    }}>{b.canonical.startGatewayGroup}</Button>}
    {canonicalGroupKeyRoute(props.group, props.origin ?? 'name') === null && <GateEarlierMessages labels={b.canonical} room={classicRoom} />}
  </section>
}

function LegacyGroupChatWorkspace({ group, members, onBack, mainTab, visible = true }: GroupChatWorkspaceProps) {
  const b = useBots()
  const rooms: Record<string, GroupChatRoom> = useValue($groupChats)
  const allMeta: Record<string, BotMeta> = useValue($botMeta)
  // A former member's line is labelled from the live roster (renderEntry).
  const liveRoster: RosterRow[] = useValue($lastRoster)

  const room: GroupChatRoom = rooms[group] || { log: [], running: false }

  const { composerKey, composerKeyRef, composerDraft, setComposerDraft, updateComposerDraft,
    draft, replyDrafts, replyThread, pendingImages, setDraft, setReplyDrafts, setReplyThread, setPendingImages } = useLegacyGroupComposer(group, room)

  useLegacyGroupBrowserHandoff(group, composerKey, composerKeyRef, setComposerDraft)

  const mentionScope = legacyGroupMentionScope(groupChatRoomKey(group, room), members, groupOpenRoute(group))

  const unresolvedMentions = (text: string, seated = members, meta = allMeta) =>
    unresolvedLegacyGroupMentions(text, seated, meta, b.canonical.allMembers, b.group.you)

  const unresolvedDraft = unresolvedMentions(draft).length > 0
  const recipientNames = legacyGroupRecipientNames(draft, members, allMeta, b.canonical.allMembers)
  const invalidMentionPaste = () => host.notify({ kind: 'info', message: b.canonical.pastedMentionReset })

  const [confirmDisband, setConfirmDisband] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [memberPickerOpen, setMemberPickerOpen] = useState(false)
  // Click-to-disambiguate: which log entry is showing its speaker's full
  // @handle (the roster's name-device form when names collide across
  // connections). Naturally every speaker just shows its display name.
  const [revealedSpeaker, setRevealedSpeaker] = useState<null | string>(null)
  // Thread replies retain their own draft; the main composer starts a new topic.
  // Pending image attachments per composer: `null` thread key = the main
  // composer, otherwise the reply box of that thread. Data URLs, already
  // downscaled — they ride the send into every responding member's session.

  // Scroll anchoring (#89835): rooms used to open at scroll position 0 and
  // stay there while replies streamed in. Scroll the bottom sentinel into
  // view on mount and whenever the log grows — but only when the user is
  // already near the bottom, so reading history is never yanked away.
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  // eslint-disable-next-line no-restricted-syntax -- tracks live scroll position from a DOM listener, not an atom
  useEffect(() => {
    const sentinel = bottomSentinelRef.current

    if (!sentinel) {
      return
    }

    const viewport = sentinel.closest('[data-slot="scroll-area-viewport"]')

    if (viewport) {
      const onScroll = () => {
        stickToBottomRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80
      }

      viewport.addEventListener('scroll', onScroll, {
        passive: true
      })

      return () => viewport.removeEventListener('scroll', onScroll)
    }
  }, [])
  useEffect(() => {
    if (stickToBottomRef.current) {
      bottomSentinelRef.current?.scrollIntoView({
        block: 'end'
      })
    }
  }, [room.log.length, room.running])

  // Retained-pane reopen (#89835 follow-up): a hot-mounted room pane stays
  // mounted while another workspace tab is active, so returning to it never
  // remounts and the mount-time anchor doesn't rerun. Re-anchor on the
  // hidden → visible edge — an explicit reopen, so it overrides a stale
  // read-position and mirrors what a fresh open does.
  const wasVisibleRef = useRef(visible)
  // eslint-disable-next-line no-restricted-syntax -- previous-value tracker for the hidden → visible edge; lagging a render IS the contract
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      stickToBottomRef.current = true
      bottomSentinelRef.current?.scrollIntoView({
        block: 'end'
      })
    }

    wasVisibleRef.current = visible
  }, [visible])
  const imagesFor = (thread: null | string) => pendingImages[thread ?? 'main'] || []

  const addImages = (thread: null | string, picked: Attachment[]) => {
    if (!picked.length) {
      return
    }

    const key = thread ?? 'main'
    setPendingImages(prev => ({
      ...prev,
      [key]: [...(prev[key] || []), ...picked]
    }))
  }

  const removeImage = (thread: null | string, index: number) => {
    const key = thread ?? 'main'
    setPendingImages(prev => ({
      ...prev,
      [key]: (prev[key] || []).filter((_, i) => i !== index)
    }))
  }

  // Ctrl/⌘-V a screenshot (or any file) into any composer in this room.
  const pasteImages = (thread: null | string, event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...(event.clipboardData?.files || [])]

    if (!files.length) {
      return
    }

    event.preventDefault()
    void filesToGroupAttachments(files).then(picked => addImages(thread, picked))
  }

  // Drag & drop anywhere on the room drops into the ACTIVE composer — the
  // open reply box when one owns the composer, else the main (new-thread)
  // composer. Matches the 1:1 chat's drop affordance.
  const [dragOver, setDragOver] = useState(false)

  const dropFiles = (event: DragEvent<HTMLDivElement>) => {
    const files = [...(event.dataTransfer?.files || [])]
    setDragOver(false)

    if (!files.length) {
      return
    }

    event.preventDefault()
    void filesToGroupAttachments(files).then(picked => addImages(replyThread, picked))
  }

  // Collapsible Activity view: collapsed by default — opening it is always an
  // explicit user action, it never steals focus, and it never auto-scrolls.
  const [activityOpen, setActivityOpen] = useState(false)
  // Subscribe: activity rows re-render as turn events land.
  useValue($groupActivity)
  // Pending member questions for THIS room (#90694), oldest first.
  const clarifyAll: Record<string, GroupRoomPrompt> = useValue($groupClarify)

  const roomClarifies = Object.values(clarifyAll || {})
    .filter(entry => entry?.group === group)
    .sort((a, b) => (a.at || 0) - (b.at || 0))

  const availableMembers = members.filter(member => botSourceStatus(member).available).length
  const availabilityLabel = b.group.availability(availableMembers, members.length)

  const memberNames = members.map(b => displayName(b, botRosterMeta(b, allMeta))).join(', ') || b.group.noBotsInChat

  const header = (
    <div className="aino-group-header" data-main-tab={mainTab || undefined}>
      {!mainTab && (
        <Button onClick={() => (onBack ? onBack() : $groupChatWorkspace.set(null))} size="sm" variant="ghost">
          {b.group.back}
        </Button>
      )}
      {/* Room picture (set via Group settings) leads the title when present. */}
      {!mainTab &&
        (room.image ? (
          <img
            alt=""
            className="size-6 shrink-0 rounded-md object-cover ring-1 ring-(--ui-stroke-secondary)"
            src={room.image}
          />
        ) : (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-(--chrome-action-hover) text-(--ui-text-tertiary)">
            <Codicon name="organization" />
          </span>
        ))}
      <div className="aino-group-heading">
        {!mainTab && <h2>{group}</h2>}
        <Tip label={memberNames}>
          <p
            aria-label={availabilityLabel}
            className={cn(
              'shrink-0 text-[length:var(--aino-text-caption)] text-(--ui-text-quaternary)',
              members.length > 0 && availableMembers < members.length && 'text-(--ui-yellow)'
            )}
          >
            {members.length > 0 && availableMembers < members.length
              ? availabilityLabel
              : b.group.memberCount(members.length)}
          </p>
        </Tip>
      </div>
      <div className="aino-group-header-actions">
        <LegacyGroupMenu
          onDisband={() => setConfirmDisband(true)}
          onMembers={() => setMemberPickerOpen(true)}
          onSettings={() => setSettingsOpen(true)}
        />
      </div>
    </div>
  )

  // Seat from the live sources at send time, not from the painted `members`
  // prop: a roster save that lands between the last paint and Enter was seen
  // (live) to send with the removed Bot still seated. Same derivation the
  // main-tab wrapper paints from; the prop is the fallback when the roster
  // has not been fetched yet.
  const memberDescriptors = () => {
    const seated = groupChatMemberBots(group, $lastRoster.get(), $botMeta.get())

    return (seated.length ? seated : members).map(b => ({
      ...b,
      title: botRosterMeta(b, allMeta)?.title || b.title || ''
    }))
  }

  // Activity disclosure: quiet, collapsed by default. The collapsed row shows
  // the latest event; expanding lists the current run's events newest-first.
  // Events are epoch-tagged, so a superseded run's history drops out of view.
  const activityEvents: GroupActivityEntry[] = currentGroupActivity(group)
  const { latestActivity, summaryActivity } = legacyGroupActivitySummary(activityEvents, !!room.running)

  // #94570 shell rewired onto the real primitive (#91868/#94569): the button
  // must stop the ROUND, not just spray per-member interrupts — without the
  // epoch bump + holds the loop marched on to the next member. Thread scope:
  // the run being stopped is the one the latest activity belongs to.
  const stopRoomRun = async () => {
    await stopGroupThread(group, latestActivity?.thread || null, memberDescriptors())
    host.notify({
      kind: 'success',
      message: b.group.stopped(group)
    })
  }

  const activityPanel = (
    <div className="border-b border-(--ui-stroke-tertiary) px-4">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-1">
        <RowButton
          aria-controls={`group-activity:${group}`}
          aria-expanded={activityOpen}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1 text-left text-[length:var(--aino-text-caption)] text-(--ui-text-quaternary) transition-colors hover:text-foreground"
          onClick={() => setActivityOpen(prev => !prev)}
        >
          <Codicon
            className="shrink-0 text-[length:var(--aino-text-caption)]"
            name={activityOpen ? 'chevron-down' : 'chevron-right'}
          />
          <span className="shrink-0 font-medium">{b.group.activity}</span>
          {summaryActivity ? (
            <span
              className={cn('min-w-0 flex-1 truncate', groupActivityTone(summaryActivity.kind))}
            >{`${groupActivityLabel(summaryActivity, group)} · ${relativeTime(summaryActivity.at)}`}</span>
          ) : null}
        </RowButton>
      </div>
      {activityOpen ? (
        <div className="mx-auto grid w-full max-w-3xl gap-0.5 px-2.5 pb-1.5" id={`group-activity:${group}`}>
          {activityEvents.length ? (
            [...activityEvents].reverse().map((event, i) => (
              <div
                className="flex items-center gap-1.5 text-[length:var(--aino-text-caption)]"
                key={`${event.at}:${i}`}
              >
                <Codicon
                  className={cn('shrink-0 text-[length:var(--aino-text-caption)]', groupActivityTone(event.kind))}
                  name={GROUP_ACTIVITY_GLYPHS[event.kind] || 'circle-outline'}
                />
                <span className={cn('min-w-0 flex-1 truncate', groupActivityTone(event.kind))}>
                  {groupActivityLabel(event, group)}
                </span>
                <span className="shrink-0 text-[length:var(--aino-text-caption)] text-(--ui-text-quaternary)">
                  {relativeTime(event.at)}
                </span>
              </div>
            ))
          ) : (
            <div className="px-0.5 pb-0.5 text-[length:var(--aino-text-caption)] text-(--ui-text-quaternary)">
              {b.group.noActivityYet}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )

  const submit = () => {
    const text = draft.trim()
    const images = imagesFor(null)

    if (!text && !images.length) {
      return
    }

    const seated = memberDescriptors()

    if (unresolvedMentions(text, seated, $botMeta.get()).length) {
      host.notify({ kind: 'error', message: b.canonical.unresolvedMention })

      return
    }

    const before = groupComposerDraftSnapshot(composerKeyRef.current)

    const cleared = updateComposerDraft(current => ({
      ...current,
      main: '',
      pendingAttachments: {
        ...(current.pendingAttachments || {}),
        main: []
      }
    }))

    // Main composer = START A NEW THREAD with the whole group (Slack shape).
    // Full descriptors ride into the turn loop: remote members keep their
    // connection fields so their turns route to their own machines.
    const minted = sendToGroupChat(group, seated, text, null, images)

    if (!minted) {
      const restored = restoreGroupComposerDraft(composerKeyRef.current, cleared.revision, before)

      if (restored) {
        setComposerDraft(restored)
      }
    }
  }

  const submitReply = (thread: string) => {
    const text = (replyDrafts[thread] || '').trim()
    const images = imagesFor(thread)

    if (!text && !images.length) {
      return
    }

    const seated = memberDescriptors()

    if (unresolvedMentions(text, seated, $botMeta.get()).length) {
      host.notify({ kind: 'error', message: b.canonical.unresolvedMention })

      return
    }

    const before = groupComposerDraftSnapshot(composerKeyRef.current)

    const cleared = updateComposerDraft(current => ({
      ...current,
      pendingAttachments: {
        ...(current.pendingAttachments || {}),
        [thread]: []
      },
      replies: {
        ...(current.replies || {}),
        [thread]: ''
      }
    }))

    // Reply box = CONTINUE this thread; the member turns it triggers are
    // scoped to it.
    const sent = sendToGroupChat(group, seated, text, thread, images)

    if (!sent) {
      const restored = restoreGroupComposerDraft(composerKeyRef.current, cleared.revision, before)

      if (restored) {
        setComposerDraft(restored)
      }
    }
  }

  /** Pending-attachment chips + the picker for one composer (thread = null →
   *  main). Image chips preview the pixels; PDFs/files show a type icon.
   *  X removes it. */
  const attachmentRow = (thread: null | string) => {
    const images = imagesFor(thread)

    if (!images.length) {
      return null
    }

    return (
      <div className="flex flex-wrap items-center gap-1.5 px-1 pb-1">
        {images.map((img, index) => (
          <div
            className="flex items-center gap-1 rounded-(--aino-radius-control) border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) px-1 py-0.5"
            key={`${img.name || 'img'}:${index}`}
          >
            {img.kind === 'pdf' || img.kind === 'file' ? (
              <Codicon
                className="text-[length:var(--aino-text-body)] text-(--ui-text-tertiary)"
                name={img.kind === 'pdf' ? 'file-pdf' : 'file'}
              />
            ) : (
              <img alt="" className="size-6 rounded object-cover" src={img.data} />
            )}
            <span className="max-w-32 truncate text-[length:var(--aino-text-caption)] text-(--ui-text-tertiary)">
              {img.name || b.group.attachedImage}
            </span>
            <Tip label={b.group.removeAttachment}>
              <Button
                aria-label={b.group.removeAttachment}
                onClick={() => removeImage(thread, index)}
                size="icon-xs"
                variant="ghost"
              >
                <Codicon name="close" />
              </Button>
            </Tip>
          </div>
        ))}
      </div>
    )
  }

  const attachButton = (thread: null | string) => (
    <Tip label={b.group.attachHint}>
      <Button
        aria-label={b.group.attachHint}
        className="shrink-0 text-(--ui-text-tertiary) hover:text-foreground"
        onClick={() => void pickGroupAttachments().then(picked => addImages(thread, picked))}
        size="sm"
        type="button"
        variant="ghost"
      >
        <Codicon name="attach" />
      </Button>
    </Tip>
  )

  // #91359: recognized @mentions render as inline references; recomputed
  // only when the roster changes since the classifier consults the members.
  const mentionComponents = useMemo(
    () => groupMentionComponents(members, { allMembers: b.canonical.allMembers, you: b.group.you }),
    [members, b.canonical.allMembers, b.group.you]
  )

  const mentionText = useMemo(
    () => groupMentionText(members, { allMembers: b.canonical.allMembers, you: b.group.you }),
    [members, b.canonical.allMembers, b.group.you]
  )

  // #89883: answer ONE bot from its message. Seeds `@tag ` into the composer
  // that owns this entry's thread — the open reply box when it is this
  // thread's, else the main composer — so parseGroupChatMentions routes the
  // next turn to that member only. Insert-only: the user still sends. The tag
  // is owner-qualified when a same-named twin shares the friendly form.
  const replyMentionTag = (entry: GroupMessage, member: GroupMember | null) =>
    groupReplyMentionTag(member || { name: entry.from.name }, members)

  const replyToMember = (entry: GroupMessage, member: GroupMember | null) => {
    const tag = replyMentionTag(entry, member)

    if (!tag) {
      return
    }

    const seed = (current: string) =>
      current.includes(`@${tag}`) ? current : `@${tag} ${current}`.replace(/\s+$/, ' ')

    const thread = groupThreadOf(entry)

    if (replyThread === thread) {
      setReplyDrafts(prev => ({
        ...prev,
        [thread]: seed(prev[thread] || '')
      }))
    } else {
      setDraft(seed)
    }
  }

  // Same appearance pipeline as the roster: custom image/pet, else the deterministic shape+color face.
  const speakerFace = (name: string, meta: BotMeta | null | undefined) => {
    const appearance = botAppearance(name, meta)
    const image = appearance.image ?? null

    return (
      <BotFace
        color={avatarColor(appearance.color, name)}
        image={image && !isBackfilledFacePng(image) ? image : null}
        name={name}
        shape={appearance.shape}
        size={ROOM_AVATAR_SIZE}
      />
    )
  }

  // One log entry, rendered exactly as before conversation folding existed.
  const renderEntry = (entry: GroupMessage, index: number) => {
    const isUser = entry.from.kind === 'user'
    const meta = groupTranscriptSpeakerMeta(entry, members, allMeta, liveRoster)

    // Match this speaker back to its member descriptor so display
    // names and disambiguating handles come from the roster (the
    // primary "default" profile renders as Hermes, remote dupes
    // carry their @name-device handle); a former member as its own machine names it.
    const speaker = groupTranscriptSpeaker(entry, members, liveRoster)
    const member = members.find(bot => bot === speaker) ?? null

    const display = isUser || !speaker ? b.group.you : displayName(speaker, meta)

    const entryKey = `${entry.at}:${index}`
    const revealed = !isUser && revealedSpeaker === entryKey

    // Clicked: append the gateway name so same-named agents on
    // two connections are tellable apart on demand.
    const label = isUser
      ? b.group.you
      : revealed
        ? `${display}${entry.from.source ? `-${entry.from.source}` : ''} (@${botHandle(entry.from.name, member || undefined)})`
        : display

    // Speaker avatar: same appearance pipeline as the roster (speakerFace).
    // Source-qualified speakers use owner-aware botRosterMeta (#96432).
    // The user's own lines carry no avatar.
    return (
      <div className="aino-group-message" data-own={isUser ? 'true' : 'false'} key={entryKey}>
        <div aria-hidden="true" className="aino-group-message-avatar">
          {isUser ? <span className="aino-group-human-avatar"><Codicon name="account" /></span> : speakerFace(entry.from.name, meta)}
        </div>
        <div className="aino-group-message-main">
          <div className="aino-group-message-meta">
            {isUser ? (
              <strong>{label}</strong>
            ) : (
              <Tip label={revealed ? b.group.hideFullHandle : b.group.showFullHandle}>
                <Button
                  className="aino-group-message-author"
                  onClick={() => setRevealedSpeaker(revealed ? null : entryKey)}
                  size="inline"
                  variant="text"
                >
                  {label}
                </Button>
              </Tip>
            )}
            <time>{relativeTime(entry.at)}</time>
            {entry.text.trim() || !isUser ? (
              <div className="aino-group-message-actions">
                {isUser ? null : (
                  <Tip label={`Reply to @${replyMentionTag(entry, member)}`}>
                    <Button
                      aria-label={`Reply to ${display}`}
                      className="text-(--ui-text-tertiary) hover:text-foreground"
                      onClick={() => replyToMember(entry, member)}
                      size="icon"
                      variant="ghost"
                    >
                      <Codicon name="reply" />
                    </Button>
                  </Tip>
                )}
                {entry.text.trim() ? (
                  <CopyButton appearance="icon" buttonSize="icon" stopPropagation text={entry.text} />
                ) : null}
              </div>
            ) : null}
          </div>
          <div
            className="aino-group-message-bubble aino-group-message-text [&_pre]:whitespace-pre-wrap [&_pre]:wrap-anywhere" // The app shell sets user-select: none globally; message bodies opt
            // back in so drag-select and ⌘C work in group chat logs.
            data-selectable-text="true"
            data-slot="group-chat-message-content"
          >
            {MessageTextContent ? (
              <MessageTextContent decorateText={mentionText} media={!member?.remoteSource} text={entry.text} />
            ) : Streamdown ? (
              <Streamdown components={mentionComponents}>{entry.text}</Streamdown>
            ) : (
              entry.text
            )}
          </div>
          {/* User attachments: what every responding bot was */
          /* shown — image previews, or a named chip for */
          /* PDFs/files. */}
          {Array.isArray(entry.images) && entry.images.length ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {entry.images.map((img, imgIndex) =>
                img.kind === 'pdf' || img.kind === 'file' ? (
                  <div
                    className="flex items-center gap-1 rounded-(--aino-radius-control) border border-(--ui-stroke-tertiary) px-1.5 py-1 text-[length:var(--aino-text-caption)] text-(--ui-text-tertiary)"
                    key={`${entryKey}:img:${imgIndex}`}
                    title={img.name || b.group.attachedFile}
                  >
                    <Codicon
                      className="text-[length:var(--aino-text-ui)]"
                      name={img.kind === 'pdf' ? 'file-pdf' : 'file'}
                    />
                    <span className="max-w-48 truncate">{img.name || b.group.attachedFile}</span>
                  </div>
                ) : (
                  <img
                    alt={img.name || b.group.attachedImage}
                    className="max-h-40 max-w-60 rounded-(--aino-radius-control) border border-(--ui-stroke-tertiary) object-contain"
                    key={`${entryKey}:img:${imgIndex}`}
                    src={img.data}
                    title={img.name || b.group.attachedImage}
                  />
                )
              )}
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  // The public room is one arrival-ordered conversation. Thread ids scope
  // replies and prompts, not visibility: a newer topic must never hide a
  // member's completed answer or move it ahead of intervening messages.
  const threadEnds = new Map<string, number>()
  room.log.forEach((entry, index) => threadEnds.set(groupThreadOf(entry), index))
  const logChildren: ReactNode[] = []
  room.log.forEach((entry, index) => {
    logChildren.push(renderEntry(entry, index))
    const id = groupThreadOf(entry)

    if (threadEnds.get(id) !== index) {
      return
    }

    // Reply-in-thread: the newest thread's continuation ALSO lives here, so
    // the main composer below can stay "new thread" without ambiguity.
    logChildren.push(
      replyThread === id ? (
        <form
          className="grid gap-0 px-2 pb-1"
          key={`replybox:${id}`}
          onSubmit={event => {
            event.preventDefault()
            submitReply(id)
          }}
        >
          {unresolvedMentions(replyDrafts[id] || '').length > 0 && (
            <Alert className="mb-3" variant="warning">
              <Codicon aria-hidden className="mt-0.5 text-(--ui-yellow)" name="warning" />
              <AlertDescription>{b.canonical.unresolvedMention}</AlertDescription>
            </Alert>
          )}
          {attachmentRow(id)}
          <div className="flex items-center gap-1.5">
            <GroupMentionInput
              aria-label={b.group.replyInThread}
              autoFocus
              everyoneLabel={b.canonical.allMembers}
              members={members}
              mentionScope={mentionScope}
              nameFor={member => displayName(member, botRosterMeta(member, allMeta))}
              onChange={text =>
                setReplyDrafts(prev => ({
                  ...prev,
                  [id]: text
                }))
              }
              onInvalidMentionPaste={invalidMentionPaste}
              onPaste={event => pasteImages(id, event)}
              onSubmitDraft={() => submitReply(id)}
              pickerLabel={b.canonical.pickerLabel}
              placeholder={b.group.replyInThreadPlaceholder}
              value={replyDrafts[id] || ''}
            />
            {attachButton(id)}
            <Button
              disabled={
                unresolvedMentions(replyDrafts[id] || '').length > 0 ||
                (!(replyDrafts[id] || '').trim() && !imagesFor(id).length)
              }
              size="sm"
              type="submit"
            >
              {b.group.reply}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          className="w-fit px-2 pb-1 text-left text-[length:var(--aino-text-caption)] text-(--ui-accent) transition-colors"
          key={`replylink:${id}`}
          onClick={() => setReplyThread(id)}
          size="inline"
          variant="link"
        >
          {b.group.replyInThread}
        </Button>
      )
    )
  })

  return (
    <div
      aria-label={group}
      className="aino-group-workspace aino-group-chat relative"
      data-preview-annotate-composer-key={composerKey}
      data-preview-annotate-destination="group"
      data-preview-annotate-group={group}
      data-preview-annotate-owner-key={groupWorkspaceOwnerKey(group)}
      onDragLeave={event => {
        // Only clear when leaving the room container itself, not when the
        // cursor moves between its children. React types relatedTarget as a
        // bare EventTarget; on a drag it is always an element or null.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragOver(false)
        }
      }}
      onDragOver={event => {
        if ([...(event.dataTransfer?.types || [])].includes('Files')) {
          event.preventDefault()
          setDragOver(true)
        }
      }}
      onDrop={dropFiles}
      role="region"
    >
      {dragOver ? (
        <div
          className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center border-2 border-dashed border-(--ui-accent) text-sm font-medium text-(--ui-accent)"
          key={'dropzone'}
        >
          {replyThread ? b.group.dropToThread : b.group.dropToRoom}
        </div>
      ) : null}
      {header}
      <GroupHoldStatus
        holds={room.holds}
        memberLabel={member => displayName(member, botRosterMeta(member, allMeta))}
        members={members}
      />
      {activityPanel}
      <div className="aino-group-messages-scroll">
        {/* minmax(0,1fr): an implicit grid track is min-content sized, so one */}
        {/* unbreakable code line widened every entry to its own width and the */}
        {/* log scrolled sideways as a whole instead of the code block (#91878). */}
        <div className="aino-group-messages">
          {room.log.length
            ? logChildren
            : [
                <div className="px-2 py-4 text-center text-xs text-(--ui-text-tertiary)" key={'empty'}>
                  {b.group.composerPlaceholder}
                </div>
              ]}
          {roomClarifies.map(entry => (
            <GroupClarifyCard
              entry={entry}
              key={`clarify:${entry.thread || 'legacy'}:${entry.memberKey}:${entry.requestId}`}
              members={members}
            />
          ))}
          {!room.running && summaryActivity?.kind === 'settled' && (
            <div className="aino-group-system-line">
              <Codicon name="dash" />
              {b.canonical.roundEnded}
            </div>
          )}
          {/* Scroll anchor (#89835): rooms opened at scroll position 0, mid- */
          /* history. The effect below scrolls this sentinel into view on */
          /* mount and on log growth — unless the user has scrolled up. */}
          <div aria-hidden key={'bottom-sentinel'} ref={bottomSentinelRef} />
        </div>
      </div>
      <div className="aino-group-composer-zone">
        {unresolvedDraft && (
          <Alert className="mb-3" variant="warning">
            <Codicon aria-hidden className="mt-0.5 text-(--ui-yellow)" name="warning" />
            <AlertDescription>{b.canonical.unresolvedMention}</AlertDescription>
          </Alert>
        )}
        <LegacyGroupReplyStatus
          activity={activityEvents}
          allMeta={allMeta}
          onStop={() => void stopRoomRun()}
          room={room}
          waitingForAnswer={roomClarifies.length > 0}
        />
        <form
          className="aino-group-composer"
          onSubmit={event => {
            event.preventDefault()
            submit()
          }}
        >
          {attachmentRow(null)}
          <GroupMentionInput
            appearance="composer"
            aria-label={b.group.messageRoom(group)}
            everyoneLabel={b.canonical.allMembers}
            members={members}
            mentionScope={mentionScope}
            nameFor={member => displayName(member, botRosterMeta(member, allMeta))}
            onChange={setDraft}
            onInvalidMentionPaste={invalidMentionPaste}
            onPaste={event => pasteImages(null, event)}
            onSubmitDraft={submit}
            pickerLabel={b.canonical.pickerLabel}
            placeholder={b.group.newThreadPlaceholder(group)}
            value={draft}
          />
          <div className="aino-group-composer-toolbar">
            <div className="aino-group-composer-tools">
              {attachButton(null)}
              <span>
                {b.canonical.recipients} {recipientNames}
              </span>
            </div>
            <Button
              aria-label={b.group.newThread}
              disabled={unresolvedDraft || (!draft.trim() && !imagesFor(null).length)}
              size="icon-send"
              type="submit"
            >
              <Codicon name="arrow-up" />
            </Button>
          </div>
        </form>
      </div>
      <GroupChatSettingsDialog
        group={group}
        members={members}
        onClose={() => setSettingsOpen(false)}
        onManageMembers={() => setMemberPickerOpen(true)}
        open={visible && settingsOpen}
      />
      <GroupMemberPicker
        group={group}
        members={members}
        onClose={() => setMemberPickerOpen(false)}
        open={visible && memberPickerOpen}
      />
      <ConfirmDialog
        busyLabel={b.group.disbanding}
        confirmLabel={b.group.disbandAction}
        description={
          /* New rooms title member sessions by roomId, legacy rooms by name — */
          /* so the copy names the concept, not a literal session title. The */
          /* name is bolded mid-sentence, so the copy splits around it and the */
          /* prefix goes empty where the name leads (core's deleteDesc* shape). */
          <span>
            {b.group.disbandDescPrefix}
            <span className="font-medium text-foreground">{group}</span>
            {b.group.disbandDescSuffix(members.length)}
          </span>
        }
        destructive
        doneLabel={b.group.disbandDone}
        onClose={() => setConfirmDisband(false)}
        onConfirm={async () => {
          clearGroupComposerDraft(composerKeyRef.current)
          await disbandGroupChat(group, members)
          host.notify({
            kind: 'success',
            message: b.group.disbanded(group)
          })
        }}
        open={visible && confirmDisband}
        title={b.group.disbandTitle}
      />
    </div>
  )
}

/** Main-window wrapper: seats the member roster reactively (live roster +
 *  bot meta + the room's stored cross-connection descriptors) so the room
 *  keeps working as members change while the tab is open. Also subscribes to
 *  this pane's visibility (feature-detected host.paneVisibility): retained
 *  panes stay mounted while hidden, so the workspace needs the hidden →
 *  visible edge to re-anchor its log to the bottom (#89835 follow-up). */
interface GroupChatMainViewProps {
  group: string
  origin: CanonicalGroupOrigin
  route: CanonicalGroupRoute
}

export function GroupChatTabTitle({
  group,
  origin,
  fallback,
  route
}: GroupChatMainViewProps & {
  fallback: string
}) {
  const bindings = useValue($canonicalGroupBindings)

  return <>{canonicalGroupBindingFor(bindings, route, group, origin)?.roomName || fallback}</>
}

function GroupChatMainView({
  group,
  origin,
  route,
  paneId,
  onBack
}: GroupChatMainViewProps & {
  paneId: string
  onBack: () => void
}) {
  const allMeta = useValue($botMeta)
  // Subscribe: membership changes ride bot meta AND the room record.
  useValue($groupChats)
  const roster = useValue($lastRoster)
  const members = groupChatMemberBots(group, roster, allMeta)

  // Older SDKs have no paneVisibility: fall back to an always-visible atom so
  // the hook order stays stable and behavior matches the previous build.
  const $visible = useMemo(
    () => (typeof host.paneVisibility === 'function' ? host.paneVisibility(paneId) : atom(true)),
    [paneId]
  )

  const visible = useValue($visible)

  return (
    <GroupChatWorkspace
      group={group}
      mainTab
      members={members}
      onBack={onBack}
      origin={origin}
      route={route}
      visible={visible}
    />
  )
}

/** Open a group chat the Discord way: a tab taking over the MAIN chat window
 *  (host.openWorkspace, newer desktops), falling back to the in-panel room
 *  view on desktops whose SDK predates the main-area door.
 *
 *  Ordering matters (#89788 follow-up): the main tab must be RECORDED before
 *  the selection atom is set. Setting the atom first opened a window where
 *  BotsPane rendered with a selected group and an empty tab map — the
 *  in-pane fallback painted alongside the main tab, and because the map
 *  write itself repaints nothing, the duplicate stuck until an unrelated
 *  re-render. */
export function openGroupChat(group: string, origin: CanonicalGroupOrigin, openedRoute?: CanonicalGroupRoute): void {
  const route = canonicalGroupKeyRoute(group, origin) ??
    openedRoute ?? {
      connectionId: host.state.connectionId.get() ?? '',
      profile: host.state.profile.get()
    }

  const binding = canonicalGroupBindingFor($canonicalGroupBindings.get(), route, group, origin)

  if (binding && origin === 'name') {
    group = registerCanonicalGroup(binding, { room_id: binding.roomId, name: binding.roomName || group, members: [] })
    origin = 'key'
  }

  const identity = origin === 'key' ? group : JSON.stringify([route.connectionId, route.profile, group])
  const workspaceId = `${ID}:group:${encodeURIComponent(identity)}`
  const paneId = `plugin-workspace:${workspaceId}`
  const ownerKey = origin === 'key' ? groupWorkspaceOwnerKey(group) : `group:source:${identity}`
  // A room selection supersedes any bot-open transition still hydrating.
  // The in-flight host navigation may complete underneath this workspace,
  // but it may not later close or visually steal the room the user chose.
  bumpBotOpenGeneration()
  $groupNeedsYou.set({
    ...$groupNeedsYou.get(),
    [group]: false
  })
  recordGroupOpenOrigin(group, origin, { route, paneId, ownerKey })
  setBotsWorkspaceOwner(ownerKey, null, botsText().group.newConversationHint)
  // #93813: what reached the members' room sessions while nobody drove them
  // (a Bot posting reports into its own session, a CLI resume) is posted as
  // the room opens, not only once the room next drives that member.
  void sweepExternalGroupWrites(group, groupChatMemberBots(group, $lastRoster.get(), $botMeta.get()))

  if (typeof host.openWorkspace === 'function') {
    try {
      const title = canonicalGroupBindingFor($canonicalGroupBindings.get(), route, group, origin)?.roomName || group

      const close = host.openWorkspace(workspaceId, {
        title,
        tabLead: () => <Codicon name="organization" />,
        tabPresentation: 'conversation',
        workspaceScope: { mode: 'bots', ownerKey },
        tabTitle: () => <GroupChatTabTitle fallback={title} group={group} origin={origin} route={route} />,
        tabTitleText: () =>
          canonicalGroupBindingFor($canonicalGroupBindings.get(), route, group, origin)?.roomName || title,
        minWidth: '24rem',
        render: () => (
          <GroupChatMainView group={group} onBack={() => close()} origin={origin} paneId={paneId} route={route} />
        ),
        onClose: () => {
          if (dropGroupMainTab(group, close) && $groupChatWorkspace.get() === group) {
            $groupChatWorkspace.set(null)
          }
        }
      })

      recordGroupMainTab(group, close, paneId)
      // Tab ownership is on record — the atom now only drives the roster
      // highlight; shouldRenderGroupChatInPane stays false throughout.
      $groupChatWorkspace.set(group)

      return
    } catch {
      // Fall through to the in-panel room below.
    }
  }

  // No main-window door (older desktop) or it threw: select the group so
  // the in-panel room renders as the fallback surface.
  $groupChatWorkspace.set(group)
}
