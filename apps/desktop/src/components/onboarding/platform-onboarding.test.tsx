import { useStore } from '@nanostores/react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { $activeGatewayRoute, setPrimaryGateway, setPrimaryGatewayConnectionId } from '@/store/gateway'
import { clearGatewayManagedCapabilities, recordGatewayReadyCapability } from '@/store/gateway-managed-capability'
import { $desktopOnboarding } from '@/store/onboarding'
import { markOnboardingDecided } from '@/store/onboarding-presence'
import { platformModelCatalog, requirePlatformSelection } from '@/store/platform-models'
import { $activeGatewayProfile } from '@/store/profile'
import { setConnection } from '@/store/session'
import { deferred } from '@/test/deferred'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import type { PlatformAccountSnapshot, PlatformModel } from '../../../shared/platform-contract'

import { DesktopOnboardingOverlay } from '.'

markOnboardingDecided()

const requestGateway = async <T,>(method: string): Promise<T> => {
  if (method === 'setup.status') {
    return { provider_configured: false } as T
  }

  if (method === 'setup.runtime_check') {
    return { ok: false, error: 'No inference provider is configured.' } as T
  }

  throw new Error(`Unexpected onboarding request: ${method}`)
}

function ActiveRouteOnboarding() {
  const profile = useStore($activeGatewayProfile)

  return <DesktopOnboardingOverlay enabled profile={profile} requestGateway={requestGateway} />
}

