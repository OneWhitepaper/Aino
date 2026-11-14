import { beforeEach, describe, expect, it, vi } from 'vitest'

import { allPaneIds, group, split } from './model'

// Contributions carry geometry; live session tabs belong to their own stores.
// Older builds also stored user presets, which must no longer join the registry.

const USER_KEY = 'hermes.desktop.layoutPresets.v2'
const LEGACY_USER_KEY = 'hermes.desktop.layoutPresets.v1'

const LIVE_TILE = 'session-tile:20260823_233759_0fc103'
const FOREIGN_TILE = 'session-tile:20260823_193634_728a24'
const OTHER_FOREIGN_TILE = 'session-tile:20260823_193532_a7dbd9'

/** The shape `user-jrl` had in the field report: live tiles cloned into a
 *  saved deck, two of them from named profiles. */
function dirtyDeck() {
  return split(
    'row',
    [
      group(['sessions', 'preview'], { active: 'sessions', id: 'grp-sessions' }),
      group(['workspace', FOREIGN_TILE, OTHER_FOREIGN_TILE], { active: FOREIGN_TILE, id: 'grp-main' }),
      group(['preview-tile:undefined', 'route-tile:skills'], { active: 'preview-tile:undefined', id: 'grp-ghost' })
    ],
    [1, 3.4, 1],
    'spl-root'
  )
}

beforeEach(() => {
  window.localStorage.clear()
  vi.resetModules()
})

describe('retired user layout presets', () => {
  it('discards old presets without registering or applying them to the live layout', async () => {
    const saved = JSON.stringify({ 'user-jrl': { name: 'JRL', tree: dirtyDeck() } })
    window.localStorage.setItem(LEGACY_USER_KEY, saved)
    window.localStorage.setItem(USER_KEY, saved)
    const { $layoutTree } = await import('./store')
    const live = group(['workspace', LIVE_TILE], { active: LIVE_TILE, id: 'grp-live' })
    $layoutTree.set(live)

    await import('./presets')
    const { registry } = await import('@/contrib/registry')

    expect(registry.getArea('layouts')).toEqual([])
    expect($layoutTree.get()).toBe(live)
    expect(window.localStorage.getItem(LEGACY_USER_KEY)).toBeNull()
    expect(window.localStorage.getItem(USER_KEY)).toBeNull()
  })

  it('does not revive old presets when machine preferences hydrate', async () => {
    const { hydrateFromSnapshot } = await import('@/lib/ui-preferences/sync')

    hydrateFromSnapshot({
      exists: true,
      revision: 1,
      values: {
        [USER_KEY]: JSON.stringify({ 'user-jrl': { name: 'JRL', tree: dirtyDeck() } }),
        'hermes-desktop-mode-v1': 'dark'
      }
    })

    expect(window.localStorage.getItem(USER_KEY)).toBeNull()
    expect(window.localStorage.getItem('hermes-desktop-mode-v1')).toBe('dark')
  })
})

describe('contributed layout presets stay geometry-only (#94260)', () => {
  it('applies a dirty snapshot without resurrecting its baked-in tiles', async () => {
    const { $layoutTree } = await import('./store')
    const { applyLayoutPreset } = await import('./presets')
    $layoutTree.set(group(['workspace', LIVE_TILE], { active: 'workspace', id: 'grp-live' }))

    applyLayoutPreset('plugin-deck', dirtyDeck())

    const ids = allPaneIds($layoutTree.get()!)

    // Nothing from the snapshot's tiles comes back…
    expect(ids).not.toContain(FOREIGN_TILE)
    expect(ids).not.toContain(OTHER_FOREIGN_TILE)
    expect(ids).not.toContain('preview-tile:undefined')
    expect(ids).not.toContain('route-tile:skills')
    // …the preset's geometry does…
    expect(ids).toContain('sessions')
    // …and the tile that was ALREADY open is adopted, so no tab is lost.
    expect(ids).toContain(LIVE_TILE)
  })

  it('leaves the live layout alone when a preset is only a tile snapshot', async () => {
    const { $layoutTree } = await import('./store')
    const { applyLayoutPreset } = await import('./presets')
    const live = group(['workspace'], { active: 'workspace', id: 'grp-live' })

    $layoutTree.set(live)
    applyLayoutPreset('plugin-tiles-only', group([FOREIGN_TILE, 'preview-tile:undefined'], { id: 'only-tiles' }))

    expect($layoutTree.get()).toBe(live)
  })
})
