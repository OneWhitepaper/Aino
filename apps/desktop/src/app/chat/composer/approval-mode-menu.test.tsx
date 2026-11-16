import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import {
  $approvalModes,
  type ApprovalMode,
  approvalModeForProfile,
  reconcileApprovalModeForProfile
} from '@/store/approval-mode'
import * as gateway from '@/store/gateway'
import { $notifications, clearNotifications } from '@/store/notifications'
import { $activeGatewayProfile } from '@/store/profile'
import { $gatewayState } from '@/store/session'
import { deferred } from '@/test/deferred'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

import { ApprovalModeMenu, ComposerApprovalMode } from './approval-mode-menu'
import { ComposerScopeProvider, MAIN_COMPOSER_SCOPE } from './scope'

beforeAll(() => {
  stubResizeObserver()
  stubMenuDomApis()
})

afterEach(() => {
  cleanup()
  $approvalModes.set({})
  clearNotifications()
})

function Harness({
  profile = 'default',
  requestGateway
}: {
  profile?: string
  requestGateway: (method: string, params?: Record<string, unknown>) => Promise<unknown>
}) {
  return <ApprovalModeMenu profile={profile} requestGateway={requestGateway} />
}

describe('composer approval mode', () => {
  it('routes a Bot tile approval change to its owning profile and connection without changing the active profile', async () => {
    const activeProfile = $activeGatewayProfile.get()
    const gatewayState = $gatewayState.get()

    const requestOwner = vi
      .spyOn(gateway, 'requestGatewayForAgent')
      .mockResolvedValueOnce({ value: 'smart' })
      .mockResolvedValue({ value: 'manual' })

    const requestActive = vi.spyOn(gateway, 'requestGatewayForProfile').mockResolvedValue({ value: 'off' })

    try {
      $activeGatewayProfile.set('main-user')
      $gatewayState.set('open')
      $approvalModes.set({ 'main-user': 'off' })
      render(
        <ComposerScopeProvider
          value={{ ...MAIN_COMPOSER_SCOPE, connectionId: 'remote-bots', profile: 'research', target: 'tile:research' }}
        >
          <ComposerApprovalMode />
        </ComposerScopeProvider>
      )

      await waitFor(() => {
        expect(requestOwner).toHaveBeenCalledWith('remote-bots', 'research', 'config.get', {
          key: 'approvals.mode',
          profile: 'research'
        })
      })
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Approval mode: Approve for me' }), { button: 0 })
      fireEvent.click(await screen.findByRole('menuitemradio', { name: /^Ask for approval/ }))

      await waitFor(() => {
        expect(requestOwner).toHaveBeenCalledWith('remote-bots', 'research', 'config.set', {
          key: 'approvals.mode',
          value: 'manual',
          profile: 'research'
        })
        expect(approvalModeForProfile('research', 'remote-bots')).toBe('manual')
      })
      expect(requestActive).not.toHaveBeenCalled()
      expect($approvalModes.get()['main-user']).toBe('off')
      expect($activeGatewayProfile.get()).toBe('main-user')
    } finally {
      cleanup()
      $activeGatewayProfile.set(activeProfile)
      $gatewayState.set(gatewayState)
      requestOwner.mockRestore()
      requestActive.mockRestore()
    }
  })

  it('keeps same-named Bot menus on different connections independent as concurrent reads and writes finish', async () => {
    const localRead = deferred<{ value: string }>()
    const studioRead = deferred<{ value: string }>()
    const localRequest = vi.fn().mockReturnValueOnce(localRead.promise).mockResolvedValue({ value: 'smart' })
    const studioRequest = vi.fn(() => studioRead.promise)
    reconcileApprovalModeForProfile('default', 'manual')

    render(
      <>
        <section aria-label="Local Bot">
          <ApprovalModeMenu connectionId="local" profile="default" requestGateway={localRequest} />
        </section>
        <section aria-label="Studio Bot">
          <ApprovalModeMenu connectionId="studio" profile="default" requestGateway={studioRequest} />
        </section>
      </>
    )

    const localMenu = within(screen.getByRole('region', { name: 'Local Bot' }))
    const studioMenu = within(screen.getByRole('region', { name: 'Studio Bot' }))
    await act(async () => studioRead.resolve({ value: 'off' }))
    expect(studioMenu.getByRole('button', { name: 'Approval mode: Do not ask' })).toBeTruthy()
    await act(async () => localRead.resolve({ value: 'manual' }))
    const trigger = localMenu.getByRole('button', { name: 'Approval mode: Ask for approval' })
    expect(studioMenu.getByRole('button', { name: 'Approval mode: Do not ask' })).toBeTruthy()

    fireEvent.pointerDown(trigger, { button: 0 })
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Approve for me/ }))
    await waitFor(() => {
      expect(localMenu.getByRole('button', { name: 'Approval mode: Approve for me' })).toBeTruthy()
    })

    expect(studioMenu.getByRole('button', { name: 'Approval mode: Do not ask' })).toBeTruthy()
    expect(approvalModeForProfile('default')).toBe('manual')
    expect(localRequest).toHaveBeenCalledWith('config.get', { key: 'approvals.mode', profile: 'default' })
    expect(studioRequest).toHaveBeenCalledWith('config.get', { key: 'approvals.mode', profile: 'default' })
    expect(localRequest).toHaveBeenCalledWith('config.set', {
      key: 'approvals.mode',
      value: 'smart',
      profile: 'default'
    })
    expect(studioRequest).toHaveBeenCalledOnce()
  })

  it('offers all existing approval modes from the composer menu', async () => {
    const response = new Promise<never>(() => undefined)
    render(<Harness requestGateway={vi.fn(() => response)} />)

    const trigger = screen.getByRole('button', { name: /approval mode.*approve for me/i })

    fireEvent.pointerDown(trigger, { button: 0 })

    expect(await screen.findByRole('menuitemradio', { name: /ask for approval/i })).toBeTruthy()
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(screen.getByRole('menuitemradio', { name: /approve for me/i })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: /do not ask/i })).toBeTruthy()
  })

  it.each<[ApprovalMode, string]>([
    ['manual', 'Ask for approval'],
    ['smart', 'Approve for me'],
    ['off', 'Do not ask']
  ])('writes %s through the existing profile configuration and updates the trigger', async (mode, label) => {
    const initialMode = mode === 'manual' ? 'smart' : 'manual'
    const requestGateway = vi.fn(async (_method, params) => ({ value: params?.value ?? initialMode }))
    render(<Harness profile="work" requestGateway={requestGateway} />)

    await waitFor(() => expect($approvalModes.get().work).toBe(initialMode))
    fireEvent.pointerDown(screen.getByRole('button', { name: /approval mode/i }), { button: 0 })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: new RegExp(`^${label}`) }))

    await waitFor(() => {
      expect(requestGateway).toHaveBeenCalledWith('config.set', { key: 'approvals.mode', value: mode, profile: 'work' })
      expect(screen.getByRole('button', { name: `Approval mode: ${label}` })).toBeTruthy()
    })
  })

  it('explains the three modes in Chinese and preserves the checked backend mode', async () => {
    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <Harness requestGateway={vi.fn(async () => ({ value: 'off' }))} />
      </I18nProvider>
    )

    const trigger = await screen.findByRole('button', { name: '审批模式：不再询问' })
    fireEvent.pointerDown(trigger, { button: 0 })

    expect(await screen.findByText('如何批准 Aino 的操作？')).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: /^请求批准/ }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('menuitemradio', { name: /^帮我批准/ }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('menuitemradio', { name: /^不再询问/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('直接执行，仍受系统权限与安全规则限制')).toBeTruthy()
  })

  it('keeps the last confirmed mode and surfaces a failed save', async () => {
    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'config.set') {
        throw new Error('Save failed')
      }

      return { value: 'smart' }
    })

    render(<Harness profile="work" requestGateway={requestGateway} />)
    await waitFor(() => expect($approvalModes.get().work).toBe('smart'))

    fireEvent.pointerDown(screen.getByRole('button', { name: /approve for me/i }), { button: 0 })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /ask for approval/i }))

    await waitFor(() => {
      expect($approvalModes.get().work).toBe('smart')
      expect($notifications.get().some(item => item.kind === 'error' && item.message === 'Save failed')).toBe(true)
      expect((screen.getByRole('button', { name: /approve for me/i }) as HTMLButtonElement).disabled).toBe(false)
    })
  })

  it('keeps the mode accessible in compact layout and disables writes while disconnected', () => {
    const requestGateway = vi.fn()
    render(<ApprovalModeMenu compact disabled profile="work" requestGateway={requestGateway} />)

    const button = screen.getByRole('button', { name: /approval mode.*approve for me/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(requestGateway).not.toHaveBeenCalled()
  })
})