async function installAccount(list: () => Promise<PlatformModel[]>, initial = platformSnapshot()) {
  let changed!: (snapshot: PlatformAccountSnapshot) => void
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        status: async () => initial,
        capabilities: async () => ({}),
        onChanged: (listener: typeof changed) => {
          changed = listener

          return () => {}
        }
      },
      platformModels: { list }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  $desktopOnboarding.set({
    configured: false,
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

  return (snapshot: PlatformAccountSnapshot) => act(() => changed(snapshot))
}

afterEach(() => {
  cleanup()
  setPrimaryGateway(null, 'default')
  setPrimaryGatewayConnectionId(null)
  $activeGatewayRoute.set('default')
  $activeGatewayProfile.set('default')
  setConnection(null)
  clearGatewayManagedCapabilities()
  Reflect.deleteProperty(window, 'hermesDesktop')
  window.localStorage.clear()
  $desktopOnboarding.set({ ...$desktopOnboarding.get(), configured: null, manual: false })
})

it('follows the active socket capability when a fresh local workspace retains the local descriptor alias', async () => {
  await installAccount(async () => [platformModel()])
  const defaultGateway = { connectionState: 'open' }

  setPrimaryGateway(defaultGateway as never, 'default')
  setPrimaryGatewayConnectionId('local')
  $activeGatewayRoute.set('default')
  $activeGatewayProfile.set('default')
  setConnection({ connectionId: 'local', mode: 'local', profile: 'default' } as never)
  recordGatewayReadyCapability(
    { connectionId: 'local', profile: 'default' },
    { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
  )

  const view = render(<ActiveRouteOnboarding />)

  await waitFor(() => expect(view.container.childElementCount).toBe(0))

  const workspaceGateway = { connectionState: 'open' }

  act(() => {
    setPrimaryGateway(workspaceGateway as never, 'fixture-workspace')
    setPrimaryGatewayConnectionId(null)
    $activeGatewayRoute.set('fixture-workspace')
    $activeGatewayProfile.set('fixture-workspace')
    // The presentation descriptor keeps the registry's `local` alias even
    // though this legacy profile door is owned by a profile-only socket.
    setConnection({ connectionId: 'local', mode: 'local', profile: 'fixture-workspace' } as never)
  })

  expect(screen.getByRole('button', { name: "I'll choose a provider later" })).toBeTruthy()

  act(() =>
    recordGatewayReadyCapability(
      { profile: 'fixture-workspace' },
      { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
    )
  )

  await waitFor(() => expect(view.container.childElementCount).toBe(0))
  expect($desktopOnboarding.get().configured).toBe(false)
})

it('reveals the workspace when the exact backend becomes ready for an available platform model without marking BYOK configured', async () => {
  await installAccount(async () => [platformModel()])
  setPrimaryGateway({ connectionState: 'open' } as never, 'default')
  setPrimaryGatewayConnectionId('source-a')
  $activeGatewayRoute.set('default')

  const view = render(<DesktopOnboardingOverlay enabled profile="default" requestGateway={requestGateway} />)

  expect(screen.getByRole('button', { name: "I'll choose a provider later" })).toBeTruthy()

  act(() =>
    recordGatewayReadyCapability(
      { connectionId: 'source-b', profile: 'default' },
      { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
    )
  )
  expect(screen.getByRole('button', { name: "I'll choose a provider later" })).toBeTruthy()
  act(() =>
    recordGatewayReadyCapability(
      { connectionId: 'source-a', profile: 'default' },
      { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
    )
  )
  await waitFor(() => expect(view.container.childElementCount).toBe(0))
  expect($desktopOnboarding.get().configured).toBe(false)
  expect(window.localStorage.getItem('hermes-desktop-onboarded-v1')).toBeNull()
  expect(window.localStorage.getItem('hermes-onboarding-skipped-v1')).toBeNull()

  act(() => $desktopOnboarding.set({ ...$desktopOnboarding.get(), manual: true }))
  expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
})

it('does not adopt a late foreign catalog or treat an unavailable model as configured', async () => {
  let resolve!: (models: PlatformModel[]) => void
  let calls = 0

  const changeAccount = await installAccount(() => {
    calls += 1

    return calls === 1
      ? new Promise<PlatformModel[]>(done => {
          resolve = done
        })
      : Promise.resolve([{ ...platformModel(), state: 'insufficient_balance' }])
  })

  setPrimaryGateway({ connectionState: 'open' } as never, 'default')
  setPrimaryGatewayConnectionId('source-a')
  $activeGatewayRoute.set('default')
  recordGatewayReadyCapability(
    { connectionId: 'source-a', profile: 'default' },
    { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
  )
  render(<DesktopOnboardingOverlay enabled profile="default" requestGateway={requestGateway} />)
  await waitFor(() => expect(calls).toBe(1))
  changeAccount(platformSnapshot('user-b', 2))
  await act(async () => resolve([platformModel()]))
  await waitFor(() => expect(calls).toBe(2))
  expect(screen.getByRole('button', { name: "I'll choose a provider later" })).toBeTruthy()
  changeAccount({ ...platformSnapshot('user-b', 3), phase: 'signed_out', account: null })
  expect(screen.getByRole('button', { name: "I'll choose a provider later" })).toBeTruthy()
})

it('keeps a verified platform workspace reachable during offline recovery without enabling model selection or dismissing manual setup', async () => {
  const reloaded = deferred<PlatformModel[]>()
  let loads = 0
  const changeAccount = await installAccount(async () => (++loads === 1 ? [platformModel()] : reloaded.promise))
  setPrimaryGateway({ connectionState: 'open' } as never, 'default')
  setPrimaryGatewayConnectionId('source-a')
  recordGatewayReadyCapability(
    { connectionId: 'source-a', profile: 'default' },
    { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
  )
  const view = render(<DesktopOnboardingOverlay enabled profile="default" requestGateway={requestGateway} />)
  await waitFor(() => expect(view.container.childElementCount).toBe(0))

  const offline: PlatformAccountSnapshot = { ...platformSnapshot('user-a', 2), phase: 'offline' }
  changeAccount(offline)
  expect(view.container.childElementCount).toBe(0)
  expect(platformModelCatalog().state.get().models).toEqual([])
  expect(() => requirePlatformSelection(offline, [platformModel()], 'catalog-a', 'user-a')).toThrow()

  act(() => $desktopOnboarding.set({ ...$desktopOnboarding.get(), manual: true }))
  expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  act(() => $desktopOnboarding.set({ ...$desktopOnboarding.get(), manual: false }))
  expect(view.container.childElementCount).toBe(0)

  changeAccount({ ...platformSnapshot('user-a', 3), phase: 'loading' })
  expect(view.container.childElementCount).toBe(0)
  changeAccount(platformSnapshot('user-a', 4))
  expect(view.container.childElementCount).toBe(0)
  expect(platformModelCatalog().state.get().models).toEqual([])
  await act(async () => reloaded.resolve([platformModel()]))
  await waitFor(() => expect(view.container.childElementCount).toBe(0))
  expect($desktopOnboarding.get().configured).toBe(false)
  expect(window.localStorage.getItem('hermes-desktop-onboarded-v1')).toBeNull()

  changeAccount({ ...platformSnapshot('user-a', 5), phase: 'signed_out', account: null })
  expect(screen.getByRole('button', { name: "I'll choose a provider later" })).toBeTruthy()
})

it('never lends offline readiness to another identity, gateway route, unsupported owner, or account bridge', async () => {
  let catalogUnavailable = false
  let models = [platformModel()]

  const changeAccount = await installAccount(async () => {
    if (catalogUnavailable) {
      throw new Error('catalog_unavailable')
    }

    return models
  })

  setPrimaryGateway({ connectionState: 'open' } as never, 'default')
  setPrimaryGatewayConnectionId('source-a')
  recordGatewayReadyCapability(
    { connectionId: 'source-a', profile: 'default' },
    { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
  )
  const view = render(<DesktopOnboardingOverlay enabled profile="default" requestGateway={requestGateway} />)
  const picker = () => screen.getByRole('button', { name: "I'll choose a provider later" })
  let revision = 1
  const offline = (): PlatformAccountSnapshot => ({ ...platformSnapshot('user-a', ++revision), phase: 'offline' })

  const verifyAgain = async () => {
    changeAccount(platformSnapshot('user-a', ++revision))
    await waitFor(() => expect(view.container.childElementCount).toBe(0))
    changeAccount(offline())
    expect(view.container.childElementCount).toBe(0)
  }

  await waitFor(() => expect(view.container.childElementCount).toBe(0))
  await verifyAgain()
  changeAccount({ ...offline(), account: platformSnapshot('user-b').account })
  expect(picker()).toBeTruthy()
  changeAccount(offline())
  expect(picker()).toBeTruthy()

  await verifyAgain()
  act(() => setPrimaryGatewayConnectionId('source-b'))
  expect(picker()).toBeTruthy()
  act(() =>
    recordGatewayReadyCapability(
      { connectionId: 'source-b', profile: 'default' },
      { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
    )
  )
  expect(picker()).toBeTruthy()

  await verifyAgain()
  act(() =>
    recordGatewayReadyCapability(
      { connectionId: 'source-b', profile: 'default' },
      { type: 'gateway.ready', payload: {} }
    )
  )
  expect(picker()).toBeTruthy()
  act(() =>
    recordGatewayReadyCapability(
      { connectionId: 'source-b', profile: 'default' },
      { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
    )
  )
  expect(picker()).toBeTruthy()

  await verifyAgain()
  changeAccount({ ...offline(), mode: 'production' })
  expect(picker()).toBeTruthy()

  await verifyAgain()
  changeAccount({ ...offline(), phase: 'reauth_required' })
  expect(picker()).toBeTruthy()
  changeAccount(offline())
  expect(picker()).toBeTruthy()

  await verifyAgain()
  models = [{ ...platformModel(), state: 'insufficient_balance' }]
  changeAccount(platformSnapshot('user-a', ++revision))
  await waitFor(() => expect(picker()).toBeTruthy())
  changeAccount(offline())
  expect(picker()).toBeTruthy()
  models = [platformModel()]

  await verifyAgain()
  catalogUnavailable = true
  changeAccount(platformSnapshot('user-a', ++revision))
  await waitFor(() => expect(picker()).toBeTruthy())
  changeAccount(offline())
  expect(picker()).toBeTruthy()
  catalogUnavailable = false

  await verifyAgain()
  view.unmount()
  await installAccount(async () => [platformModel()], offline())
  render(<DesktopOnboardingOverlay enabled profile="default" requestGateway={requestGateway} />)
  expect(picker()).toBeTruthy()
})
