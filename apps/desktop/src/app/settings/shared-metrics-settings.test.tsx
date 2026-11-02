// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setDesktopMetricsGate } from '@/store/desktop-metrics'
import type * as GatewayStore from '@/store/gateway'
import { $activeGatewayProfile } from '@/store/profile'
import { $connection } from '@/store/session'
import { $settingsScopeOverride } from '@/store/settings-scope'
import type { SharedMetricsConsent } from '@/store/shared-metrics'

const requestGatewayForAgent = vi.fn()

// The real gateway store, with only the per-agent request routed to the fake backend below.
vi.mock('@/store/gateway', async importOriginal => ({
  ...(await importOriginal<typeof GatewayStore>()),
  requestGatewayForAgent: (...args: unknown[]) => requestGatewayForAgent(...args)
}))
vi.mock('@/store/desktop-metrics', () => ({ recordOnboarding: vi.fn(), setDesktopMetricsGate: vi.fn() }))

const { en } = await import('@/i18n/en')
const { SharedMetricsSettings } = await import('./shared-metrics-settings')

const copy = en.sharedMetrics

function backend(initial: SharedMetricsConsent) {
  let stored = initial

  requestGatewayForAgent.mockImplementation(
    async (_connection: unknown, _profile: unknown, method: string, params: Record<string, unknown> = {}) => {
      if (method === 'shared_metrics.set') {
        const enabled = params.enabled === true
        stored = { enabled, send: enabled && params.send === true, decided: true, recipient: 'aino' }
      }

      return stored
    }
  )
}

const setCalls = () =>
  requestGatewayForAgent.mock.calls
    .filter(call => call[2] === 'shared_metrics.set')
    .map(call => ({ enabled: call[3].enabled, send: call[3].send }))

afterEach(() => {
  cleanup()
  requestGatewayForAgent.mockReset()
  vi.mocked(setDesktopMetricsGate).mockClear()
  $activeGatewayProfile.set('default')
  $settingsScopeOverride.set(null)
  $connection.set(null)
})

describe('SharedMetricsSettings', () => {
  it('is one switch: on shares (both opt-ins), off clears both', async () => {
    backend({ enabled: false, send: false, decided: true, recipient: 'aino' })

    render(<SharedMetricsSettings />)

    const share = await screen.findByRole('switch', { name: copy.sendLabel })
    await waitFor(() => expect(share.hasAttribute('disabled')).toBe(false))
    expect(screen.getAllByRole('switch')).toHaveLength(1)
    expect(share.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(share)
    await waitFor(() => expect(share.getAttribute('aria-checked')).toBe('true'))

    fireEvent.click(share)
    await waitFor(() => expect(share.getAttribute('aria-checked')).toBe('false'))

    expect(setCalls()).toEqual([
      { enabled: true, send: true },
      { enabled: false, send: false }
    ])
  })

  it('reads a retired collect-only answer as not sharing', async () => {
    backend({ enabled: true, send: false, decided: true, recipient: 'aino' })

    render(<SharedMetricsSettings />)

    const share = await screen.findByRole('switch', { name: copy.sendLabel })
    await waitFor(() => expect(share.hasAttribute('disabled')).toBe(false))
    expect(share.getAttribute('aria-checked')).toBe('false')
  })

  it('ignores a delayed consent save after the settings profile changes', async () => {
    $activeGatewayProfile.set('default')
    let finishSave!: (consent: SharedMetricsConsent) => void
    requestGatewayForAgent.mockImplementation(async (_connection: unknown, _profile: unknown, method: string) => {
      if (method === 'shared_metrics.set') {
        return await new Promise<SharedMetricsConsent>(resolve => {
          finishSave = resolve
        })
      }

      return { enabled: false, send: false, decided: true, recipient: 'aino' }
    })
    render(<SharedMetricsSettings />)
    const share = await screen.findByRole('switch', { name: copy.sendLabel })
    await waitFor(() => expect(share.hasAttribute('disabled')).toBe(false))
    fireEvent.click(share)
    await waitFor(() => expect(setCalls()).toHaveLength(1))

    act(() => $settingsScopeOverride.set('other-profile'))
    await waitFor(() => expect(share.getAttribute('aria-checked')).toBe('false'))
    await act(async () => finishSave({ enabled: true, send: true, decided: true, recipient: 'aino' }))

    expect(share.getAttribute('aria-checked')).toBe('false')
    expect(share.hasAttribute('disabled')).toBe(false)
    expect(setDesktopMetricsGate).not.toHaveBeenCalled()
  })

  it.each(['profile', 'connection'] as const)('keeps a new %s save busy when the old save fails', async owner => {
    let failOldSave!: (error: Error) => void
    let finishNewSave!: (consent: SharedMetricsConsent) => void
    let saveCount = 0
    requestGatewayForAgent.mockImplementation(async (_connection: unknown, _profile: unknown, method: string) => {
      if (method === 'shared_metrics.set') {
        saveCount += 1

        return saveCount === 1
          ? await new Promise((_resolve, reject) => {
              failOldSave = reject
            })
          : await new Promise<SharedMetricsConsent>(resolve => {
              finishNewSave = resolve
            })
      }

      return { enabled: false, send: false, decided: true, recipient: 'aino' }
    })
    render(<SharedMetricsSettings />)
    const share = await screen.findByRole('switch', { name: copy.sendLabel })
    await waitFor(() => expect(share.hasAttribute('disabled')).toBe(false))
    fireEvent.click(share)
    await waitFor(() => expect(setCalls()).toHaveLength(1))

    act(() => {
      if (owner === 'profile') {
        $settingsScopeOverride.set('other-profile')
      } else {
        $connection.set({ connectionId: 'other-connection', mode: 'local' } as never)
      }
    })
    await waitFor(() => {
      expect(share.getAttribute('aria-checked')).toBe('false')
      expect(share.hasAttribute('disabled')).toBe(false)
    })
    fireEvent.click(share)
    await waitFor(() => expect(setCalls()).toHaveLength(2))
    await act(async () => failOldSave(new Error('previous owner save failed')))

    expect(share.getAttribute('aria-checked')).toBe('true')
    expect(share.hasAttribute('disabled')).toBe(true)
    expect(setDesktopMetricsGate).not.toHaveBeenCalled()

    await act(async () => finishNewSave({ enabled: true, send: true, decided: true, recipient: 'aino' }))
    expect(share.hasAttribute('disabled')).toBe(false)
  })

  it('disables the previous consent while reading a different connection', async () => {
    backend({ enabled: true, send: true, decided: true, recipient: 'aino' })
    render(<SharedMetricsSettings />)
    const share = await screen.findByRole('switch', { name: copy.sendLabel })
    await waitFor(() => expect(share.hasAttribute('disabled')).toBe(false))
    requestGatewayForAgent.mockImplementation(() => new Promise(() => {}))

    act(() => $connection.set({ connectionId: 'other-connection', mode: 'local' } as never))

    expect(share.hasAttribute('disabled')).toBe(true)
    expect(share.getAttribute('aria-checked')).toBe('false')
    expect(setCalls()).toHaveLength(0)
  })
})
