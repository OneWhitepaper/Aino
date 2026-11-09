import { afterEach, expect, it, vi } from 'vitest'

import { WEBAPP_LAUNCH_REQUIRED } from '@/lib/browser-launch-session'
import { $primaryGatewayRoute } from '@/store/gateway-primary-route'
import { $notifications, clearNotifications } from '@/store/notifications'

import { notifyPrimaryReauth } from './primary-reauth-notice'

const state = vi.hoisted(() => ({ active: true, failDesktopBoot: vi.fn() }))

vi.mock('@/store/gateway', async importOriginal => ({
  ...(await importOriginal<object>()),
  isActivePrimary: () => state.active
}))

vi.mock('@/store/boot', async importOriginal => ({
  ...(await importOriginal<object>()),
  failDesktopBoot: state.failDesktopBoot
}))

afterEach(() => {
  clearNotifications()
  state.active = true
  state.failDesktopBoot.mockReset()
  $primaryGatewayRoute.set({ connectionId: null, mode: null })
})

const errorToasts = () => $notifications.get().filter(entry => entry.kind === 'error')

it('leaves a signed-out Webapp tab to its sign-in view, with no toast', () => {
  // A toast about a remote session would be wrong there, and screen readers announce it behind the view.
  notifyPrimaryReauth(WEBAPP_LAUNCH_REQUIRED, () => WEBAPP_LAUNCH_REQUIRED)

  expect(errorToasts()).toEqual([])
})

it('hands a foreground sign-in to the boot overlay with the error current at the click', () => {
  notifyPrimaryReauth('Your remote gateway session has expired.', () => 'latest error')
  const [toast] = errorToasts()

  expect(toast.detail).toBe('Your remote gateway session has expired.')
  toast.action?.onClick()
  expect(state.failDesktopBoot).toHaveBeenCalledWith('latest error')
})

it('offers Gateways settings to a parked background primary, whatever the error', () => {
  state.active = false

  for (const detail of [WEBAPP_LAUNCH_REQUIRED, 'Your remote gateway session has expired.']) {
    notifyPrimaryReauth(detail, () => detail)
  }

  expect(errorToasts().map(toast => toast.action?.label)).toEqual(['Open Gateways', 'Open Gateways'])
})

it('replaces repeated sign-in failures for the same primary connection with its latest detail', () => {
  $primaryGatewayRoute.set({ connectionId: 'remote-a', mode: 'remote' })
  notifyPrimaryReauth('First ticket expired', () => 'First ticket expired')
  notifyPrimaryReauth('Latest ticket expired', () => 'Latest ticket expired')

  expect(errorToasts()).toHaveLength(1)
  expect(errorToasts()[0].detail).toBe('Latest ticket expired')
})

it('keeps sign-in failures from distinct primary connections separate', () => {
  state.active = false
  $primaryGatewayRoute.set({ connectionId: 'remote-a', mode: 'remote' })
  notifyPrimaryReauth('Connection A expired', () => 'Connection A expired')
  $primaryGatewayRoute.set({ connectionId: 'remote-b', mode: 'remote' })
  notifyPrimaryReauth('Connection B expired', () => 'Connection B expired')

  expect(errorToasts().map(toast => toast.detail)).toEqual(['Connection B expired', 'Connection A expired'])
  expect(new Set(errorToasts().map(toast => toast.id)).size).toBe(2)
})
