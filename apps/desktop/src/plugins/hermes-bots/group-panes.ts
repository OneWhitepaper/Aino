import { atom } from '@hermes/plugin-sdk'
/**
 * The window-local state a group-chat room needs but never renders: the
 * per-composer drafts, and the registry of MAIN-window tabs a room is open in.
 *
 * A leaf by design. The room surface and the roster pane both read it and it
 * reads neither, so a disband, a rename or a Back button can retire a room's
 * tab without any of those paths importing a view.
 */

import type { CanonicalGroupAttachment } from './canonical-group-attachments'
import type { CanonicalGroupOrigin } from './canonical-group-registry'
import type { CanonicalRoomMember } from './canonical-groups'
import type { CanonicalGroupBinding, CanonicalGroupRoute } from './canonical-groups'
import { $groupChatWorkspace, groupChatRoomKey } from './group-chat'
import type { GroupChatRoom } from './group-chat'
import { ID } from './shared'
import type { Attachment } from './types'

// Group composer drafts are window-local UI state. They must survive pane
// parking/re-registration and owner switches, but must never enter shared room
// metadata (where another Desktop would see half-typed text or attachment
// bytes). Current rooms key by immutable roomId; legacy rooms fall back to the
// display name until they are upgraded.
export interface CanonicalDraftReply { member?: CanonicalRoomMember; name: string; quote: string; thread?: string }
export interface CanonicalHeldDraft { text: string; attachments: CanonicalGroupAttachment[]; reply: CanonicalDraftReply | null }
export interface GroupComposerDraft {
  canonicalReply?: CanonicalDraftReply | null
  canonicalHeld?: CanonicalHeldDraft | null
  activeReplyThread: null | string
  main: string
  /** Gateway upload manifests stay local until this room explicitly sends. */
  canonicalAttachments?: CanonicalGroupAttachment[]
  /** Keyed by thread id; the main composer parks under 'main'. */
  pendingAttachments: Record<string, Attachment[]>
  replies: Record<string, string>
  revision: number
}
const groupComposerDrafts = new Map<string, GroupComposerDraft | undefined>()
/** One lifetime for the existing draft cache; account changes invalidate warm panes too. */
export const $groupComposerDraftEpoch = atom(0)

export function clearGroupComposerDrafts(): void {
  groupComposerDrafts.clear()
  $groupComposerDraftEpoch.set($groupComposerDraftEpoch.get() + 1)
}

function emptyGroupComposerDraft(): GroupComposerDraft {
  return {
    activeReplyThread: null,
    main: '',
    pendingAttachments: {},
    replies: {},
    revision: 0
  }
}

export function groupComposerDraftKey(group: string, room: GroupChatRoom): string {
  return JSON.stringify([$groupComposerDraftEpoch.get(), groupChatRoomKey(group, room)])
}

export function canonicalGroupComposerDraftKey(binding: CanonicalGroupBinding): string {
  return JSON.stringify(['canonical', $groupComposerDraftEpoch.get(), binding.connectionId, binding.profile, binding.roomId])
}

export function groupComposerDraftSnapshot(key: string): GroupComposerDraft {
  return groupComposerDrafts.get(key) || emptyGroupComposerDraft()
}

export function updateGroupComposerDraft(key: string, mutate: (draft: GroupComposerDraft) => GroupComposerDraft) {
  const current = groupComposerDraftSnapshot(key)

  const next = mutate({
    ...current,
    pendingAttachments: Object.fromEntries(
      Object.entries(current.pendingAttachments || {}).map(([thread, attachments]) => [
        thread,
        [...(attachments || [])]
      ])
    ),
    replies: {
      ...(current.replies || {})
    }
  })

  next.revision = current.revision + 1
  groupComposerDrafts.delete(key)
  groupComposerDrafts.set(key, next)

  return next
}

export function restoreGroupComposerDraft(key: string, expectedRevision: number, snapshot: GroupComposerDraft) {
  const current = groupComposerDraftSnapshot(key)

  if (current.revision !== expectedRevision) {
    return null
  }

  const restored = {
    ...snapshot,
    pendingAttachments: Object.fromEntries(
      Object.entries(snapshot.pendingAttachments || {}).map(([thread, attachments]) => [
        thread,
        [...(attachments || [])]
      ])
    ),
    replies: {
      ...(snapshot.replies || {})
    },
    revision: current.revision + 1
  }

  groupComposerDrafts.set(key, restored)

  return restored
}

export function clearGroupComposerDraft(key: string) {
  groupComposerDrafts.delete(key)
}

