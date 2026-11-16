import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { ApprovalModeMenu } from '@/app/chat/composer/approval-mode-menu'
import { StatusbarControls } from '@/app/shell/statusbar-controls'
import { $approvalModes, approvalModeForProfile, reconcileApprovalModeForProfile } from '@/store/approval-mode'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

import { useApprovalModeStatusbarItem } from './approval-mode-menu'

beforeAll(() => {
  stubResizeObserver()
  stubMenuDomApis()
})

afterEach(() => {
  cleanup()
  $approvalModes.set({})
})

function Harness({
  connectionId,
  gatewayState = 'open',
  profile = 'default',
  requestGateway
}: {
  connectionId?: null | string
  gatewayState?: string
  profile?: string
  requestGateway: (method: string, params?: Record<string, unknown>) => Promise<unknown>
}) {
  const item = useApprovalModeStatusbarItem(profile, requestGateway, gatewayState, undefined, connectionId)

  return (
    <MemoryRouter>
      <StatusbarControls items={[item]} />
    </MemoryRouter>
  )
}

describe('approval mode statusbar item', () => {
  it('shares the Bot owner approval mode across the shell and composer while keeping other connections separate', async () => {
    const requestGateway = vi.fn(async (_method, params) => ({ value: params?.value ?? 'off' }))
    reconcileApprovalModeForProfile('default', 'smart', 'studio')
    render(
      <>
        <section aria-label="Shell">
          <Harness connectionId="local" requestGateway={requestGateway} />
        </section>
        <section aria-label="Bot">
          <ApprovalModeMenu connectionId="local" profile="default" requestGateway={requestGateway} />
        </section>
      </>
    )

    const shell = within(screen.getByRole('region', { name: 'Shell' }))
    const bot = within(screen.getByRole('region', { name: 'Bot' }))
    await waitFor(() => {
      expect(shell.getByRole('button', { name: /do not ask/i })).toBeTruthy()
      expect(bot.getByRole('button', { name: /do not ask/i })).toBeTruthy()
    })

    fireEvent.pointerDown(bot.getByRole('button', { name: /do not ask/i }), { button: 0 })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /ask for approval/i }))
    await waitFor(() => expect(shell.getByRole('button', { name: /ask for approval/i })).toBeTruthy())

    fireEvent.pointerDown(shell.getByRole('button', { name: /ask for approval/i }), { button: 0 })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /approve for me/i }))
    await waitFor(() => expect(bot.getByRole('button', { name: /approve for me/i })).toBeTruthy())

    expect(approvalModeForProfile('default', 'local')).toBe('smart')
    expect(approvalModeForProfile('default', 'studio')).toBe('smart')
    expect(requestGateway).toHaveBeenCalledWith('config.set', {
      key: 'approvals.mode',
      value: 'manual',
      profile: 'default'
    })
  })

  it('writes the selected mode through the gateway and updates its shared trigger label', async () => {
    const requestGateway = vi.fn(async (_method, params) => ({ value: params?.value ?? 'smart' }))
    render(<Harness profile="work" requestGateway={requestGateway} />)

    fireEvent.pointerDown(screen.getByRole('button', { name: /approve for me/i }), { button: 0 })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /ask for approval/i }))

    await waitFor(() => {
      // The menu shows the "work" profile, so the write must name it (#125969); an unscoped
      // `config.set` would edit whichever profile the backend was launched with instead.
      expect(requestGateway).toHaveBeenCalledWith('config.set', {
        key: 'approvals.mode',
        value: 'manual',
        profile: 'work'
      })
      expect(screen.getByRole('button', { name: /ask for approval/i })).toBeTruthy()
    })
  })

  it('syncs once the gateway opens instead of sitting on the pre-sync default', async () => {
    // Boot order: the shell (and this chip) mount while the socket is still
    // connecting, so the sync must wait for 'open' — and then actually run.
    // A sync attempted while connecting rejects ("Hermes gateway
    // unavailable") and, swallowed, would leave the chip on its optimistic
    // 'smart' default for the whole session even though the configured mode
    // is 'off'.
    const requestGateway = vi.fn(async () => ({ value: 'off' }))

    const { rerender } = render(<Harness gatewayState="connecting" profile="boot" requestGateway={requestGateway} />)

    expect(requestGateway).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /approve for me/i })).toBeTruthy()

    rerender(<Harness gatewayState="open" profile="boot" requestGateway={requestGateway} />)

    await waitFor(() => {
      expect(requestGateway).toHaveBeenCalledWith('config.get', { key: 'approvals.mode', profile: 'boot' })
      expect(screen.getByRole('button', { name: /do not ask/i })).toBeTruthy()
    })
  })
})
