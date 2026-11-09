import { useStore } from '@nanostores/react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { registry } from '@/contrib/registry'

import { group, type GroupNode, split } from '../model'
import {
  $dismissedPanes,
  $hiddenTreePanes,
  $layoutTree,
  collapseTreePane,
  markCollapsePane,
  registerPaneCloser,
  registerPaneOpener,
  setTreeGroupMinimized,
  setTreeGroupTabStrip,
  tabStripVisibleForGroup
} from '../store'

import { TreeGroup } from './tree-group'

/**
 * A collapsed pane must leave a visible way back. Two live repros, one
 * invariant:
 *   1. #91223 — double-clicking Sessions/Bots must not hide the strip (and
 *      an explicit `never` still cannot, because hide-only chrome's only
 *      handle lives on that strip).
 *   2. Clicking the active tab of a docked tool/plugin tile must not fold
 *      the zone; if the zone *is* collapsed (chevron), the tab chip stays.
 */

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  vi.stubGlobal('CSS', { ...globalThis.CSS, escape: (value: string) => value })
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
  HTMLElement.prototype.scrollIntoView ??= () => undefined
})

const disposers: (() => void)[] = []

beforeEach(async () => {
  window.localStorage.clear()
  $dismissedPanes.set(new Set())
  $hiddenTreePanes.set(new Set())
})

afterEach(() => {
  cleanup()
  disposers.splice(0).forEach(dispose => dispose())
})

function registerPane(id: string, data: Record<string, unknown>, title = id) {
  disposers.push(registry.register({ area: 'panes', data, id, render: () => null, title }))
}

function LiveTreeGroup({ index = 0, parentAxis }: { index?: number; parentAxis: 'column' | 'row' }) {
  useStore($layoutTree)

  const node = $layoutTree.get()!
  const zone = (node.type === 'split' ? node.children[index] : node) as GroupNode

  return <TreeGroup node={zone} parentAxis={parentAxis} />
}

const tablist = () => globalThis.document.querySelector('[role="tablist"]')
const tabEl = (paneId: string) => globalThis.document.querySelector(`[data-tree-tab="${paneId}"]`)

const tap = (target: Element) => {
  fireEvent.pointerDown(target, { button: 0, clientX: 10, clientY: 10, pointerType: 'mouse' })
  fireEvent.pointerUp(window, { button: 0, clientX: 10, clientY: 10, pointerType: 'mouse' })
}

const doubleTap = (target: Element) => {
  tap(target)
  tap(target)
}

const zoneAt = (index: number) => {
  const node = $layoutTree.get()!

  return (node.type === 'split' ? node.children[index] : node) as GroupNode
}

describe('Sessions/Bots strip — #91223', () => {
  beforeEach(() => {
    registerPane('sessions', { hideOnly: true, placement: 'left' }, 'Sessions')
    registerPane('hermes-bots:pane', { hideOnly: true, placement: 'left' }, 'Bots')
    registerPane('workspace', { placement: 'main', uncloseable: true }, 'Chat')
    $layoutTree.set(
      split('row', [
        group(['sessions', 'hermes-bots:pane'], { active: 'sessions', id: 'g-side' }),
        group(['workspace'], { active: 'workspace', id: 'g-main' })
      ])
    )
  })

  it('double-clicking the Sessions tab leaves the strip and both chips', () => {
    render(<LiveTreeGroup parentAxis="row" />)

    doubleTap(tabEl('sessions')!)

    expect(tablist()).toBeTruthy()
    expect(tabEl('sessions')).toBeTruthy()
    expect(tabEl('hermes-bots:pane')).toBeTruthy()
    expect(zoneAt(0).minimized).toBeFalsy()
    expect(zoneAt(0).tabStrip).toBeUndefined()
  })

  it('tapping the strip gutter does not collapse the sidebar', () => {
    render(<LiveTreeGroup parentAxis="row" />)

    tap(globalThis.document.querySelector('[data-zone-tabstrip="g-side"]')!)

    expect(zoneAt(0).minimized).toBeFalsy()
    expect(tabEl('sessions')).toBeTruthy()
    expect(tabEl('hermes-bots:pane')).toBeTruthy()
  })

  it('does not render a duplicate minimize button in the navigation rail', () => {
    render(<LiveTreeGroup parentAxis="row" />)

    expect(globalThis.document.querySelector('[data-tree-group="g-side"] button[aria-label="Minimize"]')).toBeNull()
  })

  it('an explicit never hides the sessions/Bots strip', () => {
    setTreeGroupTabStrip('g-side', 'never')
    expect(tabStripVisibleForGroup(zoneAt(0))).toBe(false)

    render(<LiveTreeGroup parentAxis="row" />)

    expect(tablist()).toBeNull()
  })

  it('lets keyboard focus move between tabs without activating until Enter or Space', () => {
    render(<LiveTreeGroup parentAxis="row" />)
    const sessions = tabEl('sessions') as HTMLElement
    const bots = tabEl('hermes-bots:pane') as HTMLElement
    act(() => sessions.focus())

    expect(sessions.tabIndex).toBe(0)
    expect(bots.tabIndex).toBe(-1)
    fireEvent.keyDown(sessions, { key: 'ArrowRight' })
    expect(globalThis.document.activeElement).toBe(bots)
    expect(zoneAt(0).active).toBe('sessions')
    fireEvent.keyDown(bots, { key: 'Enter' })
    expect(zoneAt(0).active).toBe('hermes-bots:pane')
    expect(globalThis.document.activeElement).toBe(bots)
    fireEvent.keyDown(bots, { key: 'Home' })
    fireEvent.keyDown(sessions, { key: ' ' })
    expect(zoneAt(0).active).toBe('sessions')
    expect(globalThis.document.activeElement).toBe(sessions)
  })
})

