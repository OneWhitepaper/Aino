import { beforeAll, describe, expect, it, vi } from 'vitest'

import { $terminalTakeover, setTerminalTakeover } from '@/app/right-sidebar/store'
import { $activeTerminalId, $terminals } from '@/app/right-sidebar/terminal/terminals'
import {
  allPaneIds,
  findGroupOfPane,
  findParentSplit,
  group,
  type LayoutNode,
  split
} from '@/components/pane-shell/tree/model'
import {
  $hiddenTreePanes,
  $layoutTree,
  $userPlacedPanes,
  isPaneVisible,
  markActivePreset,
  togglePaneVisible
} from '@/components/pane-shell/tree/store'
import { registry } from '@/contrib/registry'

// Plugin discovery and the rendered app are not needed to exercise the real
// core pane registration, layout and visibility bindings.
vi.mock('@/contrib/plugins', () => ({ discoverBundledPlugins: () => undefined }))
vi.mock('@/contrib/runtime-loader', () => ({ discoverRuntimePlugins: () => undefined }))
vi.mock('./wiring', () => ({ ContribWiring: () => null, WiredPane: () => null }))

beforeAll(async () => {
  markActivePreset('custom')
  $userPlacedPanes.set(new Set(['terminal', 'sessions']))
  $layoutTree.set(
    split('row', [
      group(['sessions', 'hermes-bots:pane', 'terminal'], {
        id: 'saved-navigation',
        active: 'terminal',
        tabStrip: 'always'
      }),
      group(['workspace']),
      split('row', [group(['review']), group(['files'])])
    ])
  )
  await import('./controller')
}, 30_000)

describe('terminal workspace integration', () => {
  it('docks below the chat without taking height from navigation or the right panes', () => {
    const defaultTree = registry.getArea('layouts').find(layout => layout.id === 'default')!.data as LayoutNode

    for (const tree of [defaultTree, $layoutTree.get()!]) {
      const terminal = findGroupOfPane(tree, 'terminal')!
      const parent = findParentSplit(tree, terminal.id)!

      expect(parent.orientation).toBe('column')
      expect(allPaneIds(parent)).toContain('workspace')
      expect(allPaneIds(parent)).not.toContain('sessions')
      expect(allPaneIds(parent)).not.toContain('files')
      expect(allPaneIds(parent.children.at(-1)!)).toContain('terminal')
      expect(allPaneIds(tree)).toEqual(expect.arrayContaining(['files', 'review', 'sessions', 'terminal', 'workspace']))
    }

    expect(findGroupOfPane($layoutTree.get()!, 'sessions')).toMatchObject({
      id: 'saved-navigation',
      active: 'sessions',
      panes: ['sessions', 'hermes-bots:pane'],
      tabStrip: 'always'
    })
    const terminalContribution = registry.getArea('panes').find(pane => pane.id === 'terminal')
    expect(terminalContribution?.data).toMatchObject({ lifecycleKeepAlive: true, selfManagedTabs: true })
  })

  it('fully hides its panel without closing shells, then restores a minimized or stacked terminal', () => {
    $layoutTree.set(
      split('column', [group(['workspace']), group(['terminal', 'logs'], { active: 'logs', minimized: true })])
    )
    const tabs = [{ auto: true, cwd: '/project', id: 'live', kind: 'user' as const, title: 'zsh' }]
    $terminals.set(tabs)
    $activeTerminalId.set('live')

    setTerminalTakeover(true)
    expect(isPaneVisible('terminal')).toBe(true)
    togglePaneVisible('terminal')
    expect($terminalTakeover.get()).toBe(false)
    expect($hiddenTreePanes.get().has('terminal')).toBe(true)
    expect($terminals.get()).toBe(tabs)
    togglePaneVisible('terminal')
    expect(isPaneVisible('terminal')).toBe(true)
    expect($activeTerminalId.get()).toBe('live')

    setTerminalTakeover(false)
    $terminals.set([])
    $activeTerminalId.set(null)
  })
})
