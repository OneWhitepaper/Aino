import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { setApiRequestLocalMode } from '@/api/client'
import { setPrimaryGatewayConnectionId } from '@/store/gateway'
import { $desktopOnboarding, requestDesktopOnboarding, resetBootRaceWindowForTests } from '@/store/onboarding'
import { markOnboardingDecided } from '@/store/onboarding-presence'

import { DesktopOnboardingOverlay } from '.'

const mocks = vi.hoisted(() => ({ ready: true, request: vi.fn() }))

vi.mock('@/store/gateway', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestGatewayForAgent: mocks.request
}))
vi.mock('./use-platform-onboarding', () => ({ usePlatformOnboardingReady: () => false }))

beforeEach(() => {
  markOnboardingDecided()
  resetBootRaceWindowForTests()
  setPrimaryGatewayConnectionId('local')
  setApiRequestLocalMode(true)
  mocks.ready = true
  mocks.request.mockImplementation(async (_connection: string, profile: string, method: string) => {
    const ready = profile === 'default' && mocks.ready

    if (method === 'setup.status') {
      return { provider_configured: ready }
    }

    if (method === 'setup.runtime_check') {
      return { ok: ready, error: ready ? undefined : 'No inference provider is configured.' }
    }

    if (method === 'free_tier.status') {
      return {}
    }

    return { ok: true }
  })
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      getConnectionFor: vi.fn(async () => ({ sharedPrimary: true })),
      getConnection: vi.fn(async () => ({ sharedPrimary: true })),
      api: vi.fn(async () => ({ providers: [] }))
    }
  })
  $desktopOnboarding.set({
    configured: null,
    freeTierReady: false,
    flow: { status: 'idle' },
    mode: 'oauth',
    providers: [],
    reason: null,
    requested: false,
    firstRunSkipped: false,
    manual: false,
    localEndpoint: false
  })
})

afterEach(() => {
  cleanup()
  setPrimaryGatewayConnectionId(null)
  setApiRequestLocalMode(false)
  Reflect.deleteProperty(window, 'hermesDesktop')
  window.localStorage.clear()
  vi.clearAllMocks()
})

const request = async () => ({}) as never

it('keeps a keyless bot passive and checks that bot only after an explicit chat request', async () => {
  const view = render(<DesktopOnboardingOverlay enabled profile="default" requestGateway={request} />)

  await waitFor(() => expect($desktopOnboarding.get().configured).toBe(true))
  expect(view.container.childElementCount).toBe(0)
  view.rerender(<DesktopOnboardingOverlay enabled profile="mail-assistant" requestGateway={request} />)

  await act(async () => {})
  expect(view.container.childElementCount).toBe(0)
  expect($desktopOnboarding.get().configured).toBe(true)
  expect(mocks.request.mock.calls.some(([, profile]) => profile === 'mail-assistant')).toBe(false)

  act(() => requestDesktopOnboarding('No inference provider is configured.'))
  await waitFor(() => expect($desktopOnboarding.get().configured).toBe(false))
  expect(view.container.childElementCount).toBe(0)
  expect(mocks.request).toHaveBeenCalledWith('local', 'mail-assistant', 'setup.runtime_check', {
    profile: 'mail-assistant'
  })
})

it('keeps the workspace available on first run when the default has no provider', async () => {
  mocks.ready = false
  const view = render(<DesktopOnboardingOverlay enabled profile="default" requestGateway={request} />)

  await waitFor(() => expect($desktopOnboarding.get().configured).toBe(false))
  expect(view.container.childElementCount).toBe(0)
  expect($desktopOnboarding.get().configured).toBe(false)
  expect(mocks.request).toHaveBeenCalledWith('local', 'default', 'setup.runtime_check', { profile: 'default' })
})

it('keeps a local profile-only bot from replacing first-run readiness with its missing credential', async () => {
  const view = render(<DesktopOnboardingOverlay enabled profile="default" requestGateway={request} />)

  await waitFor(() => expect($desktopOnboarding.get().configured).toBe(true))
  setPrimaryGatewayConnectionId(null)
  view.rerender(<DesktopOnboardingOverlay enabled profile="mail-assistant" requestGateway={request} />)
  await act(async () => {})

  expect(view.container.childElementCount).toBe(0)
  expect(mocks.request).toHaveBeenCalledWith(null, 'default', 'setup.runtime_check', { profile: 'default' })
})
