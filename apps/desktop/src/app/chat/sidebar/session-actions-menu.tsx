import { useStore } from '@nanostores/react'
import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'

import { openSession } from '@/app/open-session'
import {
  closeAllTreeTabs,
  closeOtherTreeTabs,
  closeTreeTabsToRight,
  reloadTreePane,
  treeTabCloseTargets
} from '@/components/pane-shell/tree/store'
import { $workspaceOwnerLabels, workspaceOwnerTitle } from '@/components/pane-shell/workspace-scope'
import {
  type ActionItemSpec,
  ActionsContextMenu,
  ActionsMenu,
  type MenuKit,
  renderActionItem
} from '@/components/ui/actions-menu'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CopyButton } from '@/components/ui/copy-button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { getApiRequestConnection, getApiRequestProfile, renameSession } from '@/hermes'
import { useI18n } from '@/i18n'
import { sessionRemovalCopy, type SessionRemovalCopy } from '@/i18n/session-removal'
import { triggerHaptic } from '@/lib/haptics'
import { isSubmitEnter } from '@/lib/ime'
import { exportSession } from '@/lib/session-export'
import { useStoresSelector } from '@/lib/use-session-slice'
import { $botChatScopes } from '@/store/bot-chat-scope'
import { activeGateway } from '@/store/gateway'
import { $notificationEpoch, notify, notifyError } from '@/store/notifications'
import {
  $projectTree,
  applyRenamedSessionTitle,
  moveSessionToProject,
  projectIdForCwd,
  projectRootCwd,
  refreshProjectTree
} from '@/store/projects'
import {
  $activeSessionId,
  $connection,
  $selectedStoredSessionId,
  $sessions,
  $unreadFinishedSessionIds,
  applySessionTitle,
  markSessionRead,
  sessionMatchesStoredId
} from '@/store/session'
import { ambientRequestFor } from '@/store/session-gone-latch'
import {
  $sessionStates,
  $sessionTiles,
  closeAllOpenSessionTiles,
  requestForOwnedSession,
  sessionTileDelegate
} from '@/store/session-states'
import { ackStoredSessionId } from '@/store/session-unread'
import { canOpenSessionInTerminal, canOpenSessionWindow, openSessionInTerminal } from '@/store/windows'

import type { SessionTitleResponse } from '../../types'

import { SessionMenuIcon, type SessionMenuIconName } from './session-menu-icon'

// Rename a session, preferring the gateway's session.title RPC over REST.
//
// A freshly *branched* session (and any brand-new chat) lives only in the
// gateway's in-memory _sessions map keyed by its RUNTIME id — no row is
// persisted to state.db until the first turn. REST PATCH /api/sessions/{id}
// resolves against the stored sessions table, so it 404s ("Session not found")
// on these runtime-only sessions. The session.title RPC resolves the live
// runtime session AND persists the row on demand, so it succeeds where REST
// cannot. This mirrors the /title slash command's fix (use-prompt-actions.ts).
//
// We only take the RPC path for the ACTIVE/selected session: its runtime id is
// known ($activeSessionId) and it lives on the active gateway, so there is no
// profile-routing ambiguity. Every other row (already persisted, possibly on a
// background profile) keeps the REST path, which handles profile scoping and a
// non-empty title is required by the RPC (it rejects clears), so clears stay on
// REST too.
/** Resolve a live runtime id for a stored session id, from any surface that
 *  currently holds one — not just the selected-primary row.
 *
 *  A branched session opens as its own TAB and deliberately does NOT become the
 *  selected primary row, so `$selectedStoredSessionId`/`$activeSessionId` do not
 *  see it. Until its first turn it also has no persisted DB row, so a REST
 *  rename 404s "session not found". But the branch flow binds a runtime and
 *  stores it on the tile (`patchSessionTile(..., { runtimeId })`), and
 *  `$sessionStates` is keyed by runtime id with `storedSessionId` on each state.
 *  Consulting those lets the working `session.title` RPC path fire for a
 *  just-branched draft instead of falling through to a 404. (#70317) */
