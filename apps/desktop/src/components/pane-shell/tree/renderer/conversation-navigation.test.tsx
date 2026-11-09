import { useStore } from '@nanostores/react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { registry } from '@/contrib/registry'
import { $activeSessionId, $selectedStoredSessionId, setCurrentCwd } from '@/store/session'
import { $focusedStoredSessionId } from '@/store/session-focus'
import { $focusedRuntimeId, $focusedWorkspaceCwd, $sessionTiles, closeAllOpenSessionTiles } from '@/store/session-states'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

import { resetRememberedActivePanes, setWorkspaceScope } from '../../workspace-scope'
import { findGroupOfPane, group, split } from '../model'
import {
  $activeTreeGroup,
  $hiddenTreePanes,
  $layoutTree,
  $narrowViewport,
  $paneVisible,
  activateTreePane,
  closeFocusedSessionTab,
  cycleTreeTabInFocusedZone,
  focusedSessionTabAnchor,
  noteHoveredTreeGroup,
  shownPanesInGroup
} from '../store'

import { TreeNode } from './tree-node'

const owner = 'bot:connection-a::writer'
const groupOwner = 'group:connection-a::project'
const ids = ['workspace', 'session-tile:ordinary', 'session-tile:bot', 'session-tile:bot-side', 'plugin-workspace:room']
const disposers: (() => void)[] = []

function Host() {
  const tree = useStore($layoutTree)

  return <MemoryRouter>{tree && <TreeNode node={tree} />}</MemoryRouter>
}

function openSwitcher() {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Switch conversation' }), {
    button: 0,
    pointerType: 'mouse',
    ctrlKey: false
  })
}

beforeEach(() => {
  stubResizeObserver()
  stubMenuDomApis()
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  resetRememberedActivePanes()
  $activeSessionId.set(null)
  $selectedStoredSessionId.set(null)
  $sessionTiles.set([])
  setWorkspaceScope('sessions')
  $hiddenTreePanes.set(new Set())
  $narrowViewport.set(false)
  $activeTreeGroup.set('content')
  noteHoveredTreeGroup(null)

  ids.forEach((id, index) => {
    const bot = id === ids[2] || id === ids[3]
    const room = id === ids[4]
    disposers.push(
      registry.register({
        area: 'panes',
        id,
        title: ['Primary conversation', 'Ordinary conversation', 'Writer', 'Writer side conversation', 'Project room'][
          index
        ],
        data: {
          placement: 'main',
          uncloseable: id === 'workspace',
          workspaceScope: room
            ? { mode: 'bots', ownerKey: groupOwner }
            : bot
              ? { mode: 'bots', ownerKey: owner }
              : { mode: 'sessions' },
          ...(room && { tabPresentation: 'conversation' })
        },
        render: () => <input aria-label={`Draft ${index}`} defaultValue="" />
      })
    )
  })
  $layoutTree.set(group(ids, { id: 'content', active: 'workspace', tabStrip: 'always' }))
})

afterEach(() => {
  cleanup()
  disposers.splice(0).forEach(dispose => dispose())
  $layoutTree.set(null)
  $activeTreeGroup.set(null)
  noteHoveredTreeGroup(null)
  setWorkspaceScope('sessions')
  resetRememberedActivePanes()
  $activeSessionId.set(null)
  $selectedStoredSessionId.set(null)
  $sessionTiles.set([])
  setCurrentCwd('')
  vi.unstubAllGlobals()
})

it('keeps one current title and switches ordinary conversations without losing drafts or retained panes', () => {
  const { container } = render(<Host />)
  const originalDraft = screen.getByRole('textbox', { name: 'Draft 0' }) as HTMLInputElement
  fireEvent.change(originalDraft, { target: { value: 'Keep this unsent message' } })
  expect(container.querySelectorAll('[data-tree-tab]')).toHaveLength(1)
  openSwitcher()
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(2)
  expect(screen.queryByRole('menuitemradio', { name: 'Writer' })).toBeNull()
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Ordinary conversation' }))
  expect($layoutTree.get()).toMatchObject({ active: ids[1], panes: ids })
  expect(container.querySelector('[data-current-session-title]')?.textContent).toBe('Ordinary conversation')

  openSwitcher()
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Primary conversation' }))
  expect(screen.getByRole('textbox', { name: 'Draft 0' })).toBe(originalDraft)
  expect(originalDraft.value).toBe('Keep this unsent message')
})

