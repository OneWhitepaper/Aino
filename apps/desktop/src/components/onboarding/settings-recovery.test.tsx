import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $notifications, clearNotifications } from '@/store/notifications'
import { $desktopOnboarding, requestDesktopOnboarding } from '@/store/onboarding'
import { markOnboardingDecided } from '@/store/onboarding-presence'
import { $routeRequest } from '@/store/recovery-requests'
import { makeOAuthProvider } from '@/test/oauth-provider'

import { DesktopOnboardingOverlay } from '.'

const requestGateway = (() => new Promise(() => {})) as never

beforeEach(() => {
  markOnboardingDecided()
  clearNotifications()
  $routeRequest.set(null)
  $desktopOnboarding.set({
    configured: false,
    flow: { status: 'idle' },
    mode: 'oauth',
    providers: [makeOAuthProvider('nous', 'Nous Portal')],
    reason: null,
    requested: false,
    firstRunSkipped: false,
    manual: false,
    localEndpoint: false,
    freeTierReady: false
  })
})

afterEach(() => {
  cleanup()
  clearNotifications()
  $routeRequest.set(null)
})

function Workspace() {
  return (
    <I18nProvider configClient={null} initialLocale="zh">
      <button type="button">工作区保持可用</button>
      <DesktopOnboardingOverlay enabled profile="default" requestGateway={requestGateway} />
    </I18nProvider>
  )
}

it('keeps the workspace available when startup has no configured provider', () => {
  render(<Workspace />)

  expect(screen.queryByText('Nous Portal')).toBeNull()
  expect(screen.getByRole('button', { name: '工作区保持可用' })).toBeTruthy()
  expect($desktopOnboarding.get().configured).toBe(false)
})

it('offers settings recovery at a credential failure without opening the legacy setup card', async () => {
  render(<Workspace />)
  act(() => requestDesktopOnboarding('No API key for custom provider Mock: OPENAI_API_KEY is not set'))

  expect(screen.queryByText('Nous Portal')).toBeNull()
  const notice = $notifications.get().find(row => row.id === 'provider-settings-required')

  expect(notice?.action?.label).toBe('打开设置')
  expect(notice?.message).not.toContain('OPENAI_API_KEY')
  await act(async () => {
    await notice?.action?.onClick()
  })
  expect(new URLSearchParams($routeRequest.get()?.path.split('?')[1]).get('tab')).toBe('config:model')
})

it('retains an explicitly opened provider authorization flow and its close action', () => {
  $desktopOnboarding.set({ ...$desktopOnboarding.get(), manual: true })
  render(<Workspace />)

  expect(screen.getByText('Nous Portal')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  expect(screen.queryByText('Nous Portal')).toBeNull()
})