function resolveRuntimeIdForStored(storedSessionId: string): null | string {
  if (storedSessionId === $selectedStoredSessionId.get()) {
    const active = $activeSessionId.get()

    if (active) {
      return active
    }
  }

  const tileRuntimeId = $sessionTiles.get().find(tile => tile.storedSessionId === storedSessionId)?.runtimeId

  if (tileRuntimeId) {
    return tileRuntimeId
  }

  for (const [runtimeId, state] of Object.entries($sessionStates.get())) {
    if (state.storedSessionId === storedSessionId) {
      return runtimeId
    }
  }

  return null
}

export async function renameSessionPreferringRpc(
  storedSessionId: string,
  title: string,
  profile?: string
): Promise<{ title?: string }> {
  const resolvedProfile =
    (profile ?? '').trim() ||
    $sessions.get().find(s => sessionMatchesStoredId(s, storedSessionId))?.profile ||
    undefined

  const runtimeId = resolveRuntimeIdForStored(storedSessionId)
  const gateway = activeGateway()

  if (title && runtimeId && gateway) {
    try {
      // The runtime lives on its owner's backend; the ambient socket would
      // refuse a secondary profile's session and drop us to REST.
      const result = await requestForOwnedSession<SessionTitleResponse>(
        runtimeId,
        ambientRequestFor(gateway),
        'session.title',
        { session_id: runtimeId, title }
      )

      return { title: result?.title ?? title }
    } catch (err) {
      // Fall through to REST — e.g. the socket is mid-reconnect. REST still
      // works for any session that already has a persisted row. Log so a
      // genuine RPC-side failure (which then surfaces a REST 404 for the
      // runtime id) is at least diagnosable instead of silently swallowed.
      console.warn('session.title RPC rename failed; falling back to REST', err)
    }
  }

  return renameSession(storedSessionId, title, resolvedProfile)
}

interface SessionActions {
  sessionId: string
  title: string
  pinned?: boolean
  /** Backend-derived read state — drives the Mark as unread/read label. */
  unread?: boolean
  /** The row is already archived (the sidebar's Archived view): the shared
   *  archive verb becomes Unarchive and restores the session (#98813). */
  archived?: boolean
  profile?: string
  onPin?: () => void
  /** Toggle the persisted read-state watermark for this row. */
  onToggleUnread?: () => void
  onBranch?: () => void
  onArchive?: () => void
  onDelete?: () => Promise<void> | void
  /** Close this surface (a tile tab) — omitted where nothing closes (sidebar
   *  rows, the main tab). */
  onClose?: () => void
  /** TAB surfaces: the session is already a tab, so "Open in new tab" is
   *  nonsense there — sidebar rows/dropdowns keep it. */
  surface?: 'row' | 'tab'
  /** May this session be renamed? False for a canonical Bot Chat tab: its
   *  exact title is the bot's identity (the backend guard refuses a user
   *  rename and the caption never reads the stored title anyway — #124857),
   *  so the Rename item and dialog are omitted instead of toasting success
   *  over a no-op. Mirrors how onPin/onBranch are gated. */
  renameable?: boolean
  /** The tab's layout-tree pane id (`session-tile:<id>` or `workspace`) — enables
   *  the Close-others / to-the-right / all tab verbs. Tab surfaces only. */
  tabPaneId?: string
  /** The MAIN tab's escape hatch: hide the zone's tab bar (it sticky-shows
   *  once a tab is ever gained; this is the explicit off switch). */
  onHideTabBar?: () => void
}

interface DeleteSessionTarget {
  sessionId: string
  title: string
  workspace: string
  epoch: number
  connection: ReturnType<typeof getApiRequestConnection>
  profile: ReturnType<typeof getApiRequestProfile>
  confirm: () => Promise<void> | void
  archive?: () => Promise<void>
}

function captureDeleteTarget(
  sessionId: string,
  title: string,
  profile: string | undefined,
  confirm: () => Promise<void> | void,
  archived: boolean,
  copy: SessionRemovalCopy
): DeleteSessionTarget {
  const rowProfile = profile || $sessions.get().find(row => sessionMatchesStoredId(row, sessionId))?.profile
  const delegate = sessionTileDelegate()

  return {
    sessionId,
    title,
    workspace: rowProfile === 'default' ? copy.defaultWorkspace : rowProfile || copy.unknownWorkspace,
    epoch: $notificationEpoch.get(),
    connection: getApiRequestConnection(),
    profile: getApiRequestProfile(),
    confirm,
    ...(!archived && delegate ? { archive: () => delegate.archiveSession(sessionId, { throwOnError: true }) } : {})
  }
}