export function migrateGroupComposerDraft(oldKey: string, newKey: string) {
  if (oldKey === newKey || !groupComposerDrafts.has(oldKey)) {
    return
  }

  if (!groupComposerDrafts.has(newKey)) {
    groupComposerDrafts.set(newKey, groupComposerDrafts.get(oldKey))
  }

  groupComposerDrafts.delete(oldKey)
}

/** React-style setter argument — the next value, or a function of the current. */
export type GroupDraftSetter<T> = T | ((current: T) => T)

/** Live closers for group-chat MAIN-window tabs, by group name — so a
 *  disband (or the room view's own Back) can retire the tab it opened. */
export const groupChatMainTabs = new Map<string, () => void>()

/** Reactive shadow of `groupChatMainTabs` membership. The Map itself can't
 *  notify React, and #89788's first fix read it non-reactively: a BotsPane
 *  render that landed between selecting the group and recording its main
 *  tab kept the in-pane room on screen forever (the map write repaints
 *  nothing). Every map mutation goes through the two helpers below so the
 *  rev bump re-evaluates the gate. */
export const $groupMainTabsRev = atom(0)

/** The origin each group string was last opened with (see CanonicalGroupOrigin),
 *  so the in-panel fallback renders the selected group the way it was opened.
 *  Unknown strings are names: a name never parses as a `canonical:` key. */
interface GroupOpenContext {
  origin: CanonicalGroupOrigin
  route?: CanonicalGroupRoute
  paneId?: string
  ownerKey?: string
  views?: Map<string, { route?: CanonicalGroupRoute; close: () => void }>
}
const groupOpenOrigins = new Map<string, GroupOpenContext>()

export function recordGroupOpenOrigin(group: string, origin: CanonicalGroupOrigin, context: Pick<GroupOpenContext, 'route' | 'paneId' | 'ownerKey'> = {}) {
  const opened = { origin, ...context, views: groupOpenOrigins.get(group)?.views, ...(context.route ? { route: { ...context.route } } : {}) }
  groupOpenOrigins.set(group, opened)
}

export function groupOpenOrigin(group: string): CanonicalGroupOrigin {
  return groupOpenOrigins.get(group)?.origin ?? 'name'
}

export const groupOpenRoute = (group: string) => groupOpenOrigins.get(group)?.route
export const groupOpenOwnerKey = (group: string) => groupOpenOrigins.get(group)?.ownerKey
export const groupWorkspacePaneId = (group: string) =>
  groupOpenOrigins.get(group)?.paneId ?? `plugin-workspace:${ID}:group:${encodeURIComponent(group)}`

/** Include parked same-name views without closing the other source's current selection. */
export function closeGroupMainViews(group: string, route: CanonicalGroupRoute): void {
  for (const view of [...(groupOpenOrigins.get(group)?.views?.values() ?? [])]) {
    if (view.route?.connectionId === route.connectionId && view.route.profile === route.profile) {view.close()}
  }
}

export function recordGroupMainTab(group: string, close: () => void, paneId?: string) {
  groupChatMainTabs.set(group, close)
  const opened = groupOpenOrigins.get(group)

  if (paneId && opened) {
    opened.views ??= new Map()
    opened.views.set(paneId, { route: opened.route, close })
  }

  $groupMainTabsRev.set($groupMainTabsRev.get() + 1)
}

export function dropGroupMainTab(group: string, expected?: () => void): boolean {
  const selected = expected ? groupChatMainTabs.get(group) === expected : groupChatMainTabs.has(group)
  const views = groupOpenOrigins.get(group)?.views

  if (expected && views) {
    for (const [id, view] of views) {
      if (view.close === expected) {views.delete(id)}
    }
  }

  if (selected) {
    groupChatMainTabs.delete(group)
    $groupMainTabsRev.set($groupMainTabsRev.get() + 1)
  }

  return selected
}

/** The in-panel room is the FALLBACK surface, not a second copy: it renders
 *  only while no main-window tab owns the group. On desktops with the door
 *  the room already lives in a main tab, and painting it here too produced
 *  two live panes with independent drafts driving one shared engine (#89788).
 *  The selection atom stays set either way so the roster row still
 *  highlights. Callers must subscribe to `$groupMainTabsRev` (BotsPane does)
 *  so ownership changes re-run this gate. */
export function shouldRenderGroupChatInPane(group: null | string): group is string {
  return Boolean(group && !groupChatMainTabs.has(group))
}

export function closeGroupChatMainTab(group: string) {
  const close = groupChatMainTabs.get(group)
  dropGroupMainTab(group)

  if ($groupChatWorkspace.get() === group) {
    $groupChatWorkspace.set(null)
  }

  if (typeof close === 'function') {
    try {
      close()
    } catch {
      /* tab already gone */
    }
  }
}
