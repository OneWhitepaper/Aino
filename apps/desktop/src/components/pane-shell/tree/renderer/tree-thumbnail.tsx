import { cn } from '@/lib/utils'

import type { LayoutNode } from '../model'

/** Miniature render of a layout tree — the preset card thumbnail. A zone whose
 *  every pane the preset leaves resting is drawn as a ghost: the slot is there,
 *  nothing is in it yet. */
export function TreeThumbnail({ node, resting }: { node: LayoutNode; resting: ReadonlySet<string> }) {
  if (node.type === 'group') {
    const ghost = node.panes.every(id => resting.has(id))

    return (
      // currentColor-derived fill: light zones on dark themes, dark zones on
      // light — legible everywhere without leaning on the accent. A ghost is
      // an outlined empty slot, not a fainter block.
      <div
        className="min-h-0 min-w-0 flex-1 rounded-[2px]"
        style={
          ghost
            ? { border: '1px dashed color-mix(in srgb, currentColor 30%, transparent)' }
            : { background: 'color-mix(in srgb, currentColor 16%, transparent)' }
        }
      />
    )
  }

  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 gap-px', node.orientation === 'row' ? 'flex-row' : 'flex-col')}>
      {node.children.map((child, i) => (
        <div
          className="flex min-h-0 min-w-0"
          key={child.id}
          style={{ flex: `${node.weights[i]} ${node.weights[i]} 0px` }}
        >
          <TreeThumbnail node={child} resting={resting} />
        </div>
      ))}
    </div>
  )
}
