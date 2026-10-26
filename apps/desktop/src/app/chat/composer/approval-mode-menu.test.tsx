import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $approvalModes } from '@/store/approval-mode'
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

    const trigger = screen.getByRole('button', { name: /approval mode.*smart/i })

    fireEvent.pointerDown(trigger, { button: 0 })

    expect(await screen.findByRole('menuitemradio', { name: /manual/i })).toBeTruthy()
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(screen.getByRole('menuitemradio', { name: /smart/i })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: /off/i })).toBeTruthy()
  })

  it('writes the selected mode through the gateway and updates its shared trigger label', async () => {
    const requestGateway = vi.fn(async (_method, params) => ({ value: params?.value ?? 'smart' }))
    render(<Harness profile="work" requestGateway={requestGateway} />)

    fireEvent.pointerDown(screen.getByRole('button', { name: /smart/i }), { button: 0 })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /manual/i }))

    await waitFor(() => {
      expect(requestGateway).toHaveBeenCalledWith('config.set', {
        key: 'approvals.mode',
        value: 'manual',
        profile: 'work'
      })
      expect(screen.getByRole('button', { name: /manual/i })).toBeTruthy()
    })
  })

  it('renders the shared trigger and menu in the active locale', async () => {
    const response = new Promise<never>(() => undefined)
    render(
      <I18nProvider configClient={null} initialLocale="ja">
        <Harness requestGateway={vi.fn(() => response)} />
      </I18nProvider>
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: /スマート/ }), { button: 0 })

    expect(await screen.findByText('必要な場合にのみ確認します')).toBeTruthy()
    expect(screen.getByText('承認プロンプトなしで実行します')).toBeTruthy()
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

    fireEvent.pointerDown(screen.getByRole('button', { name: /smart/i }), { button: 0 })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /manual/i }))

    await waitFor(() => {
      expect($approvalModes.get().work).toBe('smart')
      expect($notifications.get().some(item => item.kind === 'error' && item.message === 'Save failed')).toBe(true)
      expect((screen.getByRole('button', { name: /smart/i }) as HTMLButtonElement).disabled).toBe(false)
    })
  })

  it('keeps the mode accessible in compact layout and disables writes while disconnected', () => {
    const requestGateway = vi.fn()
    render(<ApprovalModeMenu compact disabled profile="work" requestGateway={requestGateway} />)

    const button = screen.getByRole('button', { name: /approval mode.*smart/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(requestGateway).not.toHaveBeenCalled()
  })
})
