import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { SessionDraftTitle } from '@/app/chat/session-draft-title'
import { Slot } from '@/contrib/react/slot'
import { registry } from '@/contrib/registry'
import { createClientSessionState } from '@/lib/chat-runtime'
import { clearSessionDraft, stashSessionDraft } from '@/store/composer'
import { $activeSessionId, $selectedStoredSessionId } from '@/store/session'
import { $sessionStates, $sessionTiles } from '@/store/session-states'

import { $layoutEditMode } from '../../edit-mode'
import { group } from '../model'

import { WindowTitlebarContext } from './header-placement'
import { TreeGroup } from './tree-group'

let root: null | Root = null
let container: HTMLDivElement | null = null
const disposers: (() => void)[] = []

function render(ui: ReactNode) {
  if (!container) {
    container = globalThis.document.createElement('div')
    globalThis.document.body.append(container)
    root = createRoot(container)
  }

  act(() => {
    root!.render(ui)
  })
}

beforeAll(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  // jsdom lacks CSS.escape, which tab-strip-scroll uses in a layout effect.
  vi.stubGlobal('CSS', { ...globalThis.CSS, escape: (value: string) => value })
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
  HTMLElement.prototype.scrollIntoView ??= () => undefined
})

beforeEach(() => {
  window.localStorage.clear()
  $layoutEditMode.set(false)
  $activeSessionId.set(null)
  $selectedStoredSessionId.set('existing-session')
  $sessionStates.set({})
  $sessionTiles.set([])

  for (const [id, title, data] of [
    ['workspace', 'Workspace', { placement: 'main', uncloseable: true }],
    ['session-tile:a', 'Session A', { placement: 'main' }],
    ['session-tile:b', 'Session B', { placement: 'main' }]
  ] as const) {
    disposers.push(registry.register({ area: 'panes', data, id, render: () => null, title }))
  }
})

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
  }

  container?.remove()
  disposers.splice(0).forEach(dispose => dispose())
  root = null
  container = null
  clearSessionDraft(null)
  $activeSessionId.set(null)
  $selectedStoredSessionId.set(null)
  $sessionStates.set({})
  $sessionTiles.set([])
})

