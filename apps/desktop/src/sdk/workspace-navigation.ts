import { revealSessionWorkspace } from '@/app/open-session'
import { revealTreePane, treePanesWithPrefix } from '@/components/pane-shell/tree/store'
import {
  $workspaceMode,
  rememberActivePane,
  resolveRememberedActivePane,
  setWorkspaceScope,
  type WorkspaceNewSessionTarget
} from '@/components/pane-shell/workspace-scope'
import type { WorkspaceMode } from '@/contrib/types'
import { $focusedTreePaneId, TILE_PANE_PREFIX } from '@/store/session-focus'
import { $sessionTiles } from '@/store/session-states'

/** Switch workspace chrome while retaining the Sessions pane and its draft. */
export function switchWorkspaceScope(
  mode: WorkspaceMode,
  ownerKey: null | string = null,
  newSessionTarget: WorkspaceNewSessionTarget | null = null
): boolean {
  if ($workspaceMode.get() === 'sessions' && mode === 'bots') {
    const pane = $focusedTreePaneId.get()

    if (pane) {
      rememberActivePane('sessions', pane)
    }
  }

  const changed = setWorkspaceScope(mode, ownerKey, newSessionTarget)

  if (changed && mode === 'sessions') {
    const present = new Set(treePanesWithPrefix('session-tile'))

    const candidates = [
      'workspace',
      ...$sessionTiles
        .get()
        .filter(tile => tile.workspaceMode !== 'bots' && present.has(`${TILE_PANE_PREFIX}${tile.storedSessionId}`))
        .map(tile => `${TILE_PANE_PREFIX}${tile.storedSessionId}`)
    ]

    const pane = resolveRememberedActivePane('sessions', candidates)

    if (pane) {
      // Visibility listeners run inside a tree mutation. A later switch wins.
      setTimeout(() => {
        if ($workspaceMode.get() === 'sessions') {
          revealSessionWorkspace(to => {
            window.location.hash = `#${to}`
          })
          revealTreePane(pane)
        }
      }, 0)
    }
  }

  return changed
}
