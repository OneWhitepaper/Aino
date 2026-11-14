/**
 * Layout tree renderer (root).
 *
 * - `split` -> flex row/column; 1px seams between siblings double as resize
 *   sashes (the seam IS the boundary — junction-owned, never doubled). See
 *   tree-split.tsx.
 * - `group` -> a ZONE: header strip (tabs when stacked, minimize chevron) +
 *   the active pane's content, resolved from the contribution registry
 *   (`area: 'panes'`). Empty zones from legacy saved layouts stay hidden. See
 *   tree-group.tsx.
 *
 * Tabs move through drag-session.ts while navigation and the primary workspace
 * stay fixed. Only the hovered tab destination shows a drop preview. Resizing
 * belongs to the split sashes; session tabs retain their split gestures.
 *
 * This file owns only the composition: the recursive tree, the narrow-viewport
 * overlays and persistent pane hosts. The pieces live in sibling
 * modules — track-model (sizing), drag-session (drag), tree-split / tree-group
 * (nodes), narrow-overlays and keep-alive-panes.
 */

import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect } from 'react'

import { publishWorkspaceGeometry } from '../../geometry'
import { $layoutTree, trackActiveTreeGroup } from '../store'
import { useTabKeyHints } from '../tab-key-hint-state'

import { FloatingPanes } from './floating-panes'
import { KeepAlivePanes } from './keep-alive-panes'
import { NarrowOverlays } from './narrow-overlays'
import { TreeNode } from './tree-node'

export function LayoutTreeRoot({ children, titlebar = false }: { children?: ReactNode; titlebar?: boolean }) {
  const tree = useStore($layoutTree)

  useTabKeyHints()
  // Track the interacted zone so ⌘W closes the right tab even when nothing is
  // DOM-focused.
  useEffect(trackActiveTreeGroup, [])
  // Publish --workspace-left/right so chrome (titlebar title) aligns to the
  // main pane's geometry in plain CSS.
  useEffect(publishWorkspaceGeometry, [])

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1" data-slot="layout-tree-root">
      {/* THE SEAM INVARIANT: boundaries are drawn by the tree (one sash
          hairline per seam) — content mounted in a zone must not paint its
          own edge chrome. App components (asides, the shadcn sidebar) carry
          edge borders + inset highlights for the OLD shell's geometry; this
          neutralizes all of them at the zone boundary, for every current and
          future pane, instead of per-pane class surgery. */}
      <style>{`
        [data-tree-group] :is(aside, [data-slot=sidebar]) {
          border-left-width: 0;
          border-right-width: 0;
          box-shadow: none;
        }
        /* Old-shell titlebar BANDS (chat's session header et al size to
           --titlebar-height, which is 0 inside zones): a zero-height band is
           non-functional but still paints its border-b — a stray hairline
           doubling the zone's top seam. Remove the band entirely. */
        [data-tree-group] header[class*="h-(--titlebar-height)"] {
          display: none;
        }
      `}</style>
      <KeepAlivePanes>
        {tree && (
          <TreeNode
            leftEdge={titlebar}
            node={tree}
            rightEdge={titlebar}
            root
            rootRow={tree.type === 'split' && tree.orientation === 'row'}
            topEdge={titlebar}
          />
        )}
        {tree && <NarrowOverlays />}
      </KeepAlivePanes>
      {tree && (
        <>
          {/* Non-tiling panes: fixed cards above the tree, outside every zone. */}
          <FloatingPanes />
          {children}
        </>
      )}
    </div>
  )
}
