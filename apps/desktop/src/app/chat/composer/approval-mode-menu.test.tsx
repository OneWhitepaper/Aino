import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $approvalModes, type ApprovalMode } from '@/store/approval-mode'
import { $notifications, clearNotifications } from '@/store/notifications'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

import { ApprovalModeMenu } from './approval-mode-menu'

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
