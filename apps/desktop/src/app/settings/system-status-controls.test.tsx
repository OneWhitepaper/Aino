import type { ConnectionState } from '@hermes/shared'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeReadinessResult } from '@/lib/runtime-readiness'
import { $gatewayState } from '@/store/session'
import { $gatewayRestarting } from '@/store/system-actions'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

import { SettingsSystemControls } from './system-status-controls'

const mocks = vi.hoisted(() => ({
  openSystem: vi.fn(),
  openCommandCenter: vi.fn(),
  requestGateway: vi.fn(),
  inferenceStatus: null as RuntimeReadinessResult | null
}))

vi.mock('@/app/shell/gateway-menu-panel', () => ({
  GatewayMenuPanel: ({ onOpenSystem }: { onOpenSystem: () => void }) => (
    <button onClick={onOpenSystem} type="button">
      Open system panel
    </button>
  )
}))

vi.mock('@/app/shell/hooks/use-status-snapshot', () => ({
  useStatusSnapshot: () => ({
    inferenceStatus: mocks.inferenceStatus,
    statusSnapshot: null
  })
}))

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      common: { loading: 'Loading' },
      shell: {
        gatewayMenu: {
          checkingInference: 'Checking inference',
          connected: 'Connected',
          connecting: 'Connecting',
          disconnected: 'Disconnected',
          inferenceNotReady: 'Inference not ready',
          inferenceReady: 'Inference ready',
          messagingPlatforms: 'Messaging platforms',
          offline: 'Offline',
          openSystem: 'Open system panel',
          recentActivity: 'Recent activity',
          reconnectGateway: 'Reconnect gateway',
          state: (state: string) => state,
          viewAllLogs: 'View all logs'
        },
        statusbar: {
          gateway: 'Gateway',
          gatewayChecking: 'checking',
          gatewayConnecting: 'connecting',
          gatewayNeedsSetup: 'needs setup',
          gatewayOffline: 'offline',
          gatewayReady: 'ready',
          gatewayRestarting: 'restarting…',
          gatewayUnavailable: 'inference unavailable',
          openCommandCenter: 'Open Command Center'
        }
      }
    }
  })
}))

vi.mock('@/store/connections', async () => {
  const { atom } = await import('nanostores')

  return { $activeConnectionId: atom('local') }
})

vi.mock('@/store/profile', async () => {
  const { atom } = await import('nanostores')

  return { $activeGatewayProfile: atom('default') }
})

vi.mock('@/store/session', async () => {
  const { atom } = await import('nanostores')

  return { $gatewayState: atom('open') }
})

vi.mock('@/store/system-actions', async () => {
  const { atom } = await import('nanostores')

  return { $gatewayRestarting: atom(false) }
})

interface RuntimeStatusCase {
  state: ConnectionState
  status: RuntimeReadinessResult | null
  restarting: boolean
  label: string
}

beforeAll(() => {
  stubMenuDomApis()
  stubResizeObserver()
})

beforeEach(() => {
  mocks.openSystem.mockReset()
  mocks.openCommandCenter.mockReset()
  mocks.requestGateway.mockReset()
  mocks.inferenceStatus = { checksDisagree: false, ready: true, reason: null, source: 'runtime_check' }
  $gatewayState.set('open')
  $gatewayRestarting.set(false)
})

afterEach(() => cleanup())

describe('SettingsSystemControls', () => {
  it('places concise runtime status before the icon-only command center action', () => {
    render(
      <SettingsSystemControls
        onOpenCommandCenter={mocks.openCommandCenter}
        onOpenCommandCenterSection={mocks.openSystem}
        requestGateway={mocks.requestGateway}
      />
    )

    const [runtime, commandCenter] = screen.getAllByRole('button')

    expect(runtime.getAttribute('aria-label')).toBe('Gateway: ready')
    expect(runtime.textContent).toBe('ready')
    expect(commandCenter.getAttribute('aria-label')).toBe('Open Command Center')
    expect(commandCenter.textContent).toBe('')

    fireEvent.click(commandCenter)

    expect(mocks.openCommandCenter).toHaveBeenCalledOnce()
  })

  it('explains the icon-only command center action on hover', async () => {
    render(
      <SettingsSystemControls
        onOpenCommandCenter={mocks.openCommandCenter}
        onOpenCommandCenterSection={mocks.openSystem}
        requestGateway={mocks.requestGateway}
      />
    )

    fireEvent.pointerMove(screen.getByRole('button', { name: 'Open Command Center' }), { pointerType: 'mouse' })

    expect((await screen.findByRole('tooltip')).textContent).toBe('Open Command Center')
  })

  it('shows gateway readiness and routes the system action through the shared menu', async () => {
    render(
      <SettingsSystemControls
        onOpenCommandCenter={mocks.openCommandCenter}
        onOpenCommandCenterSection={mocks.openSystem}
        requestGateway={mocks.requestGateway}
      />
    )

    expect(screen.getByRole('button', { name: 'Gateway: ready' })).toBeTruthy()

    const gateway = screen.getByRole('button', { name: 'Gateway: ready' })
    fireEvent.pointerDown(gateway, { button: 0, pointerType: 'mouse' })
    fireEvent.click(gateway)

    const menu = await screen.findByRole('menu')

    expect(menu.getAttribute('data-side')).toBe('bottom')
    expect(menu.getAttribute('data-align')).toBe('end')

    fireEvent.click(await screen.findByRole('button', { name: 'Open system panel' }))

    expect(mocks.openSystem).toHaveBeenCalledOnce()
    expect(mocks.openSystem).toHaveBeenCalledWith('system')
  })

  it.each<RuntimeStatusCase>([
    { state: 'open', status: null, restarting: false, label: 'checking' },
    {
      state: 'open',
      status: { checksDisagree: false, ready: false, reason: 'Missing credentials', source: 'setup_status' },
      restarting: false,
      label: 'needs setup'
    },
    {
      state: 'open',
      status: { checksDisagree: true, ready: false, reason: 'Provider unavailable', source: 'runtime_check' },
      restarting: false,
      label: 'inference unavailable'
    },
    {
      state: 'closed',
      status: { checksDisagree: false, ready: true, reason: null, source: 'runtime_check' },
      restarting: false,
      label: 'offline'
    },
    { state: 'connecting', status: null, restarting: false, label: 'connecting' },
    {
      state: 'open',
      status: { checksDisagree: false, ready: true, reason: null, source: 'runtime_check' },
      restarting: true,
      label: 'restarting…'
    }
  ])('preserves the visible $label status and its full accessible name', ({ state, status, restarting, label }) => {
    mocks.inferenceStatus = status
    $gatewayState.set(state)
    $gatewayRestarting.set(restarting)

    render(
      <SettingsSystemControls
        onOpenCommandCenter={mocks.openCommandCenter}
        onOpenCommandCenterSection={mocks.openSystem}
        requestGateway={mocks.requestGateway}
      />
    )

    const runtime = screen.getByRole('button', { name: `Gateway: ${label}` })

    expect(runtime.textContent).toBe(label)
    expect(screen.queryByRole('button', { name: 'Gateway: ready' })).toBeNull()
  })
})
