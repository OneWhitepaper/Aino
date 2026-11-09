import { atom, computed } from 'nanostores'

import { findGroup, findGroupOfPane } from '@/components/pane-shell/tree/model'
import { $activeTreeGroup, $layoutTree } from '@/components/pane-shell/tree/store'
import {
  isConversationPane,
  workspaceActivePane,
  workspaceShownPaneIds
} from '@/components/pane-shell/tree/workspace-presentation'
import { $workspaceMode, $workspaceOwnerKey } from '@/components/pane-shell/workspace-scope'
import { $registryVersion } from '@/contrib/registry'

import { $selectedStoredSessionId } from './session'

// A chat surface: the primary's workspace or a session tile. Everything else a
// zone can show — the sessions list, Files, Terminal, a preview tab — is chrome.
export const TILE_PANE_PREFIX = 'session-tile:'

const isChatPane = (paneId?: string): boolean => Boolean(paneId && isConversationPane(paneId))

// Chrome can own keyboard focus, but working in it (navigating the sessions
// list, browsing Files, typing in Terminal) must not replace the chat being
// worked in with the route's (possibly hidden) primary — the Files rail and
// statusbar follow this chat, so they would jump projects mid-click.
// Remember the pane: a preview can replace its group's active chat tab.
const $lastContentPane = atom<null | string>(null)

const rememberContentPane = () => {
  const groupId = $activeTreeGroup.get()
  const tree = $layoutTree.get()
  const focusedGroup = groupId && tree ? findGroup(tree, groupId) : null
  const active = focusedGroup ? workspaceActivePane(focusedGroup) : undefined

  if (!groupId || isChatPane(active)) {
    $lastContentPane.set(active ?? null)

    return
  }

  // Chrome owns focus: follow the remembered group when it fronts another
  // chat (⌘1..9, drag-to-split) so a preview covering it later keeps it.
  const last = $lastContentPane.get()
  const content = last && tree ? findGroupOfPane(tree, last) : null

  const contentActive = content ? workspaceActivePane(content) : undefined

  if (isChatPane(contentActive)) {
    $lastContentPane.set(contentActive ?? null)
  }
}

$activeTreeGroup.subscribe(rememberContentPane)
$layoutTree.listen(rememberContentPane)
$workspaceMode.listen(rememberContentPane)
$workspaceOwnerKey.listen(rememberContentPane)
$registryVersion.listen(rememberContentPane)

export const $focusedTreePaneId = computed(
  [$activeTreeGroup, $layoutTree, $workspaceMode, $workspaceOwnerKey, $lastContentPane, $registryVersion],
  (groupId, tree, workspaceMode, _ownerKey, lastContentPane) => {
    const focusedGroup = groupId && tree ? findGroup(tree, groupId) : null
    const mainGroup = tree ? findGroupOfPane(tree, 'workspace') : null
    let active = focusedGroup ? workspaceActivePane(focusedGroup) : undefined

    if (groupId && tree && !isChatPane(active)) {
      // Keep the remembered chat while chrome or a preview covers it.
      active =
        lastContentPane && workspaceShownPaneIds([lastContentPane]).length && findGroupOfPane(tree, lastContentPane)
          ? lastContentPane
          : mainGroup
            ? workspaceActivePane(mainGroup)
            : undefined
    }

    if (active?.startsWith(TILE_PANE_PREFIX)) {
      return active
    }

    // Bot chats are tiles, never the primary selection. Sidebar roster focus
    // must not publish a null session and let the Bots home reclaim the chat.
    if (workspaceMode === 'bots' && tree) {
      const mainActive = mainGroup ? workspaceActivePane(mainGroup) : undefined

      if (mainActive?.startsWith(TILE_PANE_PREFIX)) {
        return mainActive
      }
    }

    return active
  }
)

/** The stored id of the session the user is working in: a focused
 *  `session-tile:<storedId>` pane IS that session, anything else falls back to
 *  the route-driven primary selection.
 *
 *  Lives HERE, not in session-states.ts, because low-level stores (the preview
 *  rail) need it and session-states imports them — defining it there made
 *  `session-states` ⇄ `preview` a load cycle. The inputs (the layout tree and
 *  the primary selection) are both leaf stores, so every consumer can share one
 *  derivation without dragging session-states in. */
export const $focusedSessionIsTile = computed($focusedTreePaneId, active =>
  Boolean(active?.startsWith(TILE_PANE_PREFIX))
)

export const $focusedStoredSessionId = computed(
  [$focusedTreePaneId, $selectedStoredSessionId, $workspaceMode],
  (active, selected) =>
    active?.startsWith(TILE_PANE_PREFIX)
      ? active.slice(TILE_PANE_PREFIX.length)
      : (active && active !== 'workspace' && isConversationPane(active)) || !workspaceShownPaneIds(['workspace']).length
        ? null
        : selected
)
