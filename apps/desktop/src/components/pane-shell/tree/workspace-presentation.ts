import type { ReadableAtom } from 'nanostores'

import { workspacePageKeepsPane } from '@/app/routes'
import { $registryVersion, registry } from '@/contrib/registry'

import {
  $workspaceMode,
  $workspaceOwnerKey,
  rememberActivePane,
  resolveRememberedActivePane,
  type WorkspacePaneScope,
  workspaceScopeKey
} from '../workspace-scope'

import { findGroup, groupLeafIds, type GroupNode, type LayoutNode, setActivePane } from './model'

/** Stored chats and explicitly contributed group conversations share navigation. */
export const isConversationPane = (paneId: string): boolean =>
  (paneId === 'workspace' && !workspaceShowsPage()) ||
  paneId.startsWith('session-tile:') ||
  (registry.getArea('panes').find(pane => pane.id === paneId)?.data as { tabPresentation?: string } | undefined)
    ?.tabPresentation === 'conversation'

/** The workspace contribution synchronously mirrors the route's page state. */
function workspaceShowsPage(): boolean {
  return Boolean(
    (registry.getArea('panes').find(pane => pane.id === 'workspace')?.data as { headerVeto?: boolean } | undefined)
      ?.headerVeto
  )
}

/** Presentation-only scope metadata, published by the surface that owns the session. */
function paneWorkspaceScope(paneId: string): WorkspacePaneScope | undefined {
  const data = registry.getArea('panes').find(pane => pane.id === paneId)?.data as
    { workspaceScope?: WorkspacePaneScope | (() => WorkspacePaneScope | undefined) } | undefined

  return typeof data?.workspaceScope === 'function' ? data.workspaceScope() : data?.workspaceScope
}

export function workspacePaneMemoryKey(groupId: string): string {
  return JSON.stringify([workspaceScopeKey($workspaceMode.get(), $workspaceOwnerKey.get()), groupId])
}

/** Tools stay shared. Conversations are selectable only in their exact workspace. */
export function workspaceShownPaneIds(paneIds: readonly string[]): string[] {
  if (workspaceShowsPage()) {
    return paneIds.filter(workspacePageKeepsPane)
  }

  const mode = $workspaceMode.get()
  const ownerKey = $workspaceOwnerKey.get()

  return paneIds.filter(id => {
    if (!isConversationPane(id)) {
      return true
    }

    const scope = paneWorkspaceScope(id)

    return (scope?.mode ?? 'sessions') === mode && (mode === 'sessions' || (scope?.ownerKey ?? null) === ownerKey)
  })
}

/** Shared by the rendered body, visibility, focus and keyboard navigation. */
export function workspaceActivePane(group: GroupNode, shown = workspaceShownPaneIds(group.panes)): string {
  return shown.includes(group.active)
    ? group.active
    : (resolveRememberedActivePane(workspacePaneMemoryKey(group.id), shown) ?? '')
}

/** A new session docks beside the current stored chat, else the first eligible one. */
export function workspaceSessionAnchor(group: GroupNode, shown: string[]): null | string {
  const isSession = (id: string) => id === 'workspace' || id.startsWith('session-tile:')
  const active = workspaceActivePane(group, shown)

  return isSession(active) ? active : (shown.find(isSession) ?? null)
}

/** Registered, unhidden candidates shared by shortcut and visibility readers. */
export function workspaceAvailablePaneIds(
  paneIds: readonly string[],
  hidden: ReadonlySet<string>,
  narrow: boolean
): string[] {
  const registered = registry.getArea('panes')

  return workspaceShownPaneIds(paneIds).filter(id => {
    const pane = registered.find(item => item.id === id)

    return (
      Boolean(pane) &&
      !hidden.has(id) &&
      !(narrow && Boolean((pane?.data as { collapsible?: boolean } | undefined)?.collapsible))
    )
  })
}

/** Explicit conversation activation updates both the zone and the owner's return target. */
export function rememberWorkspacePane(groupId: string, paneId: string): void {
  if (isConversationPane(paneId) && workspaceShownPaneIds([paneId]).length) {
    rememberActivePane(workspacePaneMemoryKey(groupId), paneId)
    rememberActivePane(workspaceScopeKey($workspaceMode.get(), $workspaceOwnerKey.get()), paneId)
  }
}

export function watchWorkspaceActivePanes(
  treeStore: ReadableAtom<LayoutNode | null>,
  write: (tree: LayoutNode) => void
): void {
  let workspaceRestoreGeneration = 0

  /** Scope notifications can arrive inside a sidebar layout mutation. Reconcile
   *  the actual tree once that mutation settles; immediate readers use the same
   *  effective active resolver above throughout the transition. */
  function restoreWorkspaceActivePanes(): void {
    const generation = ++workspaceRestoreGeneration
    setTimeout(() => {
      if (generation !== workspaceRestoreGeneration) {
        return
      }

      const tree = treeStore.get()

      if (!tree) {
        return
      }

      let next = tree

      for (const groupId of groupLeafIds(tree)) {
        const group = findGroup(tree, groupId)!
        // Scope/page changes never rewrite a saved active tool just because
        // its chrome toggle is hidden; the renderer owns that visual fallback.
        const shown = workspaceShownPaneIds(group.panes)
        const active = workspaceActivePane(group, shown)

        if (active && active !== group.active) {
          next = setActivePane(next, groupId, active)
        }
      }

      if (next !== tree) {
        write(next)
      }
    }, 0)
  }

  $workspaceMode.listen(restoreWorkspaceActivePanes)
  $workspaceOwnerKey.listen(restoreWorkspaceActivePanes)
  $registryVersion.listen(restoreWorkspaceActivePanes)
}
