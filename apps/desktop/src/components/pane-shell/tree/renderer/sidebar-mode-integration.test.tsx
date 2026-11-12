import { useStore } from '@nanostores/react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useContext } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $workspaceIsPage, navigateToWorkspacePage, syncWorkspaceRoute } from '@/app/routes'
import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { SidebarBrandContext } from '@/components/pane-shell/pane-visibility'
import { registry } from '@/contrib/registry'
import { $selectedStoredSessionId } from '@/store/session'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

import { group, split } from '../model'
import { $hiddenTreePanes, $layoutTree, $narrowViewport, activateTreePane } from '../store'

import { NarrowOverlays } from './narrow-overlays'
import { TreeGroup } from './tree-group'

const disposers: (() => void)[] = []
const hubId = 'example-agent-plugin:roster'
let disableHub: () => void

function SessionContents() {
  const hostBrand = useContext(SidebarBrandContext)

  return (
    <div>
      {!hostBrand && <span>Legacy Aino brand</span>}
      <input aria-label="Session draft" defaultValue="Keep this draft" />
    </div>
  )
}

function LiveGroup() {
  const tree = useStore($layoutTree)

  return tree?.type === 'group' ? <TreeGroup node={tree} topEdge /> : null
}

beforeEach(() => {
  stubResizeObserver()
  stubMenuDomApis()
  vi.stubGlobal('CSS', { ...globalThis.CSS, escape: (value: string) => value })
  $workspaceIsPage.set(false)
  $hiddenTreePanes.set(new Set())
  $narrowViewport.set(false)
  disposers.push(
    registry.register({
      id: 'sessions',
      area: 'panes',
      title: 'Sessions',
      data: {
        placement: 'left',
        hideOnly: true,
        collapsible: true,
        sidebarMode: 'sessions',
        sidebarDescription: () => 'Projects and conversations'
      },
      render: SessionContents
    })
  )
  disableHub = registry.register({
    id: hubId,
    area: 'panes',
    title: 'Agent Hub',
    source: 'plugin:example-agent-plugin',
    data: {
      placement: 'left',
      hideOnly: true,
      collapsible: true,
      sidebarMode: 'bots',
      sidebarDescription: () => 'Bots and collaboration'
    },
    render: () => <div>Bot roster</div>
  })
  disposers.push(disableHub)
  $layoutTree.set(group(['sessions', hubId], { id: 'navigation', active: 'sessions' }))
})

afterEach(() => {
  cleanup()
  $layoutTree.set(null)
  $narrowViewport.set(false)
  disposers.splice(0).forEach(dispose => dispose())
  vi.unstubAllGlobals()
  $selectedStoredSessionId.set(null)
  window.location.hash = '#/'
})

function chooseHub() {
  fireEvent.pointerDown(screen.getByRole('button', { name: /Switch conversation mode: Aino/ }), {
    button: 0,
    ctrlKey: false
  })
  fireEvent.click(screen.getByRole('menuitemradio', { name: /Agent Hub/ }))
}

function usePageNavigationPanes() {
  disableHub()
  disposers.push(
    registry.register({
      id: 'hermes-bots:pane',
      area: 'panes',
      title: 'Agent Hub',
      source: 'plugin:hermes-bots',
      data: {
        placement: 'left',
        hideOnly: true,
        collapsible: true,
        sidebarMode: 'bots',
        sidebarDescription: () => 'Bots and collaboration'
      },
      render: () => <div>Bot roster</div>
    })
  )
  $layoutTree.set(group(['sessions', 'hermes-bots:pane'], { id: 'navigation', active: 'sessions' }))
}

