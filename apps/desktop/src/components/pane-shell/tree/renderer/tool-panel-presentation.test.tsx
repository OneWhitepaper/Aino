import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { registry } from '@/contrib/registry'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

import { $layoutEditMode } from '../../edit-mode'
import { group, split } from '../model'
import { $hiddenTreePanes, $layoutTree, $narrowViewport, restoreTreePane } from '../store'

import { KeepAlivePanes } from './keep-alive-panes'
import { NarrowOverlays } from './narrow-overlays'
import { fixedTrackSize, MINIMIZED_TRACK, subtreeGone, type TrackContext } from './track-model'
import { TreeGroup } from './tree-group'
import { TreeNode } from './tree-node'

const disposers: (() => void)[] = []

beforeEach(() => {
  stubMenuDomApis()
  stubResizeObserver()
  vi.stubGlobal('CSS', { ...globalThis.CSS, escape: (value: string) => value })
  $hiddenTreePanes.set(new Set())
  $narrowViewport.set(false)
  $layoutEditMode.set(false)

  for (const id of ['review', 'terminal', 'files']) {
    disposers.push(
      registry.register({
        area: 'panes',
        data: { toolPanel: true, placement: 'right', width: '432px' },
        id,
        title: id,
        render: () => <div>{id} contents</div>
      })
    )
  }

  disposers.push(
    registry.register({
      area: 'panes',
      data: { placement: 'main', uncloseable: true },
      id: 'workspace',
      title: 'Chat',
      render: () => <div>Chat contents</div>
    }),
    registry.register({ area: 'panes', id: 'plugin:inspector', title: 'Plugin', render: () => <div>Plugin</div> })
  )
})

afterEach(() => {
  cleanup()
  $layoutTree.set(null)
  $layoutEditMode.set(false)
  disposers.splice(0).forEach(dispose => dispose())
  vi.unstubAllGlobals()
})

const context = (): TrackContext => ({
  paneFor: id => registry.getArea('panes').find(pane => pane.id === id),
  paneGone: () => false,
  overrides: {}
})

