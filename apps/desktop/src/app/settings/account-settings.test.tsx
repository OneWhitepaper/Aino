import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPlatformAccountActions } from '@/api/platform'
import { AccountContext } from '@/app/account/account-context'
import { SidebarIdentityFooter } from '@/app/shell/sidebar-identity-footer'
import { I18nProvider } from '@/i18n'

import type { PlatformAccountBridge, PlatformAccountSnapshot } from '../../../shared/platform-contract'

import { AccountSettings } from './account-settings'

const original = {
  id: '17',
  phone_masked: '+86 138****8000',
  email: 'member@example.test',
  display_name: 'Original'
}

function snapshot(
  account: PlatformAccountSnapshot['account'] = original,
  phase: PlatformAccountSnapshot['phase'] = 'signed_in'
): PlatformAccountSnapshot {
  return {
    revision: 2,
    phase,
    account,
    mode: 'production',
    remember_state: 'encrypted',
    error: phase === 'offline' ? { code: 'network_unavailable' } : null
  }
}

function renderAccount(overrides: Partial<PlatformAccountBridge> = {}, current = snapshot()) {
  const bridge: PlatformAccountBridge = {
    status: vi.fn().mockResolvedValue(current),
    capabilities: vi.fn(),
    retry: vi.fn().mockResolvedValue(snapshot()),
    requestPhoneCode: vi.fn(),
    verifyPhoneCode: vi.fn(),
    loginExisting: vi.fn(),
    completeSecondFactor: vi.fn(),
    updateProfile: vi.fn().mockResolvedValue(current),
    requestBindingCode: vi.fn(),
    submitStepUp: vi.fn(),
    bindPhone: vi.fn(),
    logout: vi.fn(),
    onChanged: vi.fn(() => () => {}),
    ...overrides
  }

  const actions = createPlatformAccountActions(bridge)
  actions.state.set({
    ...actions.state.get(),
    authenticated: true,
    account: current.account,
    ready: true,
    phase: current.phase,
    error: current.error ? { code: current.error.code } : null
  })
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <AccountContext.Provider value={actions}>
        <AccountSettings />
        <MemoryRouter>
          <SidebarIdentityFooter />
        </MemoryRouter>
      </AccountContext.Provider>
    </I18nProvider>
  )

  return { actions, bridge }
}

afterEach(cleanup)

describe('platform account settings', () => {
  it('shows the canonical ID, masked phone and verified email from the safe profile', () => {
    renderAccount()

    expect(screen.getByText('17')).toBeTruthy()
    expect(screen.getByText('+86 138****8000')).toBeTruthy()
    expect(screen.getByText('member@example.test')).toBeTruthy()
  })

  it('saves the nickname through the platform username mapping and updates the sidebar', async () => {
    const updated = snapshot({ ...original, display_name: '小海盗 🏴‍☠️' })
    const updateProfile = vi.fn().mockResolvedValue(updated)
    const { bridge } = renderAccount({ updateProfile })

    fireEvent.click(screen.getByRole('button', { name: 'Edit nickname' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Nickname' }), { target: { value: '  小海盗 🏴‍☠️  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'My account · 小海盗 🏴‍☠️' })).toBeTruthy())
    expect(screen.getByText('小🏴')).toBeTruthy()
    expect(bridge.updateProfile).toHaveBeenCalledWith({ display_name: '小海盗 🏴‍☠️' })
    expect(screen.queryByRole('textbox', { name: 'Nickname' })).toBeNull()
  })

  it('keeps the saved identity on cancel or failure and allows retrying the draft', async () => {
    const error = Object.assign(new Error('network_unavailable'), { code: 'network_unavailable' })
    const { actions } = renderAccount({ updateProfile: vi.fn().mockRejectedValue(error) })

    fireEvent.click(screen.getByRole('button', { name: 'Edit nickname' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Nickname' }), { target: { value: 'Discard me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit nickname' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Nickname' }), { target: { value: 'Keep my draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByRole('alert')
    expect((screen.getByRole('textbox', { name: 'Nickname' }) as HTMLInputElement).value).toBe('Keep my draft')
    expect(actions.state.get().account).toEqual(original)
    expect(screen.getByRole('button', { name: 'My account · Original' })).toBeTruthy()
  })

  it('keeps the last verified profile visible offline and retries through the account owner', async () => {
    const retry = vi.fn().mockResolvedValue(snapshot())
    renderAccount({ retry }, snapshot(original, 'offline'))

    expect(screen.getByText('+86 138****8000')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(retry).toHaveBeenCalledOnce())
  })
})
