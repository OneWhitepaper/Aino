import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createPlatformAccountActions } from '@/api/platform'
import { HermesGateway } from '@/hermes'
import { I18nProvider } from '@/i18n'
import { setPrimaryGateway, setPrimaryGatewayConnection } from '@/store/gateway'
import { $gatewayState, setConnection, setGatewayState } from '@/store/session'
import { stubResizeObserver } from '@/test/jsdom'

import type {
  PlatformAccountBridge,
  PlatformAccountSnapshot,
  PlatformPublicCapabilities
} from '../../../shared/platform-contract'

import { AccountFlow, AccountGate, shouldGatePlatformAccount } from './account-gate'

stubResizeObserver()

const capabilities: PlatformPublicCapabilities = {
  desktop_api_version: 1,
  registration_enabled: true,
  phone_login_enabled: true,
  phone_registration_enabled: true,
  phone_binding_enabled: true,
  phone_regions: ['CN'],
  phone_code_length: 6,
  invitation_code_enabled: false,
  promo_code_enabled: false,
  login_agreement_enabled: false,
  login_agreement_mode: '',
  login_agreement_revision: '',
  login_agreement_documents: [],
  captcha: { provider: 'disabled', site_key: '', scene_id: '', prefix: '', region: '' }
}

function snapshot(
  phase: PlatformAccountSnapshot['phase'],
  account: PlatformAccountSnapshot['account'] = null
): PlatformAccountSnapshot {
  return {
    revision: 1,
    phase,
    account,
    mode: 'development',
    remember_state: 'session_only',
    error: null
  }
}

function bridge(current: PlatformAccountSnapshot) {
  const value: PlatformAccountBridge = {
    status: vi.fn().mockResolvedValue(current),
    capabilities: vi.fn().mockResolvedValue(capabilities),
    retry: vi.fn().mockResolvedValue(current),
    requestPhoneCode: vi.fn(),
    verifyPhoneCode: vi.fn(),
    loginExisting: vi.fn(),
    completeSecondFactor: vi.fn(),
    updateProfile: vi.fn(),
    requestBindingCode: vi.fn(),
    submitStepUp: vi.fn(),
    bindPhone: vi.fn(),
    logout: vi.fn(),
    onChanged: vi.fn(() => () => {})
  }

  return value
}

function renderFlow(actions: ReturnType<typeof createPlatformAccountActions>, child = <p>Workspace</p>) {
  return render(
    <I18nProvider configClient={null} initialLocale="zh">
      <MemoryRouter>
        <AccountFlow actions={actions}>{child}</AccountFlow>
      </MemoryRouter>
    </I18nProvider>
  )
}

beforeEach(() => {
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      ...(window.hermesDesktop ?? {}),
      accountAdapter: 'platform',
      setAccountWindowMode: vi.fn().mockResolvedValue(true)
    }
  })
})

afterEach(() => {
  cleanup()
  setPrimaryGateway(null)
  setConnection(null)
  setGatewayState('idle')
})

