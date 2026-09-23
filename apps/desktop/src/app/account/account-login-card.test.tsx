import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { stubResizeObserver } from '@/test/jsdom'

import type { PlatformPublicCapabilities } from '../../../shared/platform-contract'

import { AccountLoginCard } from './account-login-card'

beforeEach(stubResizeObserver)

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
  login_agreement_documents: [{ id: 'terms', title: '用户协议', content_md: '最新协议内容' }],
  captcha: { provider: 'disabled', site_key: '', scene_id: '', prefix: '', region: '' }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function renderCard(overrides: Partial<React.ComponentProps<typeof AccountLoginCard>> = {}) {
  const props: React.ComponentProps<typeof AccountLoginCard> = {
    capabilities,
    error: null,
    fixedCodeHint: false,
    loading: false,
    onCompleteSecondFactor: vi.fn(),
    onLoginExisting: vi.fn(),
    onRequestPhoneCode: vi.fn().mockResolvedValue({
      challenge_id: 'challenge-1',
      expires_in: 300,
      retry_after: 60,
      delivery: 'accepted'
    }),
    onVerifyPhoneCode: vi.fn(),
    ...overrides
  }

  return {
    props,
    ...render(
      <I18nProvider configClient={null} initialLocale="zh">
        <AccountLoginCard {...props} />
      </I18nProvider>
    )
  }
}