// The project list inside the session menu's "Move to project" submenu. Its own
// component so only an OPEN submenu subscribes to the stores.
// Re-homes the session's workspace at the target
// project's root — the fix for a chat created in the wrong folder. The current
// owner and folderless projects (the Home bucket) are excluded: there is
// nothing to move into.
function MoveToProjectItems({ kit, sessionId, profile }: { kit: MenuKit; sessionId: string; profile?: string }) {
  const { t } = useI18n()
  const p = t.sidebar.projects
  const tree = useStore($projectTree)
  const session = useStore($sessions).find(s => sessionMatchesStoredId(s, sessionId))
  const cwd = session?.cwd?.trim() || ''
  const currentProjectId = cwd ? projectIdForCwd(cwd) : null
  const targets = tree.filter(node => node.id !== currentProjectId && !node.isNoProject && projectRootCwd(node))

  // The flat (non-grouped) sidebar view only warms $projectTree on a
  // background timer (PROJECT_TREE_WARM_MS in sidebar/index.tsx), so opening
  // this submenu before that timer fires — or before the grouped view has
  // ever been visited this run — showed "No other projects" even when
  // projects exist. Refresh on open so the list is authoritative regardless
  // of sidebar grouping state or timing.
  useEffect(() => {
    void refreshProjectTree()
  }, [])

  if (targets.length === 0) {
    return <kit.Item disabled>{p.moveNoProjects}</kit.Item>
  }

  return (
    <>
      {targets.map(node => (
        <kit.Item
          key={node.id}
          onSelect={() => {
            triggerHaptic('selection')
            moveSessionToProject(sessionId, node.id, profile)
              .then(() => notify({ durationMs: 2_000, kind: 'success', message: p.movedTo(node.label) }))
              .catch(err => notifyError(err, p.moveFailed))
          }}
        >
          {node.label}
        </kit.Item>
      ))}
    </>
  )
}

