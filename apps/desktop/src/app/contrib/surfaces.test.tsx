import { act, cleanup, render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { HermesGateway } from '@/hermes'
import { $activeGatewayConnectionId, $gateway } from '@/store/gateway'
import { $activeGatewayProfile } from '@/store/profile'

import { ChatRoutesSurface } from './surfaces'
import type { WiringActions } from './types'

vi.mock('@/contrib/react/use-contributions', () => ({ useContributions: vi.fn() }))
vi.mock('@/store/connections', () => ({ $activeConnectionId: atom('local') }))
vi.mock('@/store/gateway', () => ({
  $gateway: atom<unknown>(null),
  $activeGatewayConnectionId: atom<null | string>(null)
}))
vi.mock('@/store/profile', () => ({ $activeGatewayProfile: atom('default') }))
vi.mock('@/store/session', () => ({
  $freshDraftReady: atom(false),
  $gatewayState: atom('open')
}))
vi.mock('../chat', () => ({
  ChatView: ({
    gateway,
    modelMenuContent,
    modelOptionsOwnerConnectionId
  }: {
    gateway: { id?: string } | null
    modelMenuContent?: ReactNode
    modelOptionsOwnerConnectionId?: string
  }) => (
    <>
      <div data-testid="gateway">{gateway?.id}</div>
      <div data-testid="catalog-owner">{modelOptionsOwnerConnectionId}</div>
      {modelMenuContent}
    </>
  )
}))
vi.mock('../chat/sidebar', () => ({ ChatSidebar: () => null }))
vi.mock('../right-sidebar/terminal/chrome', () => ({ TerminalPaneChrome: () => null }))
vi.mock('../shell/hooks/use-status-snapshot', () => ({ useStatusSnapshot: () => ({}) }))
vi.mock('../shell/hooks/use-statusbar-items', () => ({
  useStatusbarItems: () => ({ leftStatusbarItems: [], statusbarItems: [] })
}))
vi.mock('../shell/statusbar-controls', () => ({ StatusbarControls: () => null }))
vi.mock('../routes', () => ({
  contributedRoutes: () => [],
  NEW_CHAT_ROUTE: '/new',
  ROUTES_AREA: 'routes',
  sessionRoute: (id: string) => `/${id}`
}))
vi.mock('./latest-actions', () => ({ latestChatActions: () => ({}), latestSidebarActions: () => ({}) }))
vi.mock('./panes', () => ({ setStatusbarItemGroup: vi.fn(), useStatusbarContributions: () => [] }))
vi.mock('../shell/model-menu-panel', () => ({
  ModelMenuPanel: ({ ownerConnectionId }: { ownerConnectionId?: string }) => (
    <div data-testid="model-menu-owner">{ownerConnectionId}</div>
  )
}))
vi.mock('../shell/reasoning-menu-panel', () => ({ ReasoningMenuPanel: () => null }))

afterEach(() => {
  cleanup()
  $activeGatewayConnectionId.set(null)
  $gateway.set(null)
  $activeGatewayProfile.set('default')
})

describe('ChatRoutesSurface', () => {
  it('passes the live gateway after an open-to-open profile switch', () => {
    const gatewayA = { id: 'a' } as unknown as HermesGateway
    const gatewayB = { id: 'b' } as unknown as HermesGateway

    $gateway.set(gatewayA)
    const actions = { getGateway: () => $gateway.get() } as unknown as WiringActions

    render(
      <MemoryRouter>
        <ChatRoutesSurface actions={actions} />
      </MemoryRouter>
    )

    expect(screen.getByTestId('gateway').textContent).toBe('a')

    act(() => {
      $gateway.set(gatewayB)
      $activeGatewayProfile.set('other')
    })

    expect(screen.getByTestId('gateway').textContent).toBe('b')
  })

  it('routes the primary model menu through the active profile socket instead of its local descriptor alias', () => {
    $activeGatewayConnectionId.set(null)
    $gateway.set({ id: 'profile-only' } as unknown as HermesGateway)
    const actions = { getGateway: () => $gateway.get() } as unknown as WiringActions

    render(
      <MemoryRouter>
        <ChatRoutesSurface actions={actions} />
      </MemoryRouter>
    )

    expect(screen.getByTestId('model-menu-owner').textContent).toBe('')
    expect(screen.getByTestId('catalog-owner').textContent).toBe('')
  })
})
