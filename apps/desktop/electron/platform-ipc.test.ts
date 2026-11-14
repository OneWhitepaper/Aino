import { beforeEach, describe, expect, it, vi } from 'vitest'

import { unwrapPlatformAccountIpc } from '../shared/platform-contract'

import { registerPlatformIpc } from './platform-ipc'

function rig(historyRecovery?: Parameters<typeof registerPlatformIpc>[0]['historyRecovery']) {
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
    generation: vi.fn(() => 1),
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
    trustedRendererUrl: 'http://127.0.0.1:5174/',
    historyRecovery
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

  it('exposes history recovery only to a trusted registered renderer through drainable data channels', async () => {
    const recovery = {
      inspect: vi.fn().mockResolvedValue({ owned: 1 }),
      restore: vi.fn().mockResolvedValue({ imported: 1 }),
      remind: vi.fn().mockResolvedValue({ ok: true, showReminder: false })
    }

    const f = rig(recovery)

    ;(f.event.senderFrame as any).url = 'http://127.0.0.1:5174/'
    const inspect = f.handlers.get('aino:legacy-history:inspect')!
    const owner = { userId: '1', mode: 'development', revision: 1 }
    expect(await inspect({ ...f.event, senderFrame: {} }, owner)).toMatchObject({ ok: false })
    expect(recovery.inspect).not.toHaveBeenCalled()
    expect(await inspect(f.event, owner)).toEqual({ ok: true, value: { owned: 1 } })
    expect(recovery.inspect).toHaveBeenCalledWith(owner)
    const remind = f.handlers.get('aino:legacy-history:remind')!
    const choice = { expectedOwner: owner, planId: 'plan', choice: 'ignore' }
    expect(await remind({ ...f.event, senderFrame: {} }, choice)).toMatchObject({ ok: false })
    expect(recovery.remind).not.toHaveBeenCalled()
    expect(await remind(f.event, choice)).toMatchObject({ ok: true, value: { showReminder: false } })
    expect(recovery.remind).toHaveBeenCalledWith(choice)
    expect(f.handlers.has('aino:platform-account:history-recovery')).toBe(false)
    f.controller.dispose()
    expect(f.handlers.has('aino:legacy-history:inspect')).toBe(false)
    expect(f.handlers.has('aino:legacy-history:restore')).toBe(false)
    expect(f.handlers.has('aino:legacy-history:remind')).toBe(false)
  })

  it('rejects stale sign-in recovery owners at the native boundary before logging out', async () => {
    for (const change of ['account', 'revision', 'mode'] as const) {
      const f = rig()

      ;(f.event.senderFrame as any).url = 'http://127.0.0.1:5174/'
      const expected = { userId: f.snapshot.account.id, revision: f.snapshot.revision, mode: f.snapshot.mode }

      if (change === 'account') {
        f.snapshot.account.id = 'another-account'
      }

      if (change === 'revision') {
        f.snapshot.revision++
      }

      if (change === 'mode') {
        f.snapshot.mode = 'production'
      }

      // The renderer has not received the new native snapshot yet.
      await expect(f.invoke('logout', expected)).rejects.toMatchObject({ code: 'platform_account_changed' })
      expect(f.auth.logout).not.toHaveBeenCalled()
      f.controller.dispose()
    }
  })

  it('accepts an unchanged recovery owner and preserves ordinary logout', async () => {
    const f = rig()

    ;(f.event.senderFrame as any).url = 'http://127.0.0.1:5174/'
    await f.invoke('logout', { userId: f.snapshot.account.id, revision: f.snapshot.revision, mode: f.snapshot.mode })
    await f.invoke('logout')
    expect(f.auth.logout).toHaveBeenCalledTimes(2)
    f.controller.dispose()
  })

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

  it.each(['window', 'account'] as const)('rejects a captcha continuation after its %s changes', async change => {
    const f = rig()
    let releaseProof!: (proof: { turnstile_token: string }) => void
    f.captcha.acquire.mockReturnValueOnce(
      new Promise(resolve => {
        releaseProof = resolve
      })
    )
    ;(f.event.senderFrame as any).url = 'http://127.0.0.1:5174/'

    const pending = f.invoke('request-binding-code', { phone: '13900000000' })

    if (change === 'window') {
      f.controller.unregisterWindow(f.win as any)
    } else {
      f.auth.generation.mockReturnValue(2)
    }

    releaseProof({ turnstile_token: 'late-proof' })

    await expect(pending).rejects.toMatchObject({
      code: change === 'window' ? 'unauthorized_platform_ipc' : 'auth_attempt_superseded'
    })
    expect(f.auth.requestBindingCode).not.toHaveBeenCalled()
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