describe('docked tool tile — collapsing keeps the restore chip', () => {
  beforeEach(() => {
    registerPane('workspace', { placement: 'main', uncloseable: true }, 'Chat')
    registerPane('hermes-bots:routines', { placement: 'main', width: '250px' }, 'Cronjobs')
    $layoutTree.set(
      split('row', [
        group(['workspace'], { active: 'workspace', id: 'g-main' }),
        group(['hermes-bots:routines'], { active: 'hermes-bots:routines', id: 'g-routines' })
      ])
    )
  })

  it('clicking the active tab does not collapse the tile or drop its label', () => {
    render(<LiveTreeGroup index={1} parentAxis="row" />)

    expect(tabEl('hermes-bots:routines')).toBeTruthy()
    tap(tabEl('hermes-bots:routines')!)

    expect(zoneAt(1).minimized).toBeFalsy()
    expect(tabEl('hermes-bots:routines')).toBeTruthy()
    expect(tabEl('hermes-bots:routines')?.textContent).toMatch(/cronjobs/i)
  })

  it('tapping the strip gutter does not collapse a lone docked tile', () => {
    render(<LiveTreeGroup index={1} parentAxis="row" />)

    tap(globalThis.document.querySelector('[data-zone-tabstrip="g-routines"]')!)

    expect(zoneAt(1).minimized).toBeFalsy()
    expect(tabEl('hermes-bots:routines')).toBeTruthy()
  })

  it('chevron-collapse of a row-docked tile keeps the tab as a restore handle', () => {
    render(<LiveTreeGroup index={1} parentAxis="row" />)

    fireEvent.click(globalThis.document.querySelector('[data-tree-group="g-routines"] button[aria-label="Minimize"]')!)

    expect(zoneAt(1).minimized).toBe(true)
    expect(tabEl('hermes-bots:routines')).toBeTruthy()
    expect(tabEl('hermes-bots:routines')?.textContent).toMatch(/cronjobs/i)
  })

  it('collapsing via the store does not dismiss the pane from the tree', () => {
    collapseTreePane('hermes-bots:routines')

    expect(zoneAt(1).minimized).toBe(true)
    expect($dismissedPanes.get().has('hermes-bots:routines')).toBe(false)
    expect(zoneAt(1).panes).toContain('hermes-bots:routines')

    render(<LiveTreeGroup index={1} parentAxis="row" />)

    expect(tabEl('hermes-bots:routines')).toBeTruthy()
  })
})

