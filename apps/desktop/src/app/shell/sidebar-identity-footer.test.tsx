import { useStore } from '@nanostores/react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import { AccountContext } from '@/app/account/account-context'
import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { group, type GroupNode, split } from '@/components/pane-shell/tree/model'
import { NarrowOverlays } from '@/components/pane-shell/tree/renderer/narrow-overlays'
import { TreeGroup } from '@/components/pane-shell/tree/renderer/tree-group'
import {
  $hiddenTreePanes,
  $layoutTree,
  $narrowViewport,
  activateTreePane,
  setTreeGroupMinimized
} from '@/components/pane-shell/tree/store'
import { registry } from '@/contrib/registry'
import { type AccountAdapter, createAccountActions } from '@/store/account'
import { stubResizeObserver } from '@/test/jsdom'

import { SidebarIdentityFooter } from './sidebar-identity-footer'

const unavailableAccount = async () => {
  throw new Error('Sidebar account display must not request account services')
}

const accountActions = createAccountActions({
  kind: 'platform',
  fixedCodeHint: false,
  status: unavailableAccount,
  capabilities: unavailableAccount,
  retry: unavailableAccount,
  requestPhoneCode: unavailableAccount,
  verifyPhoneCode: unavailableAccount,
  loginExisting: unavailableAccount,
  completeSecondFactor: unavailableAccount,
  updateProfile: unavailableAccount,
  logout: unavailableAccount,
  onChanged: () => () => {}
} as AccountAdapter)

const disposers: (() => void)[] = []

function LiveNavigation() {
  const tree = useStore($layoutTree)

  return (tree?.type === 'split' ? tree.children : [tree]).map(node => (
    <TreeGroup key={node!.id} node={node as GroupNode} parentAxis="row" railSide="right" />
  ))
}

function CurrentRoute() {
  const location = useLocation()

  return <output data-testid="route">{location.pathname + location.search}</output>
}

beforeAll(() => {
  stubResizeObserver()
  vi.stubGlobal('CSS', { ...globalThis.CSS, escape: (value: string) => value })
  HTMLElement.prototype.scrollIntoView ??= () => undefined
})

beforeEach(() => {
  accountActions.state.set({
    ...accountActions.state.get(),
    authenticated: true,
    account: { id: 'account-one', display_name: 'Test User', phone_masked: '', email: 'user@example.test' }
  })
  $hiddenTreePanes.set(new Set())
  $narrowViewport.set(false)
  disposers.push(
    ...['sessions', 'hermes-bots:pane'].map(id =>
      registry.register({
        area: 'panes',
        id,
        title: id,
        data: { collapsible: true, hideOnly: true, placement: 'left' },
        render: () => <div>{id} content</div>
      })
    ),
    registry.register({
      area: 'panes',
      id: 'files',
      title: 'Files',
      data: { collapsible: true, placement: 'right' },
      render: () => <div>Files content</div>
    }),
    registry.register({
      area: 'navigation.footer',
      id: 'sidebar-account',
      render: () => <SidebarIdentityFooter />
    })
  )
  $layoutTree.set(
    split('row', [
      group(['sessions', 'hermes-bots:pane'], { id: 'navigation', active: 'sessions' }),
      group(['files'], { id: 'files-zone', active: 'files' })
    ])
  )
})

afterEach(() => {
  cleanup()
  disposers.splice(0).forEach(dispose => dispose())
  $narrowViewport.set(false)
  $layoutTree.set(null)
})

function renderNavigation(narrow = false) {
  return render(
    <MemoryRouter>
      <AccountContext.Provider value={accountActions}>
        {narrow ? <NarrowOverlays /> : <LiveNavigation />}
        <CurrentRoute />
      </AccountContext.Provider>
    </MemoryRouter>
  )
}

it('keeps one signed-in account footer across navigation tabs and opens account/settings', () => {
  renderNavigation()
  expect(screen.getAllByRole('button', { name: 'My account · Test User' })).toHaveLength(1)

  act(() => activateTreePane('navigation', 'hermes-bots:pane'))
  expect(screen.getByText('hermes-bots:pane content').closest('[aria-hidden="true"]')).toBeNull()
  expect(screen.getAllByRole('button', { name: 'My account · Test User' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'My account · Test User' }))
  expect(screen.getByTestId('route').textContent).toBe('/settings?tab=account')

  act(() => {
    accountActions.state.set({
      ...accountActions.state.get(),
      account: { id: 'account-two', display_name: '', phone_masked: '', email: 'second@example.test' }
    })
  })
  expect(screen.queryByText('Test User')).toBeNull()
  expect(screen.getByRole('button', { name: 'My account · second@example.test' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
  expect(screen.getByTestId('route').textContent).toBe('/settings')

  act(() => activateTreePane('navigation', 'sessions'))
  expect(screen.getAllByRole('button', { name: 'My account · second@example.test' })).toHaveLength(1)
  act(() => setTreeGroupMinimized('navigation', true))
  expect(screen.queryByRole('button', { name: 'My account · second@example.test' })).toBeNull()

  act(() => {
    $layoutTree.set(split('row', [group(['sessions']), group(['hermes-bots:pane']), group(['files'])]))
  })
  expect(screen.getAllByRole('button', { name: 'My account · second@example.test' })).toHaveLength(1)
})

it('keeps the account accessible when switching tabs in the narrow sidebar overlay', () => {
  $narrowViewport.set(true)
  renderNavigation(true)
  act(() =>
    window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: 'sessions', mode: 'open' } }))
  )
  expect(screen.getAllByRole('button', { name: 'My account · Test User' })).toHaveLength(1)
  fireEvent.pointerDown(globalThis.document.querySelector('[data-narrow-overlay-tab="hermes-bots:pane"]')!, {
    button: 0
  })
  expect(screen.getByText('hermes-bots:pane content')).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'My account · Test User' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'My account · Test User' }))
  expect(screen.getByTestId('route').textContent).toBe('/settings?tab=account')

  act(() => {
    window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: 'files', mode: 'open' } }))
  })
  expect(screen.getByText('Files content')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'My account · Test User' })).toBeNull()
})