function useSessionActions({
  sessionId,
  title,
  pinned = false,
  unread = false,
  archived = false,
  profile,
  onPin,
  onToggleUnread,
  onBranch,
  onArchive,
  onDelete,
  onClose,
  onHideTabBar,
  renameable = true,
  surface = 'row',
  tabPaneId
}: SessionActions) {
  const { t, locale } = useI18n()
  const r = t.sidebar.row
  const removalCopy = sessionRemovalCopy(locale)
  const [renameOpen, setRenameOpen] = useState(false)
  // The rename item opens a Dialog. When a menu closes, Radix restores focus to
  // its trigger — for a sidebar row that trigger is the row's own <button>, so
  // focus lands there instead of the dialog's input: Space then activates the
  // row (selecting the session) and the arrow keys move the list rather than
  // the caret. Suppress that one restore so the dialog keeps focus; every other
  // action leaves the restore alone (it's the correct behavior for them). Mirrors
  // the project menu's appearance-popover guard.
  const suppressCloseFocusRef = useRef(false)
  const [deleteTarget, setDeleteTarget] = useState<DeleteSessionTarget | null>(null)
  const tiles = useStore($sessionTiles)

  // Canonical bot-chat titles are registry keys. The confirmation names the
  // same exact session owner as its caption without changing that stored key.
  const deleteTitle = useStoresSelector([$sessionTiles, $botChatScopes, $workspaceOwnerLabels], () =>
    workspaceOwnerTitle(
      title,
      $sessionTiles.get().find(tile => tile.storedSessionId === sessionId) ?? $botChatScopes.get()[sessionId]
    )
  )

  const selectedStoredSessionId = useStore($selectedStoredSessionId)
  const isRemote = useStore($connection)?.mode === 'remote'
  // The row's finished-unread dot is cleared by opening the session (main or
  // tile) — this menu item is the explicit escape hatch for the rest.
  const isUnread = useStore($unreadFinishedSessionIds).includes(sessionId)

  // Already showing as a tab somewhere (a tile, or loaded in main — main IS
  // a tab): offering "Open in new tab" again is noise.
  const alreadyTabbed = sessionId === selectedStoredSessionId || tiles.some(tile => tile.storedSessionId === sessionId)

  const spec = ({
    icon,
    ...partial
  }: Omit<ActionItemSpec, 'icon' | 'iconNode' | 'onSelect'> & {
    icon: SessionMenuIconName
    onSelect: () => void
  }): ActionItemSpec => ({ ...partial, iconNode: <SessionMenuIcon name={icon} /> })

  // OPEN — where else this session can go. A tab surface IS a tab already,
  // so it only offers the window hop (and its own Close, below).
  const openItems: ActionItemSpec[] = [
    ...(surface === 'row' && !alreadyTabbed
      ? [
          spec({
            disabled: !sessionId,
            icon: 'browser',
            label: r.openInNewTab,
            onSelect: () => {
              triggerHaptic('selection')
              // Stack into the MAIN zone as a tab (center dock; the strip
              // sticky-shows on gain) — the door to the tab bar. Focuses first
              // if the session is already on screen.
              openSession(sessionId, () => undefined, 'tab')
            }
          })
        ]
      : []),
    ...(canOpenSessionWindow()
      ? [
          spec({
            disabled: !sessionId,
            icon: 'link-external',
            label: r.newWindow,
            onSelect: () => {
              triggerHaptic('selection')
              openSession(sessionId, () => undefined, 'window')
            }
          })
        ]
      : []),
    // The user's OWN terminal, not the in-app pane: resumes the session in the
    // TUI. Hidden on a remote connection — the emulator we'd open runs on this
    // machine while the session (and its runtime) lives on the remote host.
    ...(canOpenSessionInTerminal() && !isRemote
      ? [
          spec({
            disabled: !sessionId,
            icon: 'terminal',
            label: r.openInTerminal,
            onSelect: () => {
              triggerHaptic('selection')

              // Read the row lazily: subscribing every row's menu to $sessions
              // would re-render the whole sidebar on each session update.
              const cwd =
                $sessions
                  .get()
                  .find(s => sessionMatchesStoredId(s, sessionId))
                  ?.cwd?.trim() || undefined

              void openSessionInTerminal(sessionId, { cwd, profile })
            }
          })
        ]
      : [])
  ]

  // IDENTITY — name/mark/reference the session. Rename is omitted (not
  // disabled) for a session whose title is not its name — a canonical Bot
  // Chat — so the menu never offers a verb whose result the user cannot see.
  const identityItems: ActionItemSpec[] = [
    ...(renameable
      ? [
          spec({
            disabled: !sessionId,
            icon: 'edit',
            label: r.rename,
            onSelect: () => {
              triggerHaptic('selection')
              // Keep focus off the row trigger so it lands in the dialog input.
              suppressCloseFocusRef.current = true
              setRenameOpen(true)
            }
          })
        ]
      : []),
    spec({
      disabled: !onPin,
      icon: pinned ? 'pin-off' : 'pin',
      label: pinned ? r.unpin : r.pin,
      onSelect: () => {
        triggerHaptic('selection')
        onPin?.()
      }
    }),
    // One read-state item, driven by BOTH unread sources: the transient
    // finished-unread dot (isUnread) and the backend watermark (unread).
    // "Mark as read" clears whichever is lit; "Mark as unread" arms the
    // persisted watermark so the dot survives restarts.
    spec({
      disabled: !sessionId || (!onToggleUnread && !isUnread),
      icon: unread || isUnread ? 'mail-read' : 'mail',
      label: unread || isUnread ? r.markRead : r.markUnread,
      onSelect: () => {
        triggerHaptic('selection')

        if (unread || isUnread) {
          // Clear the transient family dot immediately (and ack the persisted
          // watermark/marker so a list refresh doesn't repaint it)…
          markSessionRead(sessionId)
          ackStoredSessionId(sessionId)

          // …and retire the persisted watermark when the row carries one.
          if (unread) {
            onToggleUnread?.()
          }
        } else {
          onToggleUnread?.()
        }
      }
    })
  ]

  // WORK — derive/extract from the session.
  const workItems: ActionItemSpec[] = [
    spec({
      disabled: !onBranch,
      icon: 'repo-forked',
      label: r.branchFrom,
      onSelect: () => {
        triggerHaptic('selection')
        onBranch?.()
      }
    }),
    spec({
      disabled: !sessionId,
      icon: 'cloud-download',
      label: r.export,
      onSelect: () => {
        triggerHaptic('selection')
        void exportSession(sessionId, { profile, title })
      }
    })
  ]

  // TAB — verbs that act on the strip (tabs only; a row isn't a tab).
  const closeTargets = surface === 'tab' && tabPaneId ? treeTabCloseTargets(tabPaneId) : null

  const tabItems: ActionItemSpec[] =
    surface === 'tab'
      ? [
          ...(tabPaneId
            ? [
                spec({
                  icon: 'refresh',
                  label: t.zones.reload,
                  onSelect: () => {
                    triggerHaptic('selection')
                    reloadTreePane(tabPaneId)
                  }
                })
              ]
            : []),
          ...(onClose
            ? [
                spec({
                  disabled: false,
                  icon: 'close',
                  label: t.common.close,
                  onSelect: () => {
                    triggerHaptic('selection')
                    onClose()
                  }
                })
              ]
            : []),
          ...(tabPaneId
            ? [
                spec({
                  disabled: !closeTargets?.others,
                  icon: 'close-all',
                  label: t.zones.closeOthers,
                  onSelect: () => {
                    triggerHaptic('selection')
                    closeOtherTreeTabs(tabPaneId)
                  }
                }),
                spec({
                  disabled: !closeTargets?.right,
                  icon: 'arrow-right',
                  label: t.zones.closeToRight,
                  onSelect: () => {
                    triggerHaptic('selection')
                    closeTreeTabsToRight(tabPaneId)
                  }
                }),
                spec({
                  disabled: !closeTargets?.all,
                  icon: 'clear-all',
                  label: t.zones.closeAll,
                  onSelect: () => {
                    triggerHaptic('selection')
                    // Persist-close session tiles before dismissing the
                    // remaining tree panes, or Bot Mode rehydrates them
                    // from the shared tile bucket (#94137).
                    closeAllOpenSessionTiles(tabPaneId)
                    closeAllTreeTabs(tabPaneId)
                  }
                })
              ]
            : [])
        ]
      : []

  // DANGER — put it away / destroy it (delete stays last, destructive-red).
  const dangerItems: ActionItemSpec[] = [
    spec({
      disabled: !onArchive,
      // Already archived (the Archived view): the same verb restores the row
      // instead of re-archiving it (#98813). The wiring dispatches the shared
      // onArchive callback to the restore path based on the row's state.
      icon: archived ? 'archive-restore' : 'archive',
      label: archived ? r.unarchive : r.archive,
      onSelect: () => {
        triggerHaptic('selection')
        onArchive?.()
      }
    }),
    {
      className: 'text-destructive focus:text-destructive',
      disabled: !onDelete,
      iconNode: <SessionMenuIcon name="trash" />,
      label: t.common.delete,
      onSelect: () => {
        triggerHaptic('warning')

        // Deleting is irreversible (the CLI path asks y/N; the desktop used to
        // fire instantly on click). Gate it behind an explicit confirm — see
        // #61470. The dialog owns the delete call, so every surface that routes
        // through this menu (sidebar rows, tab menus, the chat header) gets the
        // guard for free.
        if (onDelete) {
          suppressCloseFocusRef.current = true
          setDeleteTarget(captureDeleteTarget(sessionId, deleteTitle, profile, onDelete, archived, removalCopy))
        }
      },
      variant: 'destructive'
    }
  ]

  const renderItems = (kit: MenuKit) => (
    <>
      {openItems.map(item => renderActionItem(kit, item))}
      {openItems.length > 0 && <kit.Separator />}
      {identityItems.map(item => renderActionItem(kit, item))}
      <CopyButton
        appearance={kit.copyAppearance}
        disabled={!sessionId}
        errorMessage={r.copyIdFailed}
        iconClassName="size-4 text-current"
        idleIcon={<SessionMenuIcon name="copy" />}
        key={r.copyId}
        label={r.copyId}
        onCopyError={err => notifyError(err, r.copyIdFailed)}
        text={sessionId}
      />
      <kit.Separator />
      {workItems.map(item => renderActionItem(kit, item))}
      <kit.Sub>
        <kit.SubTrigger disabled={!sessionId}>
          <SessionMenuIcon name="folder" />
          <span>{t.sidebar.projects.moveToProject}</span>
        </kit.SubTrigger>
        <kit.SubContent>
          <MoveToProjectItems kit={kit} profile={profile} sessionId={sessionId} />
        </kit.SubContent>
      </kit.Sub>
      {tabItems.length > 0 && (
        <>
          <kit.Separator />
          {tabItems.map(item => renderActionItem(kit, item))}
        </>
      )}
      <kit.Separator />
      {dangerItems.map(item => renderActionItem(kit, item))}
      {onHideTabBar && (
        <>
          <kit.Separator />
          {renderActionItem(kit, {
            disabled: false,
            iconNode: <SessionMenuIcon name="eye-closed" />,
            label: r.hideTabBar,
            onSelect: () => {
              triggerHaptic('selection')
              onHideTabBar()
            }
          })}
        </>
      )}
    </>
  )

  const renameDialog = renameable ? (
    <RenameSessionDialog
      currentTitle={title}
      onOpenChange={setRenameOpen}
      open={renameOpen}
      profile={profile}
      sessionId={sessionId}
    />
  ) : null

  // Consumed once per close: when rename was the action that closed the menu,
  // block Radix's focus-restore to the trigger so the dialog input keeps focus.
  const onCloseAutoFocus = (event: Event) => {
    if (suppressCloseFocusRef.current) {
      suppressCloseFocusRef.current = false
      event.preventDefault()
    }
  }

  const deleteDialog = (
    <DeleteSessionDialog onClose={() => setDeleteTarget(null)} sessionId={sessionId} target={deleteTarget} />
  )

  return { deleteDialog, onCloseAutoFocus, renameDialog, renderItems }
}

