import { beforeEach, describe, expect, it, vi } from 'vitest'

import { unwrapPlatformAccountIpc } from '../shared/platform-contract'

import { registerPlatformIpc } from './platform-ipc'

function rig() {
  const handlers = new Map<string, (...args: any[]) => any>()

  const ipc = {
    handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler),
    removeHandler: vi.fn((channel: string) => handlers.delete(channel))
  }

  let changed: ((snapshot: any) => void) | null = null

  const snapshot = {
    revision: 1,
    phase: 'signed_in',
    account: { id: '1', display_name: 'Ada', phone_masked: '', email: '' },
    mode: 'development',
    remember_state: 'session_only',
    error: null
  }

  const auth: any = {
    snapshot: () => snapshot,
    subscribe: (listener: any) => {
      changed = listener

      return () => {
        changed = null
      }
    },
    capabilities: vi.fn(),
    requestPhoneCode: vi.fn(),
    verifyPhoneCode: vi.fn(),
    loginExisting: vi.fn(),
    completeSecondFactor: vi.fn(),
    updateProfile: vi.fn(),
    requestBindingCode: vi.fn(),
    submitStepUp: vi.fn(),
    bindPhone: vi.fn(),
    logout: vi.fn()
  }

  const sent: any[] = []

  const win = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      mainFrame: { url: 'http://127.0.0.1:5174/' },
      send: (...args: any[]) => sent.push(args)
    },
    once: vi.fn()
  }

  const other = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      mainFrame: { url: 'http://127.0.0.1:5174/?peer=1' },
      send: vi.fn()
    },
    once: vi.fn()
  }

  const sender: any = { mainFrame: {} }
  const captcha = { acquire: vi.fn().mockResolvedValue({ turnstile_token: 'main-owned-proof' }) }

  const controller = registerPlatformIpc({
    ipc: ipc as any,
    auth,
    captcha,
    fromWebContents: (value: unknown) => (value === sender ? (win as any) : (other as any)),
    trustedRendererUrl: 'http://127.0.0.1:5174/'
  })

  controller.registerWindow(win as any)
  const event = { sender, senderFrame: sender.mainFrame }

  return {
    auth,
    captcha,
    controller,
    event,
    handlers,
    other,
    sent,
    snapshot,
    win,
    invoke: async (name: string, input?: unknown, overrideEvent = event) =>
      unwrapPlatformAccountIpc(await handlers.get(`aino:platform-account:${name}`)!(overrideEvent, input)),
    emit: (value = snapshot) => changed?.(value)
  }
}

