import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider, TRANSLATIONS } from '@/i18n'
import { stubResizeObserver } from '@/test/jsdom'

import type { PlatformPublicCapabilities } from '../../../shared/platform-contract'

import { AccountLoginCard } from './account-login-card'

const copy = TRANSLATIONS.zh.settings.account

const capabilities: PlatformPublicCapabilities = {
  desktop_api_version: 1,
  registration_enabled: true,
  registration_url: 'https://accounts.example.test/register',
  phone_login_enabled: true,
  phone_registration_enabled: true,
  phone_binding_enabled: true,
  phone_regions: ['CN'],
  phone_code_length: 6,
  invitation_code_enabled: false,
  promo_code_enabled: false,
  login_agreement_enabled: true,
  login_agreement_mode: 'checkbox',
  login_agreement_revision: 'terms-7',
  login_agreement_documents: [{ id: 'terms', title: '用户协议', content_md: '当前协议' }],
  captcha: { provider: 'disabled', site_key: '', scene_id: '', prefix: '', region: '' }
}

beforeEach(() => {
  stubResizeObserver()
  globalThis.document.documentElement.dataset.hermesDesktopHost = 'native'
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete globalThis.document.documentElement.dataset.hermesDesktopHost
})

function renderCard(overrides: Partial<ComponentProps<typeof AccountLoginCard>> = {}) {
  const props: ComponentProps<typeof AccountLoginCard> = {
    capabilities,
    error: null,
    loading: false,
    onRequestPhoneCode: vi.fn().mockResolvedValue({
      challenge_id: 'challenge-1',
      expires_in: 300,
      retry_after: 60,
      delivery: 'accepted'
    }),
    onVerifyPhoneCode: vi.fn().mockResolvedValue(null),
    onLoginExisting: vi.fn().mockResolvedValue(null),
    onCompleteSecondFactor: vi.fn().mockResolvedValue(null),
    ...overrides
  }

  const card = (value: ComponentProps<typeof AccountLoginCard>) => (
    <I18nProvider configClient={null} initialLocale="zh">
      <AccountLoginCard {...value} />
    </I18nProvider>
  )

  const view = render(card(props))

  return {
    props,
    rerenderCard: (next: Partial<ComponentProps<typeof AccountLoginCard>>) => view.rerender(card({ ...props, ...next }))
  }
}