interface DeleteSessionDialogProps {
  onClose: () => void
  sessionId: string
  target: DeleteSessionTarget | null
}

// Thin wrapper over ConfirmDialog — the single choke point for every session
// delete entry point (sidebar rows, tab menus, the chat header). Deleting a
// session is irreversible and the desktop used to fire it instantly on click
// (#61470); this mirrors the CLI's y/N guard. The deletion promise reaches
// ConfirmDialog so failure stays in the decision instead of showing success.
function DeleteSessionDialog({ sessionId, onClose, target }: DeleteSessionDialogProps) {
  return target ? (
    <SessionDeleteDecision
      key={`${target.epoch}:${target.sessionId}`}
      onClose={onClose}
      sessionId={sessionId}
      target={target}
    />
  ) : null
}

function SessionDeleteDecision({
  sessionId,
  onClose,
  target
}: Omit<DeleteSessionDialogProps, 'target'> & { target: DeleteSessionTarget }) {
  const { t, locale } = useI18n()
  const r = t.sidebar.row
  const copy = sessionRemovalCopy(locale)
  const notificationEpoch = useStore($notificationEpoch)
  const open = target.sessionId === sessionId && target.epoch === notificationEpoch

  const run = (action: () => Promise<void> | void) => {
    if (
      target.epoch !== $notificationEpoch.get() ||
      target.connection !== getApiRequestConnection() ||
      target.profile !== getApiRequestProfile()
    ) {
      throw new Error(copy.unavailable)
    }

    return action()
  }

  return (
    <ConfirmDialog
      busyLabel={r.deleting}
      confirmLabel={t.common.delete}
      description={r.deleteDesc(target.title)}
      destructive
      doneLabel={r.deleted}
      onClose={onClose}
      onConfirm={() => run(target.confirm)}
      open={open}
      secondaryAction={
        target.archive
          ? { label: copy.remove, busyLabel: copy.removing, onClick: () => run(target.archive!) }
          : undefined
      }
      title={r.deleteTitle}
    >
      <dl className="min-w-0 space-y-3 text-[length:var(--aino-text-body)] leading-relaxed">
        {[
          { label: copy.object, value: target.title },
          { label: copy.workspace, value: target.workspace },
          { label: copy.scope, value: copy.impact }
        ].map(({ label, value }) => (
          <div className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-3" key={label}>
            <dt className="text-muted-foreground [overflow-wrap:anywhere]">{label}</dt>
            <dd className="m-0 min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
      {target.archive && (
        <p className="text-[length:var(--aino-text-body)] leading-relaxed text-muted-foreground">{copy.archiveHint}</p>
      )}
    </ConfirmDialog>
  )
}

interface SessionActionsMenuProps
  extends
    SessionActions,
    Pick<React.ComponentProps<typeof ActionsMenu>, 'align' | 'onOpenChange' | 'open' | 'sideOffset'> {
  children: React.ReactNode
}

export function SessionActionsMenu({
  children,
  align = 'end',
  onOpenChange,
  open,
  sideOffset = 6,
  ...actions
}: SessionActionsMenuProps) {
  const { t } = useI18n()
  const { deleteDialog, onCloseAutoFocus, renameDialog, renderItems } = useSessionActions(actions)

  return (
    <>
      <ActionsMenu
        align={align}
        ariaLabel={t.sidebar.row.sessionActions}
        contentClassName="w-40"
        items={renderItems}
        onCloseAutoFocus={onCloseAutoFocus}
        onOpenChange={onOpenChange}
        open={open}
        sideOffset={sideOffset}
      >
        {children}
      </ActionsMenu>
      {renameDialog}
      {deleteDialog}
    </>
  )
}

interface SessionContextMenuProps extends SessionActions {
  children: React.ReactNode
}

export function SessionContextMenu({ children, ...actions }: SessionContextMenuProps) {
  const { t } = useI18n()
  const { deleteDialog, onCloseAutoFocus, renameDialog, renderItems } = useSessionActions(actions)

  return (
    <>
      <ActionsContextMenu
        ariaLabel={t.sidebar.row.sessionActions}
        contentClassName="w-40"
        items={renderItems}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {children}
      </ActionsContextMenu>
      {renameDialog}
      {deleteDialog}
    </>
  )
}

interface RenameSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  currentTitle: string
  profile?: string
}

function RenameSessionDialog({ open, onOpenChange, sessionId, currentTitle, profile }: RenameSessionDialogProps) {
  const { t } = useI18n()
  const r = t.sidebar.row
  const [value, setValue] = useState(currentTitle)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const wasOpen = useRef(false)

  // eslint-disable-next-line no-restricted-syntax -- Tracks this dialog's open edge, not a mirrored store value.
  useEffect(() => {
    const justOpened = open && !wasOpen.current
    wasOpen.current = open

    // Snapshot once per opening; background auto-titles must not replace edits.
    if (justOpened) {
      setValue(currentTitle)
      window.setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [currentTitle, open])

  const submit = async () => {
    const next = value.trim()

    if (!sessionId || submitting) {
      return
    }

    if (next === currentTitle.trim()) {
      onOpenChange(false)

      return
    }

    setSubmitting(true)

    try {
      const targetProfile =
        (profile ?? '').trim() || $sessions.get().find(s => sessionMatchesStoredId(s, sessionId))?.profile || undefined

      const result = await renameSessionPreferringRpc(sessionId, next, targetProfile)
      const finalTitle = result.title || next || ''
      // One write, every list: patch the main store AND the project surfaces.
      // Bare-id patching only the recents slice left project-scoped rows
      // (overview previews, entered-project lanes) on the stale title until a
      // profile switch forced a refetch (#123337).
      applySessionTitle(sessionId, finalTitle || null)
      applyRenamedSessionTitle(sessionId, finalTitle || null)
      notify({ durationMs: 2_000, kind: 'success', message: r.renamed })
      onOpenChange(false)
    } catch (err) {
      notifyError(err, r.renameFailed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{r.renameTitle}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          disabled={submitting}
          onChange={event => setValue(event.target.value)}
          onKeyDown={event => {
            if (isSubmitEnter(event)) {
              event.preventDefault()
              void submit()
            } else if (event.key === 'Escape') {
              onOpenChange(false)
            }
          }}
          placeholder={r.untitledPlaceholder}
          ref={inputRef}
          value={value}
        />
        <DialogFooter>
          <Button disabled={submitting} onClick={() => onOpenChange(false)} type="button" variant="ghost">
            {t.common.cancel}
          </Button>
          <Button disabled={submitting} onClick={() => void submit()} type="button">
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
