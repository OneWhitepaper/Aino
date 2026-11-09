import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { $workspaceIsPage } from '@/app/routes'
import {
  findGroupOfPane,
  group,
  migratePersistedTree,
  setGroupMinimized,
  split
} from '@/components/pane-shell/tree/model'
import { groupTabActions } from '@/components/pane-shell/tree/renderer/group-tab-actions'
import {
  $collapsedTreeSides,
  $dismissedPanes,
  $hiddenTreePanes,
  $layoutTree,
  $paneVisible,
  collapseTreePane,
  setTreeGroupMinimized
} from '@/components/pane-shell/tree/store'
import { workspaceShownPaneIds } from '@/components/pane-shell/tree/workspace-presentation'
import { resetRememberedActivePanes, setWorkspaceScope } from '@/components/pane-shell/workspace-scope'
import { registry } from '@/contrib/registry'

import { switchWorkspaceScope } from './workspace-navigation'

import { host } from './index'

const disposers: (() => void)[] = []
const first = 'session-tile:hub-repro-a'
const second = 'session-tile:hub-repro-b'

beforeEach(() => {
  vi.useFakeTimers()
  $workspaceIsPage.set(false)
  $hiddenTreePanes.set(new Set())
  $dismissedPanes.set(new Set())
  $collapsedTreeSides.set(new Set())
  setWorkspaceScope('sessions')

  for (const [id, data] of [
    ['workspace', { placement: 'main', uncloseable: true }],
    ['hermes-bots:pane', { placement: 'left', width: '245px', hideOnly: true }],
    [first, { placement: 'main', workspaceScope: { mode: 'bots', ownerKey: 'hub-a' } }],
    [second, { placement: 'main', workspaceScope: { mode: 'bots', ownerKey: 'hub-b' } }],
    ['hub-repro-tool', { placement: 'right', width: '20rem' }]
  ] as const) {
    disposers.push(registry.register({ area: 'panes', id, data, title: id, render: () => null }))
  }

  $layoutTree.set(
    split('row', [
      group(['hermes-bots:pane'], { id: 'nav', active: 'hermes-bots:pane' }),
      group(['workspace', first, second], { id: 'main', active: first }),
      group(['hub-repro-tool'], { id: 'tools', active: 'hub-repro-tool' })
    ])
  )
  setWorkspaceScope('bots', 'hub-a')
  vi.runOnlyPendingTimers()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  disposers
    .splice(0)
    .reverse()
    .forEach(dispose => dispose())
  $layoutTree.set(null)
  $collapsedTreeSides.set(new Set())
  $workspaceIsPage.set(false)
  setWorkspaceScope('sessions')
  resetRememberedActivePanes()
})

it('keeps the primary workspace group protected from minimize after bot filtering', () => {
  const node = findGroupOfPane($layoutTree.get()!, first)!
  const shown = workspaceShownPaneIds(node.panes)
  expect(shown).toEqual([first])

  const actions = groupTabActions({
    node,
    shown,
    toolPanel: false,
    panesWithCloser: new Set(),
    paneFor: id => registry.getArea('panes').find(pane => pane.id === id)
  })

  expect(actions.minimizable).toBe(false)
  expect(actions.showMinimizeButton).toBe(false)
})

it.each([
  ['pane collapse', () => collapseTreePane(first)],
  ['zone minimize', () => setTreeGroupMinimized('main', true)]
] as const)('keeps the main zone visible through %s while independent tools still collapse', (_name, minimize) => {
  $collapsedTreeSides.set(new Set(['right']))
  minimize()
  expect(findGroupOfPane($layoutTree.get()!, first)?.minimized).toBeFalsy()
  expect($paneVisible(first).get()).toBe(true)
  collapseTreePane('hub-repro-tool')
  expect(findGroupOfPane($layoutTree.get()!, 'hub-repro-tool')?.minimized).toBe(true)
  expect($collapsedTreeSides.get()).toEqual(new Set(['right']))
})

it('recovers only the persisted primary workspace group without changing its layout or side groups', () => {
  const navigation = group(['hermes-bots:pane'], { id: 'nav', active: 'hermes-bots:pane', tabStrip: 'never' })
  const main = group(['workspace', first, second], { id: 'main', active: first, minimized: true, tabStrip: 'always' })
  const tools = group(['hub-repro-tool'], { id: 'tools', active: 'hub-repro-tool', minimized: true, tabStrip: 'never' })
  const persisted = split('row', [navigation, split('column', [main, tools], [3, 2], 'center')], [2, 7], 'root')
  $collapsedTreeSides.set(new Set(['right']))

  const restored = migratePersistedTree(persisted)

  expect(findGroupOfPane(restored, 'workspace')?.minimized).toBeFalsy()
  expect(findGroupOfPane(restored, 'workspace')).toMatchObject({
    active: first,
    panes: ['workspace', first, second],
    tabStrip: 'always'
  })
  expect(findGroupOfPane(restored, 'hermes-bots:pane')).toEqual(navigation)
  expect(findGroupOfPane(restored, 'hub-repro-tool')).toEqual(tools)
  expect(restored).toMatchObject({ weights: [2, 7], children: [{ id: 'nav' }, { weights: [3, 2] }] })
  expect($collapsedTreeSides.get()).toEqual(new Set(['right']))
})

it('restores a minimized main zone on explicit group open', () => {
  $layoutTree.set(setGroupMinimized($layoutTree.get()!, 'main', true))
  disposers.push(
    host.openWorkspace('hub-repro-group', {
      title: 'Group',
      tabPresentation: 'conversation',
      workspaceScope: { mode: 'bots', ownerKey: 'hub-a' },
      render: () => null
    })
  )
  vi.runOnlyPendingTimers()
  expect(findGroupOfPane($layoutTree.get()!, 'plugin-workspace:hub-repro-group')?.minimized).toBe(false)
  expect($paneVisible('plugin-workspace:hub-repro-group').get()).toBe(true)
})

it('restores a minimized main zone when returning to Sessions', () => {
  $layoutTree.set(setGroupMinimized($layoutTree.get()!, 'main', true))
  switchWorkspaceScope('sessions')
  vi.runOnlyPendingTimers()
  expect(findGroupOfPane($layoutTree.get()!, 'workspace')).toMatchObject({ active: 'workspace', minimized: false })
  expect($paneVisible('workspace').get()).toBe(true)
})