it('restores the ordinary current conversation after Agent Hub and retains the hidden draft', async () => {
  const { container } = render(<Host />)
  act(() => activateTreePane('content', ids[1]))
  const draft = screen.getByRole('textbox', { name: 'Draft 1' }) as HTMLInputElement
  fireEvent.change(draft, { target: { value: 'An ordinary draft' } })
  act(() => {
    setWorkspaceScope('bots', owner)
    activateTreePane('content', ids[2])
  })
  openSwitcher()
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(2)
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Writer side conversation' }))
  expect($focusedStoredSessionId.get()).toBe('bot-side')

  act(() => setWorkspaceScope('sessions'))
  expect(container.querySelector('[data-current-session-title]')?.textContent).toBe('Ordinary conversation')
  expect($paneVisible(ids[3]).get()).toBe(false)
  expect($focusedStoredSessionId.get()).toBe('ordinary')
  await waitFor(() => expect($layoutTree.get()).toMatchObject({ active: ids[1] }))
  expect(screen.getByRole('textbox', { name: 'Draft 1' })).toBe(draft)
  expect(draft.value).toBe('An ordinary draft')

  act(() => setWorkspaceScope('bots', owner))
  expect(container.querySelector('[data-current-session-title]')?.textContent).toBe('Writer side conversation')
  expect($layoutTree.get()).toMatchObject({ panes: ids })
})

it('uses the same single-title navigation for a group conversation without publishing an ordinary session focus', () => {
  act(() => setWorkspaceScope('bots', groupOwner))
  const { container } = render(<Host />)
  expect(container.querySelectorAll('[data-tree-tab]')).toHaveLength(1)
  expect(container.querySelector('[data-current-session-title]')?.textContent).toBe('Project room')
  expect(screen.queryByRole('button', { name: 'Switch conversation' })).toBeNull()
  expect($focusedStoredSessionId.get()).toBeNull()
  expect($paneVisible(ids[4]).get()).toBe(true)
  expect($paneVisible(ids[2]).get()).toBe(false)
})

it('keeps file and browser tool tabs alongside a single conversation slot', () => {
  for (const id of ['files', 'preview-tile:browser']) {
    disposers.push(
      registry.register({ area: 'panes', id, title: id, data: { placement: 'main' }, render: () => <div>{id}</div> })
    )
  }

  const mixed = [...ids, 'files', 'preview-tile:browser']
  $layoutTree.set(group(mixed, { id: 'content', active: 'workspace', tabStrip: 'always' }))
  const { container } = render(<Host />)
  expect([...container.querySelectorAll('[data-tree-tab]')].map(tab => tab.getAttribute('data-tree-tab'))).toEqual([
    'workspace',
    'files',
    'preview-tile:browser'
  ])
  act(() => activateTreePane('content', 'preview-tile:browser'))
  openSwitcher()
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Ordinary conversation' }))
  expect($layoutTree.get()).toMatchObject({ active: ids[1], panes: mixed })
  expect(container.querySelector('[data-tree-tab="files"]')).not.toBeNull()
  expect(container.querySelector('[data-tree-tab="preview-tile:browser"]')).not.toBeNull()
})

it('keeps shortcuts and close from targeting a foreign-only split', () => {
  $layoutTree.set(
    split('row', [
      group(['workspace', ids[1]], { id: 'content', active: 'workspace' }),
      group([ids[2], ids[3]], { id: 'foreign', active: ids[3] })
    ])
  )
  render(<Host />)
  noteHoveredTreeGroup('foreign')
  expect(shownPanesInGroup(findGroupOfPane($layoutTree.get()!, ids[2])!)).toEqual([])
  expect($paneVisible(ids[3]).get()).toBe(false)
  expect(focusedSessionTabAnchor()).toBe('workspace')
  expect(closeFocusedSessionTab()).toBe(false)
  act(() => {
    expect(cycleTreeTabInFocusedZone(1)).toBe(ids[1])
  })
  expect(findGroupOfPane($layoutTree.get()!, ids[2])?.panes).toEqual([ids[2], ids[3]])
})

it('leaves an unsent ordinary runtime and its workspace behind when opening a group', () => {
  $activeSessionId.set('primary-draft-runtime')
  setCurrentCwd('/ordinary-project')
  render(<Host />)
  expect($focusedStoredSessionId.get()).toBeNull()
  expect($focusedRuntimeId.get()).toBe('primary-draft-runtime')
  expect($focusedWorkspaceCwd.get()).toBe('/ordinary-project')
  act(() => setWorkspaceScope('bots', groupOwner))
  expect($focusedStoredSessionId.get()).toBeNull()
  expect($focusedRuntimeId.get()).toBeNull()
  expect($focusedWorkspaceCwd.get()).toBe('')
  act(() => setWorkspaceScope('sessions'))
  expect($focusedRuntimeId.get()).toBe('primary-draft-runtime')
  expect($focusedWorkspaceCwd.get()).toBe('/ordinary-project')
})

it('closes only ordinary open conversations and keeps Agent Hub work intact', () => {
  $sessionTiles.set([
    { storedSessionId: 'ordinary', workspaceMode: 'sessions' },
    { storedSessionId: 'bot', workspaceMode: 'bots', workspaceOwnerKey: owner },
    { storedSessionId: 'bot-side', workspaceMode: 'bots', workspaceOwnerKey: owner }
  ])
  closeAllOpenSessionTiles('workspace')
  expect($sessionTiles.get().map(tile => tile.storedSessionId)).toEqual(['bot', 'bot-side'])
})
