/**
 * Layout presets are contributions: the app registers bundled layouts and
 * plugins can register their own trees through the same layouts area.
 */

import { registry } from '@/contrib/registry'
import { writeKey } from '@/lib/storage'
import { asLayoutIntent, type Tiered } from '@/store/interface-mode'

import type { LayoutNode } from './model'
import { stripPresetLivePanes } from './preset-tree'
import { applyTree } from './store'
import { consolidateRestoredToolPanels } from './tool-panel-policy'

export const LAYOUTS_AREA = 'layouts'

/**
 * A preset is the tree plus what the tree cannot say. `resting` names the
 * panes it places but leaves CLOSED — every other pane it places opens on
 * apply, so a preset states what is on screen. `tier` names the one mode
 * whose shelf carries it. Both stay off `data`, which every consumer reads as
 * a bare `LayoutNode`.
 */
export interface LayoutPresetSpec extends Tiered {
  id: string
  /** `false` keeps a preset off every picker and out of `apply_layout`; only its owner applies it. */
  listed?: false
  order: number
  resting?: readonly string[]
  title: string
  tree: LayoutNode
}

const specs = new Map<string, Pick<LayoutPresetSpec, 'resting' | 'tier'>>()

export function registerBundledPresets(bundled: readonly LayoutPresetSpec[]) {
  for (const spec of bundled) {
    rememberSpec(spec.id, spec)
  }

  return registry.registerMany(
    bundled.map(({ id, listed, order, title, tree }) => ({
      id,
      area: LAYOUTS_AREA,
      title,
      order,
      data: tree,
      ...(listed === false && { enabled: false })
    }))
  )
}

function rememberSpec(id: string, { resting, tier }: Pick<LayoutPresetSpec, 'resting' | 'tier'>) {
  specs.set(id, { resting, tier })
}

/** Contributions without a tier are available in either interface mode. */
export const layoutPresetTier = (id: string) => specs.get(id)?.tier

const NO_RESTING: ReadonlySet<string> = new Set()

export const layoutPresetResting = (id: string): ReadonlySet<string> => {
  const resting = specs.get(id)?.resting

  return resting ? new Set(resting) : NO_RESTING
}

// The free-layout editor is retired; old saved layouts must not re-register.
writeKey('hermes.desktop.layoutPresets.v1', null)
writeKey('hermes.desktop.layoutPresets.v2', null)

/** Apply a preset's tree (deep-cloned so live edits never mutate the preset),
 *  opening what it places and resting what it says to. In Simple the mode
 *  already decides what rests, so the open/close side of a layout pick yields
 *  to it instead of surfacing shadowed panes for the session.
 *
 *  A preset registered by a plugin must not remount a baked-in session
 *  (#94260). Strip live tiles on apply; `applyTree` adopts the
 *  tiles open right now, so the user's tabs stay where they are. */
export function applyLayoutPreset(id: string, tree: LayoutNode) {
  const geometry = stripPresetLivePanes(structuredClone(tree))

  if (!geometry) {
    return
  }

  const panes = registry.getArea('panes')
  const paneFor = (paneId: string) => panes.find(pane => pane.id === paneId)
  const unified = consolidateRestoredToolPanels(geometry, paneFor, ['focus', 'quad', 'terminal-deck'].includes(id))
  asLayoutIntent(() => applyTree(unified, id, specs.get(id)?.resting))
}