describe('shared navigation brand menu', () => {
  it('leaves a tools page on an explicit mode switch while retaining the current conversation and draft', () => {
    usePageNavigationPanes()
    $selectedStoredSessionId.set('ordinary-chat')
    window.location.hash = '#/capabilities?tab=tools'
    syncWorkspaceRoute('/capabilities?tab=tools')
    render(
      <MemoryRouter>
        <LiveGroup />
      </MemoryRouter>
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Session draft' }), { target: { value: 'Unsaved text' } })
    chooseHub()

    expect($workspaceIsPage.get()).toBe(false)
    expect(window.location.hash).toBe('#/ordinary-chat')
    expect($selectedStoredSessionId.get()).toBe('ordinary-chat')

    act(() =>
      navigateToWorkspacePage(to => {
        window.location.hash = `#${to}`
      }, '/capabilities?tab=tools')
    )
    act(() => syncWorkspaceRoute('/capabilities?tab=tools'))
    expect($workspaceIsPage.get()).toBe(true)
    fireEvent.pointerDown(screen.getByRole('button', { name: /Switch conversation mode: Agent Hub/ }), {
      button: 0,
      ctrlKey: false
    })
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Aino/ }))

    expect($workspaceIsPage.get()).toBe(false)
    expect(window.location.hash).toBe('#/ordinary-chat')
    expect((screen.getByRole('textbox', { name: 'Session draft' }) as HTMLInputElement).value).toBe('Unsaved text')
  })

  it('does not leave a tools page when pane visibility changes without a mode selection', () => {
    usePageNavigationPanes()
    window.location.hash = '#/capabilities?tab=tools'
    syncWorkspaceRoute('/capabilities?tab=tools')
    render(
      <MemoryRouter>
        <LiveGroup />
      </MemoryRouter>
    )
    act(() => activateTreePane('navigation', 'hermes-bots:pane'))

    expect($workspaceIsPage.get()).toBe(true)
    expect(window.location.hash).toBe('#/capabilities?tab=tools')
  })

  it('leaves the tools page through the narrow mode menu without replacing its retained conversation', () => {
    usePageNavigationPanes()
    $layoutTree.set(split('row', [group(['sessions', 'hermes-bots:pane'], { id: 'navigation', active: 'sessions' })]))
    $narrowViewport.set(true)
    $selectedStoredSessionId.set('ordinary-chat')
    window.location.hash = '#/capabilities?tab=tools'
    syncWorkspaceRoute('/capabilities?tab=tools')
    render(<NarrowOverlays />)
    act(() =>
      window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: 'sessions', mode: 'open' } }))
    )
    chooseHub()

    expect($workspaceIsPage.get()).toBe(false)
    expect(window.location.hash).toBe('#/ordinary-chat')
    expect($selectedStoredSessionId.get()).toBe('ordinary-chat')
    expect(screen.getByText('Bot roster')).toBeTruthy()
  })

  it('activates the existing pane, preserves the session draft and falls back when the plugin unloads', () => {
    const { container } = render(
      <MemoryRouter>
        <LiveGroup />
      </MemoryRouter>
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Session draft' }), { target: { value: 'Unsaved text' } })
    expect(screen.queryByText('Legacy Aino brand')).toBeNull()
    chooseHub()
    expect($layoutTree.get()).toMatchObject({ active: hubId })
    expect(screen.getByText('Bot roster').closest('[data-pane-hidden]')).toBeNull()
    fireEvent.pointerDown(screen.getByRole('button', { name: /Switch conversation mode: Agent Hub/ }), {
      button: 0,
      ctrlKey: false
    })
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Aino/ }))
    expect($layoutTree.get()).toMatchObject({ active: 'sessions' })
    expect((screen.getByRole('textbox', { name: 'Session draft' }) as HTMLInputElement).value).toBe('Unsaved text')
    chooseHub()
    act(() => disableHub())
    expect(screen.getByRole('textbox', { name: 'Session draft' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Switch conversation mode/ })).toBeNull()
    expect(container.querySelectorAll('[data-sidebar-mode-header]')).toHaveLength(1)
  })

  it('keeps ordinary tabs for a mixed group with an unknown guest', () => {
    disposers.push(
      registry.register({
        id: 'other-plugin',
        area: 'panes',
        title: 'Other',
        data: { placement: 'left' },
        render: () => <div>Other pane</div>
      })
    )
    $layoutTree.set(group(['sessions', hubId, 'other-plugin'], { id: 'navigation', active: 'sessions' }))
    render(
      <MemoryRouter>
        <LiveGroup />
      </MemoryRouter>
    )
    expect(screen.queryByRole('button', { name: /Switch conversation mode/ })).toBeNull()
    expect(globalThis.document.querySelector(`[data-tree-tab="${hubId}"]`)).toBeTruthy()
    expect(screen.getByText('Legacy Aino brand')).toBeTruthy()
  })

  it('does not overwrite a newer active sibling when a revealed plugin unloads', () => {
    disposers.push(
      registry.register({
        id: 'other-plugin',
        area: 'panes',
        title: 'Other',
        data: { placement: 'left', collapsible: true },
        render: () => <div>Other pane</div>
      })
    )
    $layoutTree.set(split('row', [group(['sessions', hubId, 'other-plugin'], { id: 'navigation', active: hubId })]))
    $narrowViewport.set(true)
    render(<NarrowOverlays />)
    act(() => window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: hubId, mode: 'open' } })))
    expect(screen.getByText('Bot roster')).toBeTruthy()
    act(() => activateTreePane('navigation', 'other-plugin'))
    act(() => disableHub())
    expect($layoutTree.get()).toMatchObject({ children: [{ active: 'other-plugin' }] })
  })

  it('keeps a hover-revealed narrow menu reachable and synchronizes the real active pane', () => {
    $layoutTree.set(split('row', [group(['sessions', hubId], { id: 'navigation', active: 'sessions' })]))
    $narrowViewport.set(true)
    const { container } = render(<NarrowOverlays />)
    // Hover reveal is deliberately unpinned; crossing into the portal must not dismiss it.
    fireEvent.mouseEnter(container.firstElementChild!)
    expect(screen.getByRole('textbox', { name: 'Session draft' })).toBeTruthy()
    fireEvent.pointerDown(screen.getByRole('button', { name: /Switch conversation mode: Aino/ }), {
      button: 0,
      ctrlKey: false
    })
    const item = screen.getByRole('menuitemradio', { name: /Agent Hub/ })
    fireEvent.mouseLeave(globalThis.document.querySelector('[data-narrow-overlay]')!, { relatedTarget: item })
    expect(screen.getByRole('menuitemradio', { name: /Agent Hub/ })).toBeTruthy()
    fireEvent.click(item)
    expect(screen.getByText('Bot roster')).toBeTruthy()
    expect($layoutTree.get()).toMatchObject({ children: [{ active: hubId }] })
    fireEvent.pointerDown(screen.getByRole('button', { name: /Switch conversation mode: Agent Hub/ }), {
      button: 0,
      ctrlKey: false
    })
    fireEvent.keyDown(globalThis.document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByText('Bot roster')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(globalThis.document.querySelector('[data-narrow-overlay]')).toBeNull()
    // The existing reveal command remains usable after dismissing the menu/overlay.
    act(() => window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: hubId, mode: 'open' } })))
    expect(screen.getByText('Bot roster')).toBeTruthy()
    act(() => disableHub())
    expect(screen.getByRole('textbox', { name: 'Session draft' })).toBeTruthy()
    expect($layoutTree.get()).toMatchObject({ children: [{ active: 'sessions' }] })
    act(() => {
      disposers.push(
        registry.register({
          id: hubId,
          area: 'panes',
          title: 'Agent Hub',
          data: {
            placement: 'left',
            hideOnly: true,
            collapsible: true,
            sidebarDescription: () => 'Bots and collaboration'
          },
          render: () => <div>Re-enabled bot roster</div>
        })
      )
    })
    expect(screen.queryByText('Re-enabled bot roster')).toBeNull()
    act(() =>
      window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: 'sessions', mode: 'close' } }))
    )
    expect(globalThis.document.querySelector('[data-narrow-overlay]')).toBeNull()
  })
})