describe('account login method navigation', () => {
  it('opens existing-account sign-in and returns to the preserved phone draft', async () => {
    const { props } = renderCard()
    fireEvent.change(screen.getByLabelText(copy.phoneLabel), { target: { value: '+8613800138000' } })

    fireEvent.click(screen.getByRole('button', { name: copy.existingAccount }))
    expect(screen.queryByLabelText(copy.phoneLabel)).toBeNull()
    fireEvent.change(screen.getByLabelText(copy.emailLabel), { target: { value: 'member@example.test' } })
    fireEvent.change(screen.getByLabelText(copy.passwordLabel), { target: { value: 'test-password' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: copy.continueExisting })))
    expect(props.onLoginExisting).toHaveBeenCalledWith({
      email: 'member@example.test',
      password: 'test-password',
      remember: true
    })
    expect(props.onRequestPhoneCode).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: copy.back }))
    expect((screen.getByLabelText(copy.phoneLabel) as HTMLInputElement).value).toBe('+8613800138000')
    expect(screen.queryByLabelText(copy.emailLabel)).toBeNull()
  })

  it('clears the phone agreement validation when changing to password sign-in', () => {
    const { props } = renderCard()
    fireEvent.change(screen.getByLabelText(copy.phoneLabel), { target: { value: '+8613800138000' } })
    fireEvent.click(screen.getByRole('button', { name: copy.sendCode }))
    expect(screen.getByRole('alert').textContent).toBe(copy.termsRequired)
    expect(props.onRequestPhoneCode).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: copy.existingAccount }))
    expect(screen.getByLabelText(copy.passwordLabel)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('dismisses the previous method authentication error without hiding a later failure', () => {
    const firstError = { code: 'invalid_credentials' }
    const { rerenderCard } = renderCard({ error: firstError })
    expect(screen.getByRole('alert').textContent).toBe(copy.platformError(firstError.code))

    fireEvent.click(screen.getByRole('button', { name: copy.existingAccount }))
    expect(screen.queryByRole('alert')).toBeNull()

    rerenderCard({ error: { code: 'invalid_credentials' } })
    expect(screen.getByRole('alert').textContent).toBe(copy.platformError('invalid_credentials'))
  })

  it('retains the account service failure while login capabilities are unavailable', () => {
    const error = { code: 'network_unavailable' }
    renderCard({ capabilities: null, error })
    expect(screen.getByRole('alert').textContent).toBe(copy.platformError(error.code))

    fireEvent.click(screen.getByRole('button', { name: copy.existingAccount }))
    expect(screen.getByLabelText(copy.emailLabel)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(copy.platformError(error.code))
  })

  it('waits for explicit capabilities before falling back from a disabled phone method', async () => {
    const { rerenderCard } = renderCard({ capabilities: null })
    expect(screen.getByLabelText(copy.phoneLabel)).toBeTruthy()
    expect(screen.queryByLabelText(copy.emailLabel)).toBeNull()

    rerenderCard({ capabilities: { ...capabilities, phone_login_enabled: false } })
    expect(await screen.findByLabelText(copy.emailLabel)).toBeTruthy()
    expect(screen.queryByLabelText(copy.phoneLabel)).toBeNull()
    expect(screen.getByLabelText(copy.passwordLabel)).toBeTruthy()
  })

  it.each(['phone', 'existing'] as const)(
    'keeps the current %s method while an authentication request is loading',
    method => {
      const { rerenderCard } = renderCard()

      if (method === 'existing') {
        fireEvent.click(screen.getByRole('button', { name: copy.existingAccount }))
      }

      rerenderCard({ loading: true })

      const switchMethod = screen.getByRole<HTMLButtonElement>('button', {
        name: method === 'phone' ? copy.existingAccount : copy.back
      })

      expect(switchMethod.disabled).toBe(true)
      fireEvent.click(switchMethod)

      expect(screen.getByLabelText(method === 'phone' ? copy.phoneLabel : copy.emailLabel)).toBeTruthy()
      expect(screen.queryByLabelText(method === 'phone' ? copy.emailLabel : copy.phoneLabel)).toBeNull()
    }
  )

  it('keeps the direct WeChat entry disabled while authentication is loading', () => {
    const { rerenderCard } = renderCard()
    const wechat = screen.getByRole<HTMLButtonElement>('button', { name: copy.switchWechat })

    rerenderCard({ loading: true })
    expect(wechat.disabled).toBe(true)
    fireEvent.click(wechat)
    expect(screen.getByLabelText(copy.phoneLabel)).toBeTruthy()
    expect(screen.queryByText(copy.wechatUnavailable)).toBeNull()
  })

  it('returns from phone second-factor verification to the same phone challenge and code', async () => {
    const { props } = renderCard({ onVerifyPhoneCode: vi.fn().mockResolvedValue({ status: 'requires_2fa' }) })
    fireEvent.change(screen.getByLabelText(copy.phoneLabel), { target: { value: '+8613800138000' } })
    fireEvent.click(screen.getByRole('checkbox', { name: copy.termsLabel }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: copy.sendCode })))
    fireEvent.change(await screen.findByLabelText(copy.codeLabel), { target: { value: '246810' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: copy.verify })))
    expect(await screen.findByLabelText(copy.totpLabel)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: copy.back }))
    expect((screen.getByLabelText(copy.codeLabel) as HTMLInputElement).value).toBe('246810')
    expect(screen.queryByLabelText(copy.emailLabel)).toBeNull()
    expect(screen.getByText('+8613800138000')).toBeTruthy()
    expect(props.onRequestPhoneCode).toHaveBeenCalledOnce()
    expect(props.onCompleteSecondFactor).not.toHaveBeenCalled()
  })
})