describe('standalone Aino account flow', () => {
  it('initializes legacy account policy only after its gateway opens', async () => {
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: { ...window.hermesDesktop, accountAdapter: 'legacy-development' }
    })
    const gateway = new HermesGateway()

    const request = vi.spyOn(gateway, 'request').mockImplementation(async () => {
      if ($gatewayState.get() !== 'open') {
        throw new Error('Gateway not connected')
      }

      return { authenticated: false, account: null }
    })

    setPrimaryGateway(gateway)
    setPrimaryGatewayConnection({ connectionId: 'local' })
    setConnection({ connectionId: 'local' } as never)
    setGatewayState('connecting')

    render(
      <I18nProvider configClient={null} initialLocale="en">
        <MemoryRouter>
          <AccountGate>
            <p>Workspace</p>
          </AccountGate>
        </MemoryRouter>
      </I18nProvider>
    )
    await act(async () => {})
    expect(request).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()

    await act(async () => setGatewayState('open'))

    const agreement = await screen.findByRole('checkbox', {
      name: 'Agree to the user agreement and privacy policy'
    })

    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '+8613800138000' } })
    fireEvent.click(agreement)
    expect((screen.getByRole('button', { name: 'Send code' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(request).toHaveBeenCalledWith('account.status', {})
  })

  it('preserves a mounted draft and attachments through the separate login window', async () => {
    const account = { id: 'a', display_name: 'A', phone_masked: '', email: '' }
    const platformBridge = bridge(snapshot('signed_in', account))
    const actions = createPlatformAccountActions(platformBridge)
    const shortcut = vi.fn()

    function Draft() {
      useEffect(() => {
        window.addEventListener('keydown', shortcut)

        return () => window.removeEventListener('keydown', shortcut)
      }, [])

      return (
        <div>
          <div aria-label="Draft" contentEditable role="textbox" suppressContentEditableWarning tabIndex={0} />
          <input aria-label="Attachments" type="file" />
        </div>
      )
    }

    renderFlow(actions, <Draft />)
    const draft = await screen.findByRole('textbox', { name: 'Draft' })
    draft.focus()
    expect(window.document.activeElement).toBe(draft)
    draft.textContent = 'Unsent project work'
    fireEvent.input(draft)
    const attachment = screen.getByLabelText('Attachments') as HTMLInputElement
    const file = new File(['notes'], 'notes.md')
    fireEvent.change(attachment, { target: { files: [file] } })
    const changed = vi.mocked(platformBridge.onChanged).mock.calls[0][0]
    await act(async () => changed({ ...snapshot('signed_out'), revision: 2 }))
    expect(screen.queryByRole('textbox', { name: 'Draft' })).toBeNull()
    expect(draft.isConnected).toBe(true)
    expect(draft.closest('[inert]')).not.toBeNull()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(shortcut).not.toHaveBeenCalled()
    expect(window.hermesDesktop.setAccountWindowMode).toHaveBeenCalledWith('login', expect.any(Number))
    await act(async () => changed({ ...snapshot('signed_in', { ...account, id: 'b' }), revision: 3 }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft))
    expect(draft.textContent).toBe('Unsent project work')
    expect(attachment.files?.[0]).toBe(file)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(shortcut).toHaveBeenCalledOnce()
    expect(window.hermesDesktop.setAccountWindowMode).toHaveBeenLastCalledWith('workspace')
  })

  it('keeps the platform identity when the agent connection changes', async () => {
    const account = { id: '17', display_name: '成员', phone_masked: '+86 138****8000', email: '' }
    const platformBridge = bridge(snapshot('signed_in', account))
    const actions = createPlatformAccountActions(platformBridge)

    renderFlow(actions, <p>{account.display_name}</p>)
    expect(await screen.findByText('成员')).toBeTruthy()

    setConnection({ connectionId: 'another-connection' } as never)

    expect(await screen.findByText('成员')).toBeTruthy()
    expect(platformBridge.logout).not.toHaveBeenCalled()
  })

  it('allows platform sign-in while the agent gateway is unavailable and hides backend overlays', async () => {
    const platformBridge = bridge(snapshot('signed_out'))
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        ...(window.hermesDesktop ?? {}),
        platformAccount: platformBridge,
        setAccountWindowMode: vi.fn().mockResolvedValue(true)
      }
    })
    setGatewayState('closed')

    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <MemoryRouter>
          <AccountGate>
            <p>Gateway connecting overlay</p>
          </AccountGate>
        </MemoryRouter>
      </I18nProvider>
    )

    const send = await screen.findByRole('button', { name: '发送验证码' })
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '+8613800138000' } })
    expect((send as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText('Gateway connecting overlay')).toBeNull()
    expect(platformBridge.status).toHaveBeenCalledOnce()
  })

  it('retries missing capabilities after a connection failure without reporting missing configuration', async () => {
    const platformBridge = bridge(snapshot('signed_out'))
    const connectionError = Object.assign(new Error('network_unavailable'), { code: 'network_unavailable' })
    vi.mocked(platformBridge.capabilities).mockRejectedValueOnce(connectionError).mockRejectedValueOnce(connectionError)
    const actions = createPlatformAccountActions(platformBridge)

    renderFlow(actions)

    expect((await screen.findByRole('alert')).textContent).toBe('无法连接账户服务，请检查网络后重试。')
    expect(screen.queryByText('账户服务尚未配置，请配置服务后重试。')).toBeNull()

    await act(async () => {
      vi.mocked(platformBridge.onChanged).mock.calls[0][0]({ ...snapshot('signed_out'), revision: 2 })
    })

    expect(screen.getByRole('alert').textContent).toBe('无法连接账户服务，请检查网络后重试。')

    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    await waitFor(() => expect(platformBridge.capabilities).toHaveBeenCalledTimes(2))
    expect((await screen.findByRole('alert')).textContent).toBe('无法连接账户服务，请检查网络后重试。')

    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    await waitFor(() => expect(platformBridge.capabilities).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect((screen.getByRole('button', { name: '发送验证码' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '+8613800138000' } })
    expect((screen.getByRole('button', { name: '发送验证码' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows loading, not retry, while login options are still pending after an account update', async () => {
    let finishCapabilities!: (value: PlatformPublicCapabilities) => void
    const platformBridge = bridge(snapshot('signed_out'))
    vi.mocked(platformBridge.capabilities).mockImplementation(
      () => new Promise(resolve => (finishCapabilities = resolve))
    )
    const actions = createPlatformAccountActions(platformBridge)

    renderFlow(actions)

    await act(async () => {
      vi.mocked(platformBridge.onChanged).mock.calls[0][0]({ ...snapshot('signed_out'), revision: 2 })
    })

    expect(screen.getByRole('status').textContent).toBe('正在连接账户服务…')
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()

    await act(async () => finishCapabilities(capabilities))

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })

  it('keeps an offline authenticated account in the recoverable workspace', async () => {
    const account = { id: '17', display_name: '成员', phone_masked: '+86 138****8000', email: '' }
    const actions = createPlatformAccountActions(bridge(snapshot('offline', account)))

    renderFlow(actions, <p>Offline workspace</p>)

    expect(await screen.findByText('Offline workspace')).toBeTruthy()
    expect(screen.queryByRole('main', { name: '登录 Aino' })).toBeNull()
  })

  it('gates primary and session windows but leaves denied auxiliary renderers intact', () => {
    expect(shouldGatePlatformAccount('')).toBe(true)
    expect(shouldGatePlatformAccount('?win=secondary')).toBe(true)
    expect(shouldGatePlatformAccount('?peer=1')).toBe(true)
    expect(shouldGatePlatformAccount('?win=hud')).toBe(false)
    expect(shouldGatePlatformAccount('?win=browser&tab=one')).toBe(false)
  })
})
