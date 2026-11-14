import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { registry } from '@/contrib/registry'
import { stubResizeObserver } from '@/test/jsdom'

import { findGroupOfPane, group, split } from '../model'
import { $dropHint, $layoutTree, $treeDragging } from '../store'

import { startPaneDrag } from './drag-session'
import { TreeGroup } from './tree-group'

const cleanups: Array<() => void> = []

const rect = (left: number, right: number, top = 0, bottom = 400) =>
  ({ left, right, top, bottom, width: right - left, height: bottom - top }) as DOMRect

beforeEach(() => {
  stubResizeObserver()
  vi.stubGlobal('CSS', { ...globalThis.CSS, escape: (value: string) => value })
  vi.stubGlobal('PointerEvent', MouseEvent)

  for (const [id, data] of [
    ['sessions', { placement: 'left', hideOnly: true }],
    ['workspace', { placement: 'main', uncloseable: true }],
    ['files', { placement: 'right', toolPanel: true }],
    ['terminal', { placement: 'right', toolPanel: true }]
  ] as const) {
    cleanups.push(registry.register({ area: 'panes', id, data, title: id, render: () => <div>{id}</div> }))
  }
})

afterEach(() => {
  cleanup()
  window.dispatchEvent(new Event('pointercancel'))
  cleanups.splice(0).forEach(cleanup => cleanup())
  $layoutTree.set(null)
  $treeDragging.set(null)
  $dropHint.set(null)
  globalThis.document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function dragEvent(source: HTMLElement) {
  return {
    button: 0,
    clientX: 10,
    clientY: 10,
    pointerId: 1,
    currentTarget: source,
    preventDefault() {},
    stopPropagation() {}
  } as unknown as ReactPointerEvent<HTMLElement>
}

function finishAt(x: number, y: number, shiftKey = false) {
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, shiftKey, bubbles: true }))
  window.dispatchEvent(new MouseEvent('pointerup', { clientX: x, clientY: y, shiftKey, bubbles: true }))
}

function mountTargets() {
  const tree = split('row', [
    group(['sessions'], { id: 'nav' }),
    group(['workspace'], { id: 'main' }),
    group(['files', 'terminal'], { id: 'tools', tabStrip: 'always', toolPanel: true })
  ])

  $layoutTree.set(tree)
  globalThis.document.body.innerHTML =
    '<div data-tree-group="nav"></div><div data-tree-group="main"></div>' +
    '<div data-tree-group="tools"><div data-zone-tabstrip="tools"><span data-tree-tab="files"></span><span data-tree-tab="terminal"></span></div></div>'
  const targets = [...globalThis.document.querySelectorAll<HTMLElement>('[data-tree-group]')]
  targets.forEach((target, index) => {
    target.getBoundingClientRect = () => rect(index * 200, (index + 1) * 200)
  })
  const strip = globalThis.document.querySelector<HTMLElement>('[data-zone-tabstrip]')!
  strip.getBoundingClientRect = () => rect(400, 600, 0, 28)
  const tabs = [...strip.querySelectorAll<HTMLElement>('[data-tree-tab]')]
  tabs.forEach((tab, index) => {
    tab.getBoundingClientRect = () => rect(400 + index * 100, 500 + index * 100, 0, 28)
  })

  return { tree, strip, tabs }
}

it('keeps navigation and the primary workspace fixed while ordinary file tabs still reorder', () => {
  const { tree, strip, tabs } = mountTargets()

  for (const id of ['sessions', 'workspace']) {
    startPaneDrag(id, dragEvent(strip))
    finishAt(500, 200)
    expect($layoutTree.get()).toBe(tree)
  }

  startPaneDrag('files', dragEvent(tabs[0]), undefined, { groupId: 'tools', strip })
  finishAt(590, 14)
  expect(findGroupOfPane($layoutTree.get()!, 'files')?.panes).toEqual(['terminal', 'files'])
})

it('does not move a file tab into standing navigation', () => {
  const { tree, strip, tabs } = mountTargets()
  startPaneDrag('files', dragEvent(tabs[0]), undefined, { groupId: 'tools', strip })
  finishAt(80, 200)
  expect($layoutTree.get()).toBe(tree)
})

it('keeps neighboring conversation and tool zones separate when Shift is held during a file-tab drop', () => {
  const { strip, tabs } = mountTargets()
  $layoutTree.set(
    split('row', [
      group(['sessions'], { id: 'nav' }),
      split('row', [group(['workspace'], { id: 'main' }), group(['files', 'terminal'], { id: 'tools' })])
    ])
  )
  startPaneDrag('files', dragEvent(tabs[0]), undefined, { groupId: 'tools', strip })
  finishAt(400, 200, true)
  const tree = $layoutTree.get()!
  expect(findGroupOfPane(tree, 'workspace')?.id).toBe('main')
  expect(findGroupOfPane(tree, 'terminal')?.id).toBe('tools')
  expect(findGroupOfPane(tree, 'sessions')?.id).toBe('nav')
})

it('does not start a layout drag from empty panel header space or paint idle full-zone sheets', async () => {
  const node = group(['files', 'terminal'], { id: 'tools', tabStrip: 'always', toolPanel: true })
  $layoutTree.set(node)

  const { container } = render(
    <MemoryRouter>
      <TreeGroup node={node} />
    </MemoryRouter>
  )

  const strip = container.querySelector<HTMLElement>('[data-zone-tabstrip]')!
  fireEvent.pointerDown(strip, { button: 0, clientX: 0, clientY: 0 })
  await act(async () => {
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 200, bubbles: true }))
    await new Promise(requestAnimationFrame)
  })
  expect($treeDragging.get()).toBeNull()
  act(() => window.dispatchEvent(new Event('pointerup')))
  expect($layoutTree.get()).toBe(node)
  expect(globalThis.document.body.style.userSelect).not.toBe('none')
  act(() => {
    $treeDragging.set('other-file')
  })
  expect(container.querySelector('.pointer-events-none.absolute.inset-0.z-40')).toBeNull()
  act(() => {
    $dropHint.set({ kind: 'group', groupId: 'tools', groupIds: ['tools'], pos: 'center' })
  })
  expect(container.querySelector('.pointer-events-none.absolute.inset-0.z-40')).not.toBeNull()
})
