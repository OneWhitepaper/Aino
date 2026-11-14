/**
 * Presets describe layout geometry. A contributed tree must not import live
 * session, preview or route tiles from another context (#94260). `applyTree`
 * adopts the tabs already open into the new geometry after this filtering.
 * Live-tree persistence belongs to its own path and keeps those tabs intact.
 */

import { type LayoutNode, normalize } from './model'

/** Panes that must never ride along in a named layout preset. */
export const PRESET_EXCLUDED_PANE_PREFIXES = ['session-tile:', 'preview-tile:', 'route-tile:'] as const

/** Is `paneId` a live/ephemeral tile that a preset must not carry? */
export const isPresetExcludedPaneId = (paneId: string): boolean =>
  PRESET_EXCLUDED_PANE_PREFIXES.some(prefix => paneId.startsWith(prefix))

/**
 * A copy of `tree` without live/ephemeral tile panes. Zones left empty collapse
 * through `normalize`, which also unwraps the single-child splits they leave
 * behind. Unchanged subtrees keep their reference, so an already-clean preset
 * comes back as the SAME object.
 *
 * Returns `null` when nothing structural remains — a preset that was only a
 * snapshot of open tabs carries no layout and must not be applied (applying it
 * would hand `applyTree` an empty tree).
 */
export function stripPresetLivePanes(tree: LayoutNode): LayoutNode | null {
  const walk = (node: LayoutNode): LayoutNode => {
    if (node.type === 'group') {
      const panes = node.panes.filter(paneId => !isPresetExcludedPaneId(paneId))

      if (panes.length === node.panes.length) {
        return node
      }

      // The active tab may be one of the stripped panes; fall to the first
      // survivor (an emptied zone keeps `''` and is dropped by normalize).
      return { ...node, panes, active: panes.includes(node.active) ? node.active : (panes[0] ?? '') }
    }

    const children = node.children.map(walk)

    // Reference-preserving: a split whose children all came back untouched is
    // returned as-is, so the clean-preset no-op stays allocation-free.
    if (children.every((child, i) => child === node.children[i])) {
      return node
    }

    return { ...node, children }
  }

  return normalize(walk(tree))
}
