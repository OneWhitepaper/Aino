import { describe, expect, it, vi } from 'vitest'

import { createPlatformCaptcha, createPlatformCaptchaBroker, isPlatformCaptchaRequestAllowed } from './platform-captcha'

const disabled = { captcha: { provider: 'disabled', site_key: '', scene_id: '', prefix: '', region: '' } }

const turnstile = {
  captcha: { provider: 'turnstile', site_key: 'site-key', scene_id: '', prefix: '', region: '' }
}

function isolatedSession() {
  return { webRequest: { onBeforeRequest: vi.fn() } }
}

describe('platform captcha broker', () => {
  it('binds a nonce to one window, main frame, origin, operation generation and one submission', async () => {
    let generation = 3
    const capabilities = vi.fn().mockResolvedValue(disabled)

    const broker = createPlatformCaptchaBroker({
      capabilities: capabilities as any,
      generation: () => generation,
      randomNonce: () => 'nonce-1'
    })

    const window = {}
    const pending = broker.begin(window, 'https://api.agentera.com.cn/desktop/captcha')
    expect(
      broker.getChallenge({ window, mainFrame: true, url: 'https://api.agentera.com.cn/desktop/captcha' })
    ).toMatchObject({ nonce: 'nonce-1' })
    await broker.submit({
      window,
      mainFrame: true,
      url: 'https://api.agentera.com.cn/desktop/captcha',
      nonce: 'nonce-1',
      proof: {}
    })
    await expect(pending).resolves.toEqual({})
    await expect(
      broker.submit({
        window,
        mainFrame: true,
        url: 'https://api.agentera.com.cn/desktop/captcha',
        nonce: 'nonce-1',
        proof: {}
      })
    ).rejects.toThrow('captcha_consumed')

    const staleWindow = {}
    const stale = broker.begin(staleWindow, 'https://api.agentera.com.cn/desktop/captcha')
    generation = 4
    await expect(
      broker.submit({
        window: staleWindow,
        mainFrame: true,
        url: 'https://api.agentera.com.cn/desktop/captcha',
        nonce: 'nonce-1',
        proof: {}
      })
    ).rejects.toThrow('captcha_stale')
    await expect(stale).rejects.toThrow('captcha_stale')
  })

  it('requires the fresh provider proof shape and rejects unknown or oversized fields', async () => {
    const capabilities = vi
      .fn()
      .mockResolvedValue({ captcha: { provider: 'tencent', site_key: 'app', scene_id: '', prefix: '', region: 'cn' } })

    const broker = createPlatformCaptchaBroker({
      capabilities: capabilities as any,
      generation: () => 1,
      randomNonce: () => 'nonce'
    })

    const window = {}
    const url = 'https://api.agentera.com.cn/desktop/captcha'
    void broker.begin(window, url)
    await expect(broker.submit({ window, mainFrame: true, url, nonce: 'nonce', proof: {} })).rejects.toThrow(
      'captcha_proof_required'
    )
    await expect(
      broker.submit({ window, mainFrame: true, url, nonce: 'nonce', proof: { unknown: 'x' } as any })
    ).rejects.toThrow('captcha_proof_invalid')
    await expect(
      broker.submit({
        window,
        mainFrame: true,
        url,
        nonce: 'nonce',
        proof: { tencent_captcha_ticket: 'x'.repeat(4097), tencent_captcha_randstr: 'r' }
      })
    ).rejects.toThrow('captcha_proof_invalid')
  })

  it('rejects a proof when the public captcha policy changes after the operation began', async () => {
    let siteKey = 'key-1'

    const capabilities = async () =>
      ({ ...disabled, captcha: { ...disabled.captcha, provider: 'turnstile' as const, site_key: siteKey } }) as any

    const broker = createPlatformCaptchaBroker({ capabilities, generation: () => 1, randomNonce: () => 'nonce' })
    const window = {}
    const pending = broker.begin(window, 'https://api.agentera.com.cn/desktop/captcha')
    await Promise.resolve()
    siteKey = 'key-2'
    await expect(
      broker.submit({
        window,
        mainFrame: true,
        url: 'https://api.agentera.com.cn/desktop/captcha',
        nonce: 'nonce',
        proof: { turnstile_token: 'proof' }
      })
    ).rejects.toThrow('captcha_stale_policy')
    await expect(pending).rejects.toThrow('captcha_stale_policy')
  })

  it('rejects auxiliary frames and lookalike origins', () => {
    const broker = createPlatformCaptchaBroker({
      capabilities: async () => disabled as any,
      generation: () => 1,
      randomNonce: () => 'nonce'
    })

    const window = {}
    void broker.begin(window, 'https://api.agentera.com.cn/desktop/captcha')
    expect(() =>
      broker.getChallenge({ window, mainFrame: false, url: 'https://api.agentera.com.cn/desktop/captcha' })
    ).toThrow('captcha_sender_rejected')
    expect(() =>
      broker.getChallenge({ window, mainFrame: true, url: 'https://api.agentera.com.cn.evil.test/desktop/captcha' })
    ).toThrow('captcha_sender_rejected')
  })

  it('expires and cleans up a challenge at its bounded deadline', async () => {
    let now = 1_000

    const broker = createPlatformCaptchaBroker({
      capabilities: async () => disabled as any,
      generation: () => 1,
      randomNonce: () => 'nonce',
      now: () => now,
      ttlMs: 100
    })

    const window = {}
    const url = 'https://api.agentera.com.cn/desktop/captcha'
    const pending = broker.begin(window, url)

    expect(broker.getChallenge({ window, mainFrame: true, url })).toEqual({
      nonce: 'nonce',
      issued_at: 1_000,
      expires_at: 1_100
    })
    now = 1_100
    expect(() => broker.getChallenge({ window, mainFrame: true, url })).toThrow('captcha_expired')
    await expect(pending).rejects.toMatchObject({ code: 'captcha_expired' })
    expect(() => broker.getChallenge({ window, mainFrame: true, url })).toThrow('captcha_sender_rejected')
  })

  it('rejects expiry that occurs while fresh policy is being checked', async () => {
    let now = 1_000
    let releasePolicy: ((value: typeof disabled) => void) | null = null

    const initialPolicy = new Promise<typeof disabled>(resolve => {
      releasePolicy = resolve
    })

    const capabilities = vi.fn().mockReturnValueOnce(initialPolicy).mockResolvedValue(disabled)

    const broker = createPlatformCaptchaBroker({
      capabilities: capabilities as any,
      generation: () => 1,
      randomNonce: () => 'nonce',
      now: () => now,
      ttlMs: 100
    })

    const window = {}
    const url = 'https://api.agentera.com.cn/desktop/captcha'
    const pending = broker.begin(window, url)
    const submit = broker.submit({ window, mainFrame: true, url, nonce: 'nonce', proof: {} })
    now = 1_100
    releasePolicy?.(disabled)

    await expect(submit).rejects.toMatchObject({ code: 'captcha_expired' })
    await expect(pending).rejects.toMatchObject({ code: 'captcha_expired' })
  })

  it('returns an empty proof without creating a verification surface when captcha is disabled', async () => {
    const createWindow = vi.fn()
    const createSession = vi.fn()

    const captcha = createPlatformCaptcha({
      ipc: { handle: vi.fn() },
      createWindow,
      fromWebContents: () => null,
      origin: 'https://api.agentera.com.cn',
      preloadPath: '/app/platform-captcha-preload.js',
      createSession,
      capabilities: async () => disabled as any,
      generation: () => 1,
      randomNonce: () => 'nonce'
    })

    await expect(captcha.acquire()).resolves.toEqual({})
    expect(createWindow).not.toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalled()
  })

  it('creates a minimal isolated window and accepts IPC only from its main document when captcha is enabled', async () => {
    const handlers = new Map<string, (...args: any[]) => any>()
    const ipc = { handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) }
    const events = new Map<string, (...args: any[]) => void>()

    const sender: any = {
      mainFrame: { url: 'https://api.agentera.com.cn/desktop/captcha' },
      setWindowOpenHandler: vi.fn()
    }

    const win: any = {
      webContents: sender,
      isDestroyed: () => false,
      close: vi.fn(),
      loadURL: vi.fn().mockResolvedValue(undefined),
      once: (name: string, fn: any) => events.set(name, fn)
    }

    const createWindow = vi.fn().mockReturnValue(win)
    const session = isolatedSession()

    const captcha = createPlatformCaptcha({
      ipc: ipc as any,
      createWindow,
      fromWebContents: (value: unknown) => (value === sender ? win : null),
      origin: 'https://api.agentera.com.cn',
      preloadPath: '/app/platform-captcha-preload.js',
      createSession: () => session,
      capabilities: async () => turnstile as any,
      generation: () => 1,
      randomNonce: () => 'nonce'
    })

    const pending = captcha.acquire()
    await vi.waitFor(() => expect(createWindow).toHaveBeenCalledOnce())
    expect(createWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        webPreferences: {
          preload: '/app/platform-captcha-preload.js',
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webviewTag: false,
          session
        }
      })
    )
    expect(win.loadURL).toHaveBeenCalledWith('https://api.agentera.com.cn/desktop/captcha')
    const event = { sender, senderFrame: sender.mainFrame }
    expect(handlers.get('aino:platform-captcha:get')!(event)).toMatchObject({ nonce: 'nonce' })
    await handlers.get('aino:platform-captcha:submit')!(event, {
      nonce: 'nonce',
      proof: { turnstile_token: 'proof' }
    })
    await expect(pending).resolves.toEqual({ turnstile_token: 'proof' })
    expect(win.close).toHaveBeenCalledOnce()
  })

  it('settles capability failures once with a stable public code', async () => {
    const handlers = new Map<string, (...args: any[]) => any>()
    const sender: any = { mainFrame: { url: 'https://api.agentera.com.cn/desktop/captcha' } }

    const win: any = {
      webContents: sender,
      isDestroyed: () => false,
      close: vi.fn(),
      loadURL: vi.fn().mockResolvedValue(undefined),
      once: vi.fn()
    }

    const captcha = createPlatformCaptcha({
      ipc: { handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) },
      createWindow: () => win,
      fromWebContents: () => win,
      origin: 'https://api.agentera.com.cn',
      preloadPath: '/app/platform-captcha-preload.js',
      createSession: isolatedSession,
      capabilities: async () => {
        throw new Error('raw policy response')
      },
      generation: () => 1,
      randomNonce: () => 'nonce'
    })

    await expect(captcha.acquire()).rejects.toMatchObject({ code: 'captcha_policy_unavailable' })
  })

  it('translates window load failures and consumes the broker rejection', async () => {
    const win: any = {
      webContents: {},
      isDestroyed: () => false,
      close: vi.fn(),
      loadURL: vi.fn().mockRejectedValue(new Error('ERR_CONNECTION_REFUSED raw URL')),
      once: vi.fn()
    }

    const captcha = createPlatformCaptcha({
      ipc: { handle: vi.fn() },
      createWindow: () => win,
      fromWebContents: () => win,
      origin: 'https://api.agentera.com.cn',
      preloadPath: '/app/platform-captcha-preload.js',
      createSession: isolatedSession,
      capabilities: async () => turnstile as any,
      generation: () => 1,
      randomNonce: () => 'nonce'
    })

    await expect(captcha.acquire()).rejects.toMatchObject({ code: 'captcha_load_failed' })
  })

  it('rejects an acquisition when generation changes during its initial policy wait', async () => {
    let generation = 1
    const initialPolicy = deferred<typeof disabled>()
    const handlers = new Map<string, (...args: any[]) => any>()

    const sender: any = {
      mainFrame: { url: 'https://api.agentera.com.cn/desktop/captcha' },
      setWindowOpenHandler: vi.fn()
    }

    const win: any = {
      webContents: sender,
      isDestroyed: () => false,
      close: vi.fn(),
      loadURL: vi.fn().mockResolvedValue(undefined),
      once: vi.fn()
    }

    const createWindow = vi.fn().mockReturnValue(win)

    const captcha = createPlatformCaptcha({
      ipc: { handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) },
      createWindow,
      fromWebContents: value => (value === sender ? win : null),
      origin: 'https://api.agentera.com.cn',
      preloadPath: '/app/platform-captcha-preload.js',
      createSession: isolatedSession,
      capabilities: () => initialPolicy.promise as any,
      generation: () => generation,
      randomNonce: () => 'nonce'
    })

    const pending = captcha.acquire()
    generation = 2
    initialPolicy.resolve(disabled)
    await Promise.resolve()

    if (createWindow.mock.calls.length > 0) {
      const event = { sender, senderFrame: sender.mainFrame }
      const challenge = handlers.get('aino:platform-captcha:get')!(event)
      await handlers.get('aino:platform-captcha:submit')!(event, { nonce: challenge.nonce, proof: {} })
    }

    await expect(pending).rejects.toMatchObject({ code: 'captcha_stale' })
    expect(createWindow).not.toHaveBeenCalled()
  })

  it('does not let an older initial policy response supersede a newer acquisition', async () => {
    const handlers = new Map<string, (...args: any[]) => any>()
    const firstPolicy = deferred<typeof turnstile>()
    const capabilities = vi.fn().mockReturnValueOnce(firstPolicy.promise).mockResolvedValue(turnstile)
    const events = new Map<object, Map<string, () => void>>()
    const windows: any[] = []

    const createWindow = vi.fn(() => {
      const sender: any = {
        mainFrame: { url: 'https://api.agentera.com.cn/desktop/captcha' },
        setWindowOpenHandler: vi.fn()
      }

      const window: any = {
        webContents: sender,
        isDestroyed: () => false,
        close: vi.fn(),
        loadURL: vi.fn().mockResolvedValue(undefined),
        once: (name: string, callback: () => void) => {
          const windowEvents = events.get(window) ?? new Map<string, () => void>()
          windowEvents.set(name, callback)
          events.set(window, windowEvents)
        }
      }

      windows.push(window)

      return window
    })

    const captcha = createPlatformCaptcha({
      ipc: { handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) },
      createWindow,
      fromWebContents: sender => windows.find(window => window.webContents === sender) ?? null,
      origin: 'https://api.agentera.com.cn',
      preloadPath: '/app/platform-captcha-preload.js',
      createSession: isolatedSession,
      capabilities: capabilities as any,
      generation: () => 1,
      randomNonce: () => 'nonce'
    })

    const older = captcha.acquire()
    const newer = captcha.acquire()
    void newer.catch(() => undefined)
    await vi.waitFor(() => expect(createWindow).toHaveBeenCalledOnce())
    firstPolicy.resolve(turnstile)
    await Promise.resolve()

    if (windows.length > 1) {
      const staleWinner = windows[1]
      const staleEvent = { sender: staleWinner.webContents, senderFrame: staleWinner.webContents.mainFrame }
      const staleChallenge = handlers.get('aino:platform-captcha:get')!(staleEvent)
      await handlers.get('aino:platform-captcha:submit')!(staleEvent, {
        nonce: staleChallenge.nonce,
        proof: { turnstile_token: 'proof' }
      })
    }

    await expect(older).rejects.toMatchObject({ code: 'captcha_superseded' })
    expect(createWindow).toHaveBeenCalledOnce()

    const active = windows[0]
    const event = { sender: active.webContents, senderFrame: active.webContents.mainFrame }
    const challenge = handlers.get('aino:platform-captcha:get')!(event)
    await handlers.get('aino:platform-captcha:submit')!(event, {
      nonce: challenge.nonce,
      proof: { turnstile_token: 'proof' }
    })
    await expect(newer).resolves.toEqual({ turnstile_token: 'proof' })
  })

  it('allows only built assets, public settings, and the configured widget destinations', () => {
    const allowed = (url: string, provider: 'turnstile' | 'tencent' | 'aliyun' = 'turnstile') =>
      isPlatformCaptchaRequestAllowed(url, 'https://api.agentera.com.cn', {
        provider,
        site_key: '',
        scene_id: '',
        prefix: 'tenant-prefix',
        region: 'cn'
      })

    expect(allowed('https://api.agentera.com.cn/assets/index.js')).toBe(true)
    expect(allowed('https://api.agentera.com.cn/api/v1/settings/public')).toBe(true)
    expect(allowed('https://api.agentera.com.cn/api/v1/user/profile')).toBe(false)
    expect(allowed('https://challenges.cloudflare.com/turnstile/v0/api.js')).toBe(true)
    expect(allowed('https://turing.captcha.qcloud.com/TJCaptcha.js', 'turnstile')).toBe(false)
    expect(allowed('https://turing.captcha.qcloud.com/TJCaptcha.js', 'tencent')).toBe(true)
    expect(allowed('https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js', 'aliyun')).toBe(true)
    expect(allowed('https://evil.test/collect')).toBe(false)
  })

  it('allows only the configured Aliyun tenant and regional runtime endpoints', () => {
    const cn = { provider: 'aliyun', site_key: '', scene_id: 'scene', prefix: 'tenant-prefix', region: 'cn' }
    const sgp = { ...cn, region: 'sgp' }

    const allowed = (url: string, policy = cn) =>
      isPlatformCaptchaRequestAllowed(url, 'https://api.agentera.com.cn', policy as any)

    expect(allowed('https://cloudauth-device-dualstack.cn-shanghai.aliyuncs.com/device')).toBe(true)
    expect(allowed('https://cn-shanghai.device.saf.aliyuncs.com/collect')).toBe(true)
    expect(allowed('https://tenant-prefix.captcha-open.aliyuncs.com/verify')).toBe(true)
    expect(allowed('https://tenant-prefix.captcha-open-b.aliyuncs.com/verify')).toBe(true)
    expect(allowed('https://upload.captcha-open.aliyuncs.com/upload')).toBe(true)
    expect(allowed('https://upload.captcha-open-b.aliyuncs.com/upload')).toBe(true)
    expect(allowed('https://cloudauth-device-dualstack.ap-southeast-1.aliyuncs.com/device', sgp)).toBe(true)
    expect(allowed('https://ap-southeast-1.device.saf.aliyuncs.com/collect', sgp)).toBe(true)
    expect(allowed('https://tenant-prefix.captcha-open-southeast.aliyuncs.com/verify', sgp)).toBe(true)
    expect(allowed('https://tenant-prefix.captcha-open-southeast-b.aliyuncs.com/verify', sgp)).toBe(true)
    expect(allowed('https://upload.captcha-open-southeast.aliyuncs.com/upload', sgp)).toBe(true)
    expect(allowed('https://upload.captcha-open-southeast-b.aliyuncs.com/upload', sgp)).toBe(true)
    expect(allowed('https://other-prefix.captcha-open.aliyuncs.com/verify')).toBe(false)
    expect(allowed('https://tenant-prefix.captcha-open-southeast.aliyuncs.com/verify')).toBe(false)
    expect(allowed('https://tenant-prefix.captcha-open.aliyuncs.com.evil.test/verify')).toBe(false)
    expect(allowed('https://user@tenant-prefix.captcha-open.aliyuncs.com/verify')).toBe(false)
    expect(allowed('http://tenant-prefix.captcha-open.aliyuncs.com/verify')).toBe(false)
    expect(allowed('https://tenant-prefix.captcha-open.aliyuncs.com:444/verify')).toBe(false)
    expect(
      allowed('https://tenant-prefix.evil.captcha-open.aliyuncs.com/verify', { ...cn, prefix: 'tenant-prefix.evil' })
    ).toBe(false)
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void

  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}