describe('safe tool-only groups restored without presentation metadata', () => {
  it.each([['review'], ['terminal'], ['files', 'review', 'terminal']])(
    'uses the shared horizontal panel controls for %j',
    (...panes) => {
      const node = group(panes, { id: 'legacy-tools', active: panes[0], tabStrip: 'never' })
      $layoutTree.set(node)
      const { container } = render(<TreeGroup node={node} parentAxis="row" />)

      for (const id of panes) {
        expect(container.querySelector('[data-tree-tab="' + id + '"]')).not.toBeNull()
      }

      expect(screen.getByRole('button', { name: 'Maximize panel' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Hide panel' })).toBeTruthy()
      expect(container.querySelector('[data-vertical="true"]')).toBeNull()
      expect(node.toolPanel).toBeUndefined()
    }
  )

  it.each([['review'], ['terminal'], ['files', 'review', 'terminal']])(
    'fully hides minimized tools %j without reserving a restore rail',
    (...panes) => {
      const node = group(panes, { id: 'legacy-tools', minimized: true })

      expect(fixedTrackSize(node, 'row', context())).toBe('0px')
      expect(fixedTrackSize(node, 'column', context())).toBe('0px')
      expect(subtreeGone(node, context())).toBe(true)
      expect(subtreeGone(split('row', [node]), context())).toBe(true)
    }
  )

  it.each([
    ['review', 'workspace'],
    ['review', 'plugin:inspector'],
    ['review', 'missing-plugin']
  ])('keeps the existing restore track for mixed or unknown group %j', (...panes) => {
    const node = group(panes, { id: 'custom-group', minimized: true })

    expect(fixedTrackSize(node, 'row', context())).toBe(MINIMIZED_TRACK)
    expect(subtreeGone(node, context())).toBe(false)
  })

  it('retains the user-sized expanded track without persisting new metadata', () => {
    const node = group(['review'], { id: 'legacy-tools' })
    const ctx = { ...context(), overrides: { review: { widthOverride: 516 } } }

    expect(fixedTrackSize(node, 'row', ctx)).toBe('516px')
    expect(node.toolPanel).toBeUndefined()
  })

  it('keeps a saved tool host tabbed when a bot-only tab unregisters and registers again', () => {
    const registerSchedule = () =>
      registry.register({
        area: 'panes',
        id: 'hermes-bots:routines',
        title: 'Scheduled jobs',
        data: { toolPanel: true, placement: 'right' },
        render: () => <div>Bot schedules</div>
      })

    const unregisterSchedule = registerSchedule()
    const node = group(['files', 'hermes-bots:routines'], { id: 'bot-tools', toolPanel: true })
    $layoutTree.set(node)
    const view = render(<TreeGroup node={node} parentAxis="row" />)
    expect(screen.getByRole('tab', { name: 'Scheduled jobs' })).toBeTruthy()

    act(() => unregisterSchedule())
    expect(screen.queryByRole('tab', { name: 'Scheduled jobs' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Hide panel' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Maximize panel' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hide panel' }))
    const hidden = $layoutTree.get()!
    expect(fixedTrackSize(hidden, 'row', context())).toBe('0px')
    expect(subtreeGone(hidden, context())).toBe(true)

    if (hidden.type !== 'group') {
      throw new Error('Expected tool group')
    }

    view.rerender(<TreeGroup node={hidden} parentAxis="row" />)
    expect(view.container.querySelector('[data-vertical="true"]')).toBeNull()

    act(() => restoreTreePane('files'))
    const restored = $layoutTree.get()!

    if (restored.type !== 'group') {
      throw new Error('Expected tool group')
    }

    view.rerender(<TreeGroup node={restored} parentAxis="row" />)
    act(() => {
      disposers.push(registerSchedule())
    })
    expect(screen.getByRole('tab', { name: 'Scheduled jobs' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hide panel' })).toBeTruthy()
    expect(restored.panes).toEqual(['files', 'hermes-bots:routines'])
  })

  it.each([true, undefined])('restores saved tool chrome before its bot tab registers (marked: %s)', toolPanel => {
    const node = group(['files', 'hermes-bots:routines'], { id: 'saved-tools', toolPanel, minimized: true })
    $layoutTree.set(node)
    const { container } = render(<TreeGroup node={node} parentAxis="row" />)

    expect(fixedTrackSize(node, 'row', context())).toBe('0px')
    expect(subtreeGone(node, context())).toBe(true)
    expect(container.querySelector('[data-vertical="true"]')).toBeNull()

    const workspace = group(['files', 'workspace'], { toolPanel: true, minimized: true })
    const inspector = group(['files', 'plugin:inspector'], { toolPanel: true, minimized: true })
    const unknown = group(['files', 'missing-plugin'], { toolPanel: true, minimized: true })

    for (const mixed of [workspace, inspector, unknown]) {
      expect(fixedTrackSize(mixed, 'row', context())).toBe(MINIMIZED_TRACK)
      expect(subtreeGone(mixed, context())).toBe(false)
    }
  })

  it.each([{ placement: 'main' }, { toolPanel: true, uncloseable: true }])(
    'lets a live contribution override the dormant tool identity: %j',
    data => {
      disposers.push(
        registry.register({
          area: 'panes',
          id: 'hermes-bots:routines',
          data,
          render: () => <div>Protected guest</div>
        })
      )
      const node = group(['files', 'hermes-bots:routines'], { toolPanel: true, minimized: true })

      expect(fixedTrackSize(node, 'row', context())).toBe(MINIMIZED_TRACK)
      expect(subtreeGone(node, context())).toBe(false)
    }
  )

  it('offers panel Hide instead of a nonfunctional Hide tabs menu command', () => {
    const node = group(['review'], { id: 'legacy-tools' })
    $layoutTree.set(node)
    const { container } = render(<TreeGroup node={node} parentAxis="row" />)
    const tab = container.querySelector<HTMLElement>('[data-tree-tab="review"]')!

    fireEvent.pointerDown(tab, { button: 2, pointerType: 'mouse' })
    fireEvent.contextMenu(tab, { button: 2 })

    expect(screen.queryByRole('menuitem', { name: /(?:show|hide) tabs/i })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Hide panel' })).toBeTruthy()
  })

  it('retains the tab-strip configuration command in layout edit mode', () => {
    $layoutEditMode.set(true)
    const node = group(['review'], { id: 'legacy-tools' })
    $layoutTree.set(node)
    const { container } = render(<TreeGroup node={node} parentAxis="row" />)
    const tab = container.querySelector<HTMLElement>('[data-tree-tab="review"]')!

    fireEvent.pointerDown(tab, { button: 2, pointerType: 'mouse' })
    fireEvent.contextMenu(tab, { button: 2 })

    expect(screen.getByRole('menuitem', { name: /hide tabs/i })).toBeTruthy()
  })

  it('hides and restores a live tool guest without losing its state or sized track', () => {
    disposers.push(
      registry.register({
        area: 'panes',
        id: 'live-tool',
        title: 'Live tool',
        data: { toolPanel: true, lifecycleKeepAlive: true, width: '432px' },
        render: () => <input aria-label="Tool draft" defaultValue="Keep this state" />
      })
    )
    const node = group(['live-tool'], { id: 'legacy-live-tool' })
    $layoutTree.set(node)
    const view = render(<TreeGroup node={node} parentAxis="row" />)
    const draft = screen.getByRole('textbox', { name: 'Tool draft' }) as HTMLInputElement
    fireEvent.change(draft, { target: { value: 'Edited before hiding' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hide panel' }))
    const hidden = $layoutTree.get()!
    expect(hidden.type === 'group' && hidden.minimized).toBe(true)
    expect(subtreeGone(hidden, context())).toBe(true)

    if (hidden.type !== 'group') {
      throw new Error('Expected tool group')
    }

    view.rerender(<TreeGroup node={hidden} parentAxis="row" />)
    expect(draft.isConnected).toBe(true)
    expect(draft.closest('[data-pane-hidden]')).not.toBeNull()

    act(() => restoreTreePane('live-tool'))
    const restored = $layoutTree.get()!

    if (restored.type !== 'group') {
      throw new Error('Expected tool group')
    }

    view.rerender(<TreeGroup node={restored} parentAxis="row" />)
    expect(screen.getByRole('textbox', { name: 'Tool draft' })).toBe(draft)
    expect(draft.value).toBe('Edited before hiding')
    expect(fixedTrackSize(restored, 'row', context())).toBe('432px')
  })

  it('gives a narrow tool group one overlay owner while preserving a live resource instance', () => {
    disposers.push(
      registry.register({
        area: 'panes',
        id: 'live-terminal',
        title: 'Live terminal',
        data: { toolPanel: true, lifecycleKeepAlive: true, width: '432px' },
        render: () => <input aria-label="Live terminal draft" defaultValue="Unsubmitted command" />
      })
    )

    const node = split('row', [
      group(['workspace']),
      group(['files', 'live-terminal'], { id: 'safe-tools', active: 'live-terminal' })
    ])

    $layoutTree.set(node)

    const view = render(
      <KeepAlivePanes>
        <TreeNode node={node} root rootRow />
        <NarrowOverlays />
      </KeepAlivePanes>
    )

    const draft = screen.getByRole('textbox', { name: 'Live terminal draft' }) as HTMLInputElement
    fireEvent.change(draft, { target: { value: 'Keep shell state' } })
    act(() => $narrowViewport.set(true))
    const track = view.container.querySelector<HTMLElement>('[data-tree-track="safe-tools"]')!

    expect(track.style.display).toBe('none')
    act(() =>
      window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: 'live-terminal', mode: 'open' } }))
    )
    expect(view.container.querySelector('[data-narrow-overlay="live-terminal"]')).not.toBeNull()
    expect(screen.getAllByRole('textbox', { name: 'Live terminal draft' })).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: 'Live terminal draft' })).toBe(draft)
    expect(draft.value).toBe('Keep shell state')
  })
})