describe('platform account IPC', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('scopes usage reads to trusted windows, whitelists query fields and disposes the handler', async () => {
    const f = rig()

    ;(f.event.senderFrame as any).url = 'http://127.0.0.1:5174/'
    f.auth.listUsage = vi.fn().mockResolvedValue({ items: [], page: 1, page_size: 50, total: 0 })
    const handler = f.handlers.get('aino:platform-billing:usage')!
    const input = { expected_user_id: '1', page: 1, page_size: 50, user_id: 'other', token: 'ignored' }
    expect(await handler(f.event, input)).toMatchObject({ ok: true, value: { items: [] } })
    expect(f.auth.listUsage).toHaveBeenCalledWith({ page: 1, page_size: 50 }, '1')
    expect(await handler(f.event, { ...input, page_size: 101 })).toMatchObject({ ok: false })
    expect(await handler(f.event, { ...input, expected_user_id: '' })).toMatchObject({ ok: false })
    expect(await handler({ ...f.event, senderFrame: {} }, input)).toMatchObject({
      ok: false,
      error: { code: 'unauthorized_platform_ipc' }
    })
    expect(f.auth.listUsage).toHaveBeenCalledTimes(1)
    f.controller.dispose()
    // The real registry no longer accepts reads once disposed.
    expect(f.handlers.has('aino:platform-billing:usage')).toBe(false)
  })

  it('allows only registered app windows at the trusted main-frame URL', async () => {
    const f = rig()

    ;(f.event.senderFrame as any).url = 'http://127.0.0.1:5174/?peer=1#/chat'
    await expect(f.invoke('status')).resolves.toBe(f.snapshot)

    await expect(
      f.invoke('status', undefined, { ...f.event, senderFrame: { url: 'http://127.0.0.1:5174/' } })
    ).rejects.toMatchObject({ code: 'unauthorized_platform_ipc' })
    const unregisteredSender: any = { mainFrame: { url: 'http://127.0.0.1:5174/' } }
    await expect(
      f.invoke('status', undefined, {
        sender: unregisteredSender,
        senderFrame: unregisteredSender.mainFrame
      })
    ).rejects.toMatchObject({ code: 'unauthorized_platform_ipc' })
    ;(f.event.senderFrame as any).url = 'https://evil.test/'
    await expect(f.invoke('status')).rejects.toMatchObject({ code: 'unauthorized_platform_ipc' })
  })

  it('broadcasts snapshots to every registered live window and stops after unregister', () => {
    const f = rig()
    f.controller.registerWindow(f.other as any)
    f.emit()
    expect(f.sent).toEqual([['aino:platform-account:changed', f.snapshot]])
    expect(f.other.webContents.send).toHaveBeenCalledWith('aino:platform-account:changed', f.snapshot)
    f.controller.unregisterWindow(f.other as any)
    f.emit({ ...f.snapshot, revision: 2 })
    expect(f.other.webContents.send).toHaveBeenCalledTimes(1)
  })

  it('does not broadcast to a registered window after it navigates away from the trusted document', () => {
    const f = rig()
    f.controller.registerWindow(f.other as any)
    f.other.webContents.mainFrame.url = 'file:///tmp/other.html'

    f.emit()

    expect(f.other.webContents.send).not.toHaveBeenCalled()
  })

  it('keeps a registered loading window eligible after its trusted document commits', () => {
    const f = rig()
    f.other.webContents.mainFrame.url = 'about:blank'
    f.controller.registerWindow(f.other as any)
    f.emit()
    f.other.webContents.mainFrame.url = 'http://127.0.0.1:5174/'
    f.emit({ ...f.snapshot, revision: 2 })

    expect(f.other.webContents.send).toHaveBeenCalledOnce()
  })

  it('isolates and prunes a throwing broadcast target', () => {
    const f = rig()
    f.controller.registerWindow(f.other as any)
    f.other.webContents.send.mockImplementation(() => {
      throw new Error('renderer destroyed')
    })

    expect(() => f.emit()).not.toThrow()
    f.emit({ ...f.snapshot, revision: 2 })
    expect(f.other.webContents.send).toHaveBeenCalledTimes(1)
    expect(f.sent).toHaveLength(2)
  })

  it('closing one account window does not log out the shared account', () => {
    const f = rig()
    f.controller.unregisterWindow(f.win as any)
    expect(f.auth.logout).not.toHaveBeenCalled()
    expect(f.auth.snapshot()).toBe(f.snapshot)
  })

  it('gets captcha proof in main for the originating request instead of trusting renderer proof', async () => {
    const f = rig()

    ;(f.event.senderFrame as any).url = 'http://127.0.0.1:5174/'
    await f.invoke('request-phone-code', { phone: '13900000000' })
    expect(f.captcha.acquire).toHaveBeenCalledOnce()
    expect(f.auth.requestPhoneCode).toHaveBeenCalledWith({
      phone: '13900000000',
      captcha_proof: { turnstile_token: 'main-owned-proof' }
    })
    await expect(
      f.invoke('request-phone-code', {
        phone: '13900000000',
        captcha_proof: { turnstile_token: 'renderer-proof' }
      })
    ).rejects.toThrow('renderer_captcha_proof_rejected')
  })

  it('rejects malformed account input before opening captcha', async () => {
    const f = rig()

    ;(f.event.senderFrame as any).url = 'http://127.0.0.1:5174/'

    await expect(f.invoke('request-phone-code', { phone: '' })).rejects.toMatchObject({
      code: 'invalid_platform_input'
    })
    expect(f.captcha.acquire).not.toHaveBeenCalled()

    await expect(
      f.invoke('login-existing', {
        email: 'a@example.test',
        password: 42,
        remember: true
      })
    ).rejects.toMatchObject({ code: 'invalid_platform_input' })
    expect(f.captcha.acquire).not.toHaveBeenCalled()
  })

  it('accepts an empty agreement revision when server policy disables the agreement', async () => {
    const f = rig()

    ;(f.event.senderFrame as any).url = 'http://127.0.0.1:5174/'

    await f.invoke('verify-phone-code', {
      phone: '13900000000',
      challenge_id: 'challenge',
      code: '246810',
      register_if_new: true,
      agreement_revision: '',
      remember: false
    })

    expect(f.auth.verifyPhoneCode).toHaveBeenCalledWith(expect.objectContaining({ agreement_revision: '' }))
  })

  it('exposes a narrow retry handler for offline account restoration', async () => {
    const f = rig()
    f.auth.retry = vi.fn().mockResolvedValue(f.snapshot)
    ;(f.event.senderFrame as any).url = 'http://127.0.0.1:5174/'

    await expect(f.invoke('retry')).resolves.toBe(f.snapshot)
    expect(f.auth.retry).toHaveBeenCalledOnce()
  })

  it('preserves only safe enumerable error fields through the serialized preload boundary', async () => {
    const f = rig()
    f.auth.requestPhoneCode.mockRejectedValue(
      Object.assign(new Error('raw server cooldown body'), { code: 'SMS_RATE_LIMITED', retryAfter: 47 })
    )
    ;(f.event.senderFrame as any).url = 'http://127.0.0.1:5174/'

    await expect(f.invoke('request-phone-code', { phone: '13900000000' })).rejects.toMatchObject({
      message: 'SMS_RATE_LIMITED',
      code: 'SMS_RATE_LIMITED',
      retryAfter: 47,
      retry_after: 47
    })
  })
})