describe('AccountLoginCard', () => {
  it('opens registration without signing in and keeps failed launches from masking later login attempts', async () => {
    const openExternal = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('Could not open browser'))

    vi.stubGlobal('hermesDesktop', { openExternal })
    const { props, rerender } = renderCard({ onRequestPhoneCode: vi.fn().mockResolvedValue(null) })
    expect(screen.getByText('未注册的手机号验证成功后将自动注册。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '注册账户' }))
    await screen.findByLabelText('邮箱')
    expect(openExternal).toHaveBeenCalledWith('https://accounts.example.test/register')
    expect(screen.getByText('注册完成后，使用同一邮箱和密码登录。网站与桌面共用一个账户。')).toBeTruthy()
    expect(props.onLoginExisting).not.toHaveBeenCalled()
    expect(props.onVerifyPhoneCode).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '注册账户' }))
    await screen.findByText('无法打开注册页面，请重试。')
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'member@example.test' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '继续' })))
    rerender(
      <I18nProvider configClient={null} initialLocale="zh">
        <AccountLoginCard {...props} error={{ code: 'invalid_credentials' }} />
      </I18nProvider>
    )
    expect(screen.getByRole('alert').textContent).toBe('邮箱或密码不正确。')
    expect(props.onLoginExisting).toHaveBeenCalledWith({
      email: 'member@example.test',
      password: 'password',
      remember: true
    })

    fireEvent.click(screen.getByRole('button', { name: '注册账户' }))
    await screen.findByText('无法打开注册页面，请重试。')
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(screen.queryByText('无法打开注册页面，请重试。')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '注册账户' }))
    await screen.findByText('无法打开注册页面，请重试。')
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '+8613800138000' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '同意用户协议和隐私政策' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送验证码' })))
    expect(props.onRequestPhoneCode).toHaveBeenCalledWith('+8613800138000')
    expect(screen.queryByText('无法打开注册页面，请重试。')).toBeNull()
  })

  it('honors closed registration and phone policies and hides website registration for the legacy adapter', () => {
    const openExternal = vi.fn()
    vi.stubGlobal('hermesDesktop', { openExternal })

    const { props, rerender } = renderCard({
      capabilities: {
        ...capabilities,
        registration_enabled: false,
        phone_login_enabled: false,
        phone_registration_enabled: false
      }
    })

    expect(screen.getByText('注册暂未开放。')).toBeTruthy()
    expect(screen.getByText('手机号登录暂未开放，请使用已有账户登录。')).toBeTruthy()
    expect(screen.queryByText('未注册的手机号验证成功后将自动注册。')).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '注册账户' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '注册账户' }))
    expect(openExternal).not.toHaveBeenCalled()

    rerender(
      <I18nProvider configClient={null} initialLocale="zh">
        <AccountLoginCard {...props} capabilities={capabilities} fixedCodeHint />
      </I18nProvider>
    )
    expect(screen.queryByRole('button', { name: '注册账户' })).toBeNull()
    expect(screen.queryByText('未注册的手机号验证成功后将自动注册。')).toBeNull()
  })

  it('starts with the phone flow and does not require an email address', () => {
    renderCard()

    expect(screen.getByText('AINO')).toBeTruthy()
    expect(screen.getByLabelText('手机号')).toBeTruthy()
    expect(screen.queryByLabelText('邮箱')).toBeNull()
    expect(screen.getByRole('button', { name: '发送验证码' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '已有账户登录' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '切换微信登录' })).toBeTruthy()
  })

  it('uses agreement, invitation and code-length policy for phone verification', async () => {
    const onVerifyPhoneCode = vi.fn().mockResolvedValue({ status: 'signed_in' })

    const { props } = renderCard({
      capabilities: { ...capabilities, invitation_code_enabled: true },
      onVerifyPhoneCode
    })

    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: ' +8613800138000 ' } })
    fireEvent.change(screen.getByLabelText('邀请码'), { target: { value: ' INVITE ' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '同意用户协议和隐私政策' }))
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))

    const code = await screen.findByLabelText('验证码')
    expect(props.onRequestPhoneCode).toHaveBeenCalledWith('+8613800138000')
    expect(code.getAttribute('maxlength')).toBe('6')
    fireEvent.change(code, { target: { value: '24a6810' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    expect(onVerifyPhoneCode).toHaveBeenCalledWith({
      phone: '+8613800138000',
      challenge_id: 'challenge-1',
      code: '246810',
      register_if_new: true,
      agreement_revision: 'terms-7',
      invitation_code: 'INVITE',
      remember: true
    })
  })

  it('opens current agreement content instead of a development placeholder', () => {
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: '用户协议' }))

    expect(screen.getByText('最新协议内容')).toBeTruthy()
  })

  it('continues an existing email account through TOTP without requesting a phone code', async () => {
    const onLoginExisting = vi.fn().mockResolvedValue({ status: 'requires_2fa' })
    const onCompleteSecondFactor = vi.fn().mockResolvedValue({ id: '17' })
    const { props } = renderCard({ onCompleteSecondFactor, onLoginExisting })

    fireEvent.click(screen.getByRole('button', { name: '已有账户登录' }))
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'member@example.test' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '继续' })))

    expect(props.onRequestPhoneCode).not.toHaveBeenCalled()
    expect(onLoginExisting).toHaveBeenCalledWith({
      email: 'member@example.test',
      password: 'password',
      remember: true
    })
    fireEvent.change(await screen.findByLabelText('TOTP 验证码'), { target: { value: '12 3456' } })
    fireEvent.click(screen.getByRole('button', { name: '验证' }))
    expect(onCompleteSecondFactor).toHaveBeenCalledWith('123456')
  })

  it('shows fixed-code wording only for the explicit legacy development adapter', () => {
    const { rerender } = renderCard()
    expect(screen.queryByText('开发测试：验证码 1234，不会发送短信或邮件。')).toBeNull()

    rerender(
      <I18nProvider configClient={null} initialLocale="zh">
        <AccountLoginCard
          capabilities={capabilities}
          fixedCodeHint
          onCompleteSecondFactor={vi.fn()}
          onLoginExisting={vi.fn()}
          onRequestPhoneCode={vi.fn()}
          onVerifyPhoneCode={vi.fn()}
        />
      </I18nProvider>
    )

    expect(screen.getByText('开发测试：验证码 1234，不会发送短信或邮件。')).toBeTruthy()
  })

  it('honors the server retry delay without expiring the current challenge', async () => {
    vi.useFakeTimers()
    renderCard()
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '+8613800138000' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '同意用户协议和隐私政策' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送验证码' })))
    await act(async () => vi.advanceTimersByTime(60_000))

    expect((screen.getByRole('button', { name: '重新发送' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByLabelText('验证码')).toBeTruthy()
  })

  it('keeps the unavailable WeChat route explicit', () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: '切换微信登录' }))

    expect(screen.getByText('微信登录')).toBeTruthy()
    expect(screen.getByText('微信登录暂未开放。')).toBeTruthy()
  })
})
