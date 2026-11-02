import { registry } from '@/contrib/registry'

import {
  allPaneIds,
  type DropPosition,
  findGroup,
  findGroupOfPane,
  insertAtGroup,
  type LayoutNode,
  movePane as movePaneOp,
  removePane
} from './model'
import { fallbackToolDockGroup } from './tool-panel-policy'

export interface PaneDockHint {
  pane: string
  pos: DropPosition
  /** Center docks: stack BEFORE this pane id (the strip divider's slot). */
  before?: null | string
  /** Enforced dock invariant: the pane is re-homed onto this hint's anchor
   *  on EVERY boot when it isn't already in the declared relationship —
   *  no one-time token, and user placement does not exempt it. Once per
   *  adoption lifetime (per boot), so an intra-session drag sticks until the
   *  next boot. See `enforceDockedPanes`. */
  enforce?: boolean
}

/**
 * Enforced docks restore the owner's relationship on each boot, even for
 * user-placed panes or a spent legacy heal token. The per-boot ledger lets
 * subsequent live drags stick. Center hints join the anchor's tabs; edge
 * hints restore a split. Silent adoption preserves the active tab.
 */
export function enforceDockedPanes(
  tree: LayoutNode,
  dataOf: (paneId: string) => { dock?: PaneDockHint; placement?: string } | undefined,
  enforcedDocksThisBoot: Set<string>
): LayoutNode {
  let next = tree

  for (const pane of registry.getArea('panes')) {
    const dock = dataOf(pane.id)?.dock

    if (!dock?.enforce || !allPaneIds(next).includes(pane.id)) {
      continue
    }

    if (enforcedDocksThisBoot.has(pane.id)) {
      continue
    }

    enforcedDocksThisBoot.add(pane.id)

    const from = findGroupOfPane(next, pane.id)

    const anchor =
      findGroupOfPane(next, dock.pane) ??
      fallbackToolDockGroup(next, pane, id => registry.getArea('panes').find(candidate => candidate.id === id))

    if (!from || !anchor) {
      continue
    }

    if (dock.pos === 'center' && from.id === anchor.id) {
      // Already stacked with its anchor, and nothing to repair: the trees that
      // produced the "my ui only shows bots now... cant find the sessions"
      // regression carried an accidental `headerHidden: true`, which the load
      // migration now drops outright. A surviving `never` here is deliberate
      // and recoverable from the toggle command, so boot does not overrule it.
      continue
    }

    if (dock.pos !== 'center') {
      const moved = movePaneOp(next, pane.id, {
        groupId: anchor.id,
        pos: dock.pos,
        before: dock.before
      })

      if (moved !== next) {
        next = moved
      }

      continue
    }

    const without = removePane(next, pane.id)
    const target = without ? findGroup(without, anchor.id)?.id : undefined

    if (!without || !target) {
      continue
    }

    next = insertAtGroup(without, target, pane.id, 'center', dock.before, false) ?? next
  }

  return next
}
