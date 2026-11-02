import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { $workspaceIsPage } from '@/app/routes'
import { registry } from '@/contrib/registry'
import { $paneStates } from '@/store/panes'

import { group, split } from '../model'
import { $collapsedTreeSides, $hiddenTreePanes, $layoutTree, $narrowViewport } from '../store'

import { KeepAlivePanes } from './keep-alive-panes'
import { TreeNode } from './tree-node'

const disposers: (() => void)[] = []
const unmounted = vi.fn()
const mounts = vi.fn()

function CachedPane({ id }: { id: string }) {
  useEffect(() => {
    mounts(id)
  }, [id])

  return <div data-testid={`body-${id}`}>{id}</div>
}

function Preview() {
  useEffect(() => () => unmounted(), [])

  return <textarea aria-label="Unsaved file" defaultValue="Original document" />
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  )
  vi.stubGlobal('CSS', { ...globalThis.CSS, escape: (value: string) => value })
  $workspaceIsPage.set(false)
  $collapsedTreeSides.set(new Set())
  $hiddenTreePanes.set(new Set())
  $narrowViewport.set(false)
  $paneStates.set({})
  unmounted.mockClear()
  mounts.mockClear()
  disposers.push(
    registry.register({
      area: 'panes',
      id: 'workspace',
      title: 'Workspace',
      data: { placement: 'main' },
      render: () => <main>Page contents</main>
    }),
    registry.register({
      area: 'panes',
      id: 'sessions',
      title: 'Navigation',
      data: { placement: 'left', width: '260px' },
      render: () => <nav>Navigation</nav>
    }),
    registry.register({
      area: 'panes',
      id: 'hermes-bots:pane',
      title: 'Agent Hub',
      data: { placement: 'left' },
      render: () => <div>Bot roster</div>
    }),
    registry.register({
      area: 'panes',
      id: 'preview-tile:readme',
      title: 'README.md',
      data: { placement: 'main' },
      render: Preview
    })
  )
})

afterEach(() => {
  cleanup()
  $workspaceIsPage.set(false)
  $layoutTree.set(null)
  $paneStates.set({})
  disposers.splice(0).forEach(dispose => dispose())
  vi.unstubAllGlobals()
})

it.each([false, true])('keeps an ordinary file draft while a page covers the work area (mixed: %s)', mixed => {
  const tree = split('row', [
    group(['sessions', 'hermes-bots:pane'], { id: 'navigation', active: 'sessions' }),
    ...(mixed
      ? [group(['workspace', 'preview-tile:readme'], { id: 'content', active: 'preview-tile:readme' })]
      : [group(['workspace'], { id: 'content' }), group(['preview-tile:readme'], { id: 'preview' })])
  ])

  $layoutTree.set(tree)
  const hidden = $hiddenTreePanes.get()

  const { container } = render(
    <KeepAlivePanes>
      <TreeNode node={tree} root rootRow />
    </KeepAlivePanes>
  )

  const editor = screen.getByRole('textbox', { name: 'Unsaved file' }) as HTMLTextAreaElement
  fireEvent.change(editor, { target: { value: 'Keep my unsaved work' } })
  editor.focus()
  expect(editor.ownerDocument.activeElement).toBe(editor)

  act(() => $workspaceIsPage.set(true))
  expect(screen.getByRole('main').textContent).toBe('Page contents')
  expect(screen.getByRole('navigation').textContent).toBe('Navigation')
  expect(screen.getByRole('tab', { name: 'Agent Hub' })).toBeTruthy()
  // jsdom and Testing Library do not implement inert; native input blocking is covered in Electron.
  expect(editor.ownerDocument.activeElement).not.toBe(editor)
  expect(editor.isConnected).toBe(true)
  expect(editor.closest('[data-pane-hidden]')?.hasAttribute('inert')).toBe(true)

  if (!mixed) {
    expect((container.querySelector('[data-tree-track="preview"]') as HTMLElement).style.display).toBe('none')
  }

  expect(unmounted).not.toHaveBeenCalled()
  expect($layoutTree.get()).toBe(tree)
  expect($hiddenTreePanes.get()).toBe(hidden)

  act(() => $workspaceIsPage.set(false))
  expect(screen.getByRole('textbox', { name: 'Unsaved file' })).toBe(editor)
  editor.focus()
  expect(editor.ownerDocument.activeElement).toBe(editor)
  expect(editor.value).toBe('Keep my unsaved work')
  expect(unmounted).not.toHaveBeenCalled()
  expect($layoutTree.get()).toBe(tree)
})

it('does not remount already parked panes when a page covers a warm editor', () => {
  const paneIds = ['old-a', 'old-b', 'warm-a', 'warm-b', 'current']

  for (const id of paneIds) {
    disposers.push(registry.register({ area: 'panes', id, title: id, render: () => <CachedPane id={id} /> }))
  }

  const treeFor = (active: string) => group(['workspace', ...paneIds], { id: 'content', active })
  let tree = treeFor(paneIds[0])
  $layoutTree.set(tree)
  const view = render(<TreeNode node={tree} root rootRow />)

  for (const id of paneIds.slice(1)) {
    tree = treeFor(id)
    act(() => $layoutTree.set(tree))
    view.rerender(<TreeNode node={tree} root rootRow />)
  }

  expect(mounts.mock.calls.filter(([id]) => id === 'old-a')).toHaveLength(1)
  expect(screen.queryByTestId('body-old-a')).toBeNull()
  act(() => $workspaceIsPage.set(true))
  expect(screen.getByRole('main').textContent).toBe('Page contents')
  expect(mounts.mock.calls.filter(([id]) => id === 'old-a')).toHaveLength(1)
  expect(mounts.mock.calls.filter(([id]) => id === 'old-b')).toHaveLength(1)
  expect(screen.queryByTestId('body-old-a')).toBeNull()
  expect(screen.queryByTestId('body-old-b')).toBeNull()
})
