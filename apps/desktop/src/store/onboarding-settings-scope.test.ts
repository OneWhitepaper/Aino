import { beforeEach, expect, it, vi } from 'vitest'

import { setApiRequestConnection, setApiRequestProfile } from '@/api/client'
import type { HermesConnection } from '@/global'
import { $activeConnectionId } from '@/store/connections'
import { $notifications, clearNotifications } from '@/store/notifications'
import { requestDesktopOnboarding } from '@/store/onboarding'
import { markOnboardingDecided } from '@/store/onboarding-presence'
import { $activeGatewayProfile } from '@/store/profile'
import { $routeRequest } from '@/store/recovery-requests'
import { $connection } from '@/store/session'
import { $settingsRequestProfile, $settingsScopeProfile, setSettingsScope } from '@/store/settings-scope'

const switches = vi.hoisted(() => ({ selectConnection: vi.fn() }))

vi.mock('@/store/connections', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  selectConnection: switches.selectConnection
}))

function activate(connectionId: string, profile: string) {
  $connection.set({ connectionId, profile, baseUrl: `http://${connectionId}.invalid` } as HermesConnection)
  $activeGatewayProfile.set(profile)
  setApiRequestConnection(connectionId)
  setApiRequestProfile(profile)
}

function recoveryAction() {
  requestDesktopOnboarding('No API key for provider')
  const action = $notifications.get().find(row => row.id === 'provider-settings-required')?.action

  expect(action).toBeTruthy()

  return action!
}

beforeEach(() => {
  markOnboardingDecided()
  clearNotifications()
  $routeRequest.set(null)
  activate('work', 'research')
  setSettingsScope('research')
  switches.selectConnection.mockReset()
  switches.selectConnection.mockImplementation(async (connectionId: string, options: { profile: string }) => {
    activate(connectionId, options.profile)
  })
})

it('returns to the failing owner and profile before opening the actual model settings scope', async () => {
  const action = recoveryAction()

  activate('personal', 'default')
  await action.onClick()

  expect(switches.selectConnection).toHaveBeenCalledWith('work', { profile: 'research' })
  expect($activeConnectionId.get()).toBe('work')
  expect($settingsScopeProfile.get()).toBe('research')
  expect($settingsRequestProfile.get()).toBe('research')
  expect($routeRequest.get()?.path).toBe('/settings?tab=config:model')
})

it('resets an unrelated settings override without switching an already active owner', async () => {
  const action = recoveryAction()

  setSettingsScope('another-profile')
  await action.onClick()

  expect(switches.selectConnection).not.toHaveBeenCalled()
  expect($settingsScopeProfile.get()).toBe('research')
  expect($settingsRequestProfile.get()).toBe('research')
  expect($routeRequest.get()?.path).toBe('/settings?tab=config:model')
})

it.each(['rejects', 'does not land'] as const)(
  'keeps the other owner settings closed when the requested switch %s',
  async outcome => {
    const action = recoveryAction()

    activate('personal', 'default')
    switches.selectConnection.mockImplementation(async () => {
      if (outcome === 'rejects') {
        throw new Error('Connection unavailable')
      }
    })
    await action.onClick()

    expect($routeRequest.get()).toBeNull()
    expect($activeConnectionId.get()).toBe('personal')
    expect($settingsScopeProfile.get()).toBe('default')
    expect($notifications.get().some(row => row.kind === 'error')).toBe(true)
  }
)