describe('single-session header', () => {
  it('hides the primary draft heading until send while retaining draft names in the tab strip', () => {
    $selectedStoredSessionId.set(null)
    disposers.push(
      registry.register({
        area: 'panes',
        data: {
          placement: 'main',
          tabLead: () => <span aria-label="Draft status" />,
          tabTitle: () => <SessionDraftTitle scope={null} />
        },
        id: 'workspace',
        render: () => null,
        title: 'New session'
      })
    )
    render(
      <WindowTitlebarContext.Provider value>
        <Slot area="titleBar.left" />
        <TreeGroup node={group(['workspace'], { id: 'primary-draft' })} parentAxis="row" />
      </WindowTitlebarContext.Provider>
    )

    expect(globalThis.document.querySelector('[data-window-session-title]')).toBeNull()
    expect(globalThis.document.querySelector('[aria-label="Draft status"]')).toBeNull()
    act(() => stashSessionDraft(null, 'This message has not been sent', []))
    expect(globalThis.document.querySelector('[data-current-session-title]')).toBeNull()

    act(() => $layoutEditMode.set(true))
    expect(globalThis.document.querySelector('[data-tree-tab="workspace"]')?.textContent).toContain(
      'This message has not been sent'
    )
    expect(globalThis.document.querySelector('[aria-label="Draft status"]')).toBeTruthy()
    act(() => $layoutEditMode.set(false))
    expect(globalThis.document.querySelector('[data-current-session-title]')).toBeNull()
    act(() => {
      $selectedStoredSessionId.set('sent-session')
      disposers.push(
        registry.register({
          area: 'panes',
          data: { placement: 'main' },
          id: 'workspace',
          render: () => null,
          title: 'The confirmed conversation title'
        })
      )
    })
    expect(globalThis.document.querySelector('[data-current-session-title]')?.textContent).toBe(
      'The confirmed conversation title'
    )

    act(() => $selectedStoredSessionId.set(null))
    expect(globalThis.document.querySelector('[data-current-session-title]')).toBeNull()
    // Selecting history is enough: a cold transcript is not an unsent draft.
    act(() => $selectedStoredSessionId.set('sent-session'))
    expect(globalThis.document.querySelector('[data-current-session-title]')?.textContent).toBe(
      'The confirmed conversation title'
    )
  })

  it('keeps a promoted unsent tile out of the window heading without hiding its navigation handles', () => {
    const draft = { ...createClientSessionState('a'), isUnsentDraft: true }
    $sessionTiles.set([{ storedSessionId: 'a', runtimeId: 'draft-runtime' }])
    $sessionStates.set({ 'draft-runtime': draft })
    const node = group(['workspace', 'session-tile:a'], { active: 'session-tile:a', id: 'promoted-draft' })
    render(
      <WindowTitlebarContext.Provider value>
        <Slot area="titleBar.left" />
        <TreeGroup node={node} parentAxis="row" />
      </WindowTitlebarContext.Provider>
    )

    expect(globalThis.document.querySelector('[data-current-session-title]')).toBeNull()
    act(() => $layoutEditMode.set(true))
    expect(globalThis.document.querySelector('[data-tree-tab="session-tile:a"]')).toBeTruthy()
    act(() => $layoutEditMode.set(false))
    expect(globalThis.document.querySelector('[data-current-session-title]')).toBeNull()

    act(() => $sessionStates.set({ 'draft-runtime': { ...draft, isUnsentDraft: false } }))
    expect(globalThis.document.querySelector('[data-current-session-title]')?.textContent).toBe('Session A')
    // A freshly resumed runtime has no draft marker, even before its messages load.
    act(() => $sessionStates.set({ 'draft-runtime': createClientSessionState('a') }))
    expect(globalThis.document.querySelector('[data-current-session-title]')?.textContent).toBe('Session A')
  })

  it('moves the primary title and its live menu into the window bar and restores the inline header when needed', () => {
    let menuClicks = 0

    disposers.push(
      registry.register({
        area: 'panes',
        data: {
          headerMenu: () => <button onClick={() => menuClicks++}>Session actions</button>,
          placement: 'main'
        },
        id: 'session-tile:promoted',
        render: () => null,
        title: 'Promoted conversation'
      })
    )
    const node = group(['workspace', 'session-tile:promoted'], { active: 'session-tile:promoted', id: 'primary' })

    const shell = (enabled: boolean) => (
      <WindowTitlebarContext.Provider value={enabled}>
        <div data-test-titlebar="">
          <Slot area="titleBar.left" />
        </div>
        <TreeGroup node={node} parentAxis="row" />
      </WindowTitlebarContext.Provider>
    )

    render(shell(true))
    const bar = () => globalThis.document.querySelector('[data-test-titlebar]')!
    const inline = () => globalThis.document.querySelector('[data-tree-group="primary"]')!

    expect(bar().textContent).toContain('Promoted conversation')
    expect(inline().querySelector('[data-current-session-title]')).toBeNull()
    act(() => bar().querySelector('button')!.click())
    expect(menuClicks).toBe(1)

    act(() => $layoutEditMode.set(true))
    expect(bar().querySelector('[data-current-session-title]')).toBeNull()
    expect(inline().querySelectorAll('[data-tree-tab]')).toHaveLength(2)
    act(() => $layoutEditMode.set(false))
    expect(bar().textContent).toContain('Promoted conversation')

    render(shell(false))
    expect(bar().querySelector('[data-current-session-title]')).toBeNull()
    expect(inline().textContent).toContain('Promoted conversation')
  })

  it('keeps secondary conversation headers in their own split pane', () => {
    render(
      <WindowTitlebarContext.Provider value>
        <div data-test-titlebar="">
          <Slot area="titleBar.left" />
        </div>
        <TreeGroup node={group(['workspace'], { id: 'primary' })} parentAxis="row" />
        <TreeGroup node={group(['session-tile:a'], { id: 'secondary' })} parentAxis="row" />
      </WindowTitlebarContext.Provider>
    )

    expect(globalThis.document.querySelector('[data-test-titlebar]')?.textContent).toContain('Workspace')
    expect(globalThis.document.querySelector('[data-test-titlebar]')?.textContent).not.toContain('Session A')
    expect(
      globalThis.document.querySelector('[data-tree-group="secondary"] [data-current-session-title]')?.textContent
    ).toBe('Session A')
  })

  it('shows only the active session title in a chat-only zone', () => {
    const node = group(['workspace', 'session-tile:a', 'session-tile:b'], {
      active: 'session-tile:b',
      id: 'grp-chat'
    })

    render(<TreeGroup node={node} parentAxis="column" />)

    expect(globalThis.document.querySelector('[data-zone-tabstrip="grp-chat"]')).toBeTruthy()
    expect(globalThis.document.querySelectorAll('[data-tree-tab]')).toHaveLength(1)
    expect(globalThis.document.querySelector('[data-tree-tab="session-tile:b"]')?.textContent).toContain('Session B')
    expect(globalThis.document.querySelector('[data-tree-tab="session-tile:a"]')).toBeNull()
    expect(globalThis.document.querySelector('[data-tree-tab="session-tile:b"] button[aria-label="Close"]')).toBeNull()
  })

  it('shows the workspace title as the single header when the workspace is active', () => {
    const node = group(['workspace', 'session-tile:a'], {
      active: 'workspace',
      id: 'grp-primary'
    })

    render(<TreeGroup node={node} parentAxis="column" />)

    // The in-surface ChatHeader is display:none inside layout trees, so the
    // zone header owns the routed session's title — one tab, not a strip.
    expect(globalThis.document.querySelector('[data-zone-tabstrip="grp-primary"]')).toBeTruthy()
    expect(globalThis.document.querySelectorAll('[data-tree-tab]')).toHaveLength(1)
    expect(globalThis.document.querySelector('[data-tree-tab="workspace"]')?.textContent).toContain('Workspace')
    expect(globalThis.document.querySelector('[data-tree-tab="session-tile:a"]')).toBeNull()
  })

  it('titles a workspace-only zone instead of leaving a blank header band', () => {
    const node = group(['workspace'], { active: 'workspace', id: 'grp-solo' })

    render(<TreeGroup node={node} parentAxis="column" />)

    expect(globalThis.document.querySelectorAll('[data-tree-tab]')).toHaveLength(1)
    expect(globalThis.document.querySelector('[data-current-session-title]')).toBeTruthy()
  })

  it('pairs the single title with the pane headerMenu kebab, and only there', () => {
    disposers.push(
      registry.register({
        area: 'panes',
        data: {
          headerMenu: () => (
            <button aria-label="Session actions" type="button">
              ⋯
            </button>
          ),
          placement: 'main'
        },
        id: 'session-tile:c',
        render: () => null,
        title: 'Session C'
      })
    )

    const kebab = () => document.querySelector('button[aria-label="Session actions"]')

    render(
      <TreeGroup
        node={group(['workspace', 'session-tile:c'], { active: 'session-tile:c', id: 'grp-kebab' })}
        parentAxis="column"
      />
    )
    expect(kebab()).toBeTruthy()

    // Edit mode keeps the full strip — the kebab belongs to the single header.
    act(() => $layoutEditMode.set(true))
    expect(kebab()).toBeNull()
    act(() => $layoutEditMode.set(false))

    // A mixed zone keeps the shared strip, whose menu surface is right-click.
    const disposePreview = registry.register({
      area: 'panes',
      data: { placement: 'main' },
      id: 'preview-tile:kebab',
      render: () => null,
      title: 'Preview'
    })

    disposers.push(disposePreview)

    render(
      <TreeGroup
        node={group(['workspace', 'session-tile:c', 'preview-tile:kebab'], {
          active: 'session-tile:c',
          id: 'grp-kebab-mixed'
        })}
        parentAxis="column"
      />
    )
    expect(kebab()).toBeNull()
  })

  it('keeps every pane tab available while editing the layout', () => {
    $layoutEditMode.set(true)

    const node = group(['workspace', 'session-tile:a', 'session-tile:b'], {
      active: 'session-tile:b',
      id: 'grp-chat-edit'
    })

    render(<TreeGroup node={node} parentAxis="column" />)

    expect(globalThis.document.querySelectorAll('[data-tree-tab]')).toHaveLength(3)
  })

  it('does not collapse a mixed chat and non-chat zone into one title', () => {
    const disposePreview = registry.register({
      area: 'panes',
      data: { placement: 'main' },
      id: 'preview-tile:test',
      render: () => null,
      title: 'Preview'
    })

    disposers.push(disposePreview)

    const node = group(['workspace', 'session-tile:a', 'preview-tile:test'], {
      active: 'workspace',
      id: 'grp-mixed'
    })

    render(<TreeGroup node={node} parentAxis="column" />)

    expect(globalThis.document.querySelectorAll('[data-tree-tab]')).toHaveLength(3)
  })
})