describe('conversation picker and visible tool tabs share keyboard navigation', () => {
  beforeEach(() => {
    const panes = [
      'keyboard-tool-before',
      'session-tile:keyboard-hidden-first',
      'session-tile:keyboard-current',
      'session-tile:keyboard-hidden-middle',
      'keyboard-tool-after',
      'session-tile:keyboard-hidden-last'
    ]

    panes.forEach(id => registerPane(id, { placement: 'main' }))
    $layoutTree.set(
      group(panes, { active: 'session-tile:keyboard-current', id: 'g-keyboard-mixed', tabStrip: 'always' })
    )
  })

  it('arrows and Home/End skip conversations represented only by the picker', () => {
    render(<LiveTreeGroup parentAxis="row" />)
    const current = tabEl('session-tile:keyboard-current') as HTMLElement
    const before = tabEl('keyboard-tool-before') as HTMLElement
    const after = tabEl('keyboard-tool-after') as HTMLElement
    expect(tabEl('session-tile:keyboard-hidden-middle')).toBeNull()
    expect(tabEl('session-tile:keyboard-hidden-last')).toBeNull()
    act(() => current.focus())

    fireEvent.keyDown(current, { key: 'ArrowRight' })
    expect(globalThis.document.activeElement).toBe(after)
    fireEvent.keyDown(after, { key: 'Home' })
    expect(globalThis.document.activeElement).toBe(before)
    fireEvent.keyDown(before, { key: 'End' })
    expect(globalThis.document.activeElement).toBe(after)
    fireEvent.keyDown(after, { key: 'ArrowRight' })
    expect(globalThis.document.activeElement).toBe(before)
    expect(zoneAt(0).active).toBe('session-tile:keyboard-current')
  })

  it('closing a focused tool moves focus to the next rendered tab', () => {
    render(<LiveTreeGroup parentAxis="row" />)
    const before = tabEl('keyboard-tool-before') as HTMLElement
    act(() => before.focus())

    fireEvent.keyDown(before, { key: 'Delete' })

    expect(tabEl('keyboard-tool-before')).toBeNull()
    expect(tabEl('session-tile:keyboard-hidden-first')).toBeNull()
    expect(globalThis.document.activeElement).toBe(tabEl('session-tile:keyboard-current'))
  })

  it('keeps every conversation reachable in the collapsed rail and focuses the restored title', () => {
    setTreeGroupMinimized('g-keyboard-mixed', true)
    render(<LiveTreeGroup parentAxis="row" />)
    const current = tabEl('session-tile:keyboard-current') as HTMLElement
    const next = tabEl('session-tile:keyboard-hidden-middle') as HTMLElement
    act(() => current.focus())

    fireEvent.keyDown(current, { key: 'ArrowDown' })
    expect(globalThis.document.activeElement).toBe(next)
    fireEvent.keyDown(next, { key: 'Enter' })

    expect(zoneAt(0).minimized).toBeFalsy()
    expect(zoneAt(0).active).toBe('session-tile:keyboard-hidden-middle')
    expect(tabEl('session-tile:keyboard-current')).toBeNull()
    expect(globalThis.document.activeElement).toBe(tabEl('session-tile:keyboard-hidden-middle'))
  })
})

describe('tool-panel tab activation', () => {
  it('reopens a visible tool tab through its owner when the owner is off', () => {
    const paneId = 'terminal-activation-test'
    let ownerOpen = false

    registerPane(paneId, { placement: 'bottom' }, 'Terminal')
    markCollapsePane(paneId)
    registerPaneOpener(paneId, () => {
      ownerOpen = true
    })
    $layoutTree.set(group([paneId], { active: paneId, id: 'g-terminal-activation-test' }))

    render(<LiveTreeGroup parentAxis="column" />)

    const tab = tabEl(paneId)
    expect(tab).toBeTruthy()
    expect(ownerOpen).toBe(false)

    tap(tab!)

    expect(ownerOpen).toBe(true)
  })
})

describe('a stacked tool zone collapsed in a row keeps a vertical restore rail', () => {
  beforeEach(() => {
    registerPane('workspace', { placement: 'main', uncloseable: true }, 'Chat')
    registerPane('terminal', { placement: 'bottom' }, 'Terminal')
    registerPane('logs', { placement: 'bottom' }, 'Logs')
    markCollapsePane('terminal')
    markCollapsePane('logs')
    registerPaneCloser('terminal', () => undefined)
    registerPaneCloser('logs', () => undefined)
    $layoutTree.set(
      split('row', [
        group(['workspace'], { active: 'workspace', id: 'g-main' }),
        group(['terminal', 'logs'], { active: 'terminal', id: 'g-tools' })
      ])
    )
  })

  it('keeps both tab labels after minimize so either pane can be restored', () => {
    setTreeGroupMinimized('g-tools', true)
    render(<LiveTreeGroup index={1} parentAxis="row" />)

    expect(tabEl('terminal')).toBeTruthy()
    expect(tabEl('logs')).toBeTruthy()
    expect(tabEl('terminal')?.getAttribute('data-vertical')).toBe('true')
    expect(tabEl('logs')?.getAttribute('data-vertical')).toBe('true')
  })

  it('uses vertical arrows and restores the matching keyboard tab without losing focus', () => {
    setTreeGroupMinimized('g-tools', true)
    render(<LiveTreeGroup index={1} parentAxis="row" />)
    const terminal = tabEl('terminal') as HTMLElement
    const logs = tabEl('logs') as HTMLElement
    act(() => terminal.focus())

    expect(tablist()?.getAttribute('aria-orientation')).toBe('vertical')
    expect(fireEvent.keyDown(terminal, { key: 'ArrowRight' })).toBe(true)
    fireEvent.keyDown(terminal, { key: 'ArrowDown' })
    expect(globalThis.document.activeElement).toBe(logs)
    expect(zoneAt(1).minimized).toBe(true)
    fireEvent.keyDown(logs, { key: 'Enter' })

    expect(zoneAt(1).minimized).toBeFalsy()
    expect(zoneAt(1).active).toBe('logs')
    expect(tablist()?.getAttribute('aria-orientation')).toBe('horizontal')
    expect(globalThis.document.activeElement).toBe(tabEl('logs'))
  })
})
