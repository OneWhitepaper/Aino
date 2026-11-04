import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setApiRequestConnection } from '@/api/client'
import { ConfirmHost } from '@/components/confirm-host'
import { $confirmRequest } from '@/store/confirm'
import type { OAuthProvider } from '@/types/hermes'

import { ProvidersSettings } from './providers-settings'
import { ServiceAuthorization } from './service-authorization'

const listOAuthProviders = vi.fn()
const disconnectOAuthProvider = vi.fn()
const startManualProviderOAuth = vi.fn()
const runInTerminal = vi.fn()
const notify = vi.fn()
const notifyError = vi.fn()

vi.mock('@/hermes', () => ({
  setApiRequestProfile: vi.fn(),
  getProfiles: async () => ({ profiles: [] }),
  disconnectOAuthProvider: (...args: unknown[]) => disconnectOAuthProvider(...args),
  getEnvVars: async () => ({}),
  listOAuthProviders: (...args: unknown[]) => listOAuthProviders(...args)
}))

vi.mock('@/store/onboarding', () => ({
  $desktopOnboarding: atom({ manual: false }),
  startManualProviderOAuth: (...args: unknown[]) => startManualProviderOAuth(...args),
  startManualLocalEndpoint: vi.fn()
}))

vi.mock('@/app/right-sidebar/store', () => ({
  runInTerminal: (...args: unknown[]) => runInTerminal(...args)
}))

vi.mock('@/store/notifications', () => ({
  notify: (notification: unknown) => notify(notification),
  notifyError: (...args: unknown[]) => notifyError(...args)
}))

const COMMAND = 'Remove-Item -LiteralPath "$HOME/.external/credentials.json" -Force -ErrorAction Stop'

function connectedExternal(patch: Partial<OAuthProvider> = {}): OAuthProvider {
  return {
    cli_command: 'external login',
    disconnect_command: COMMAND,
    disconnectable: false,
    docs_url: '',
    flow: 'external',
    id: 'external-cli',
    name: 'External CLI',
    status: { logged_in: true },
    ...patch
  }
}

beforeEach(() => {
  setApiRequestConnection('local')
  listOAuthProviders.mockResolvedValue({ providers: [connectedExternal()] })
  disconnectOAuthProvider.mockResolvedValue({ ok: false, provider: 'nous' })
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: { terminal: {} }
  })
})

afterEach(() => {
  cleanup()
  $confirmRequest.set(null)
  setApiRequestConnection(null)
  vi.clearAllMocks()
})

async function renderAccounts() {
  await act(async () => {
    render(
      <>
        <ProvidersSettings onClose={vi.fn()} view="accounts" />
        <ConfirmHost />
      </>
    )
  })
}

describe('connected external provider row', () => {
  it('reads and starts service authorization on its captured connection and profile', async () => {
    const scope = { connectionId: 'research-box', profile: 'research' }
    listOAuthProviders.mockResolvedValue({ providers: [connectedExternal({ status: { logged_in: false } })] })
    render(<ServiceAuthorization profile={scope} />)

    fireEvent.click(await screen.findByRole('button', { name: /External CLI/ }))
    expect(listOAuthProviders).toHaveBeenCalledWith(expect.objectContaining(scope))
    expect(startManualProviderOAuth).toHaveBeenCalledWith('external-cli', expect.objectContaining(scope))
  })

  it('runs the terminal control as disconnect instead of starting sign-in', async () => {
    await renderAccounts()

    fireEvent.click(await screen.findByRole('button', { name: /Disconnect External CLI in terminal/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))

    await waitFor(() => expect(runInTerminal).toHaveBeenCalledWith(COMMAND, expect.any(Object)))
    expect(startManualProviderOAuth).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }))
    expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Account removed' }))
  })

  it('does not toast success when an API clear reports nothing was removed', async () => {
    listOAuthProviders.mockResolvedValue({
      providers: [
        {
          cli_command: 'hermes auth add nous',
          disconnectable: true,
          docs_url: '',
          flow: 'device_code',
          id: 'nous',
          name: 'Nous Portal',
          status: { logged_in: true }
        }
      ]
    })

    await renderAccounts()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Nous Portal' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))

    await waitFor(() => expect(disconnectOAuthProvider).toHaveBeenCalled())
    expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }))
    expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Account removed' }))
    expect(notifyError).toHaveBeenCalled()
  })
})

it('keeps a terminal disconnect on the confirmed provider owner after settings changes owner', async () => {
  const owner = { connectionId: 'research-box', profile: 'research' }

  const mount = render(
    <>
      <ServiceAuthorization profile={owner} />
      <ConfirmHost />
    </>
  )

  fireEvent.click(await screen.findByRole('button', { name: /Disconnect External CLI in terminal/ }))
  mount.rerender(
    <>
      <ServiceAuthorization profile={{ connectionId: 'other-box', profile: 'other' }} />
      <ConfirmHost />
    </>
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
  await waitFor(() => expect(runInTerminal).toHaveBeenCalledExactlyOnceWith(COMMAND, expect.objectContaining(owner)))
})
