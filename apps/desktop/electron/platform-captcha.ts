import type { PlatformCaptchaProof, PlatformPublicCapabilities } from '../shared/platform-contract'

export class PlatformCaptchaError extends Error {
  constructor(public readonly code: string) {
    super(code)
  }
}

interface CaptchaSubmit {
  window: object
  mainFrame: boolean
  url: string
  nonce: string
  proof: PlatformCaptchaProof
}

interface PendingCaptcha {
  window: object
  url: string
  nonce: string
  generation: number
  consumed: boolean
  settled: boolean
  issuedAt: number
  expiresAt: number
  deadline: ReturnType<typeof setTimeout>
  policy: Promise<PlatformPublicCapabilities>
  resolve: (proof: PlatformCaptchaProof) => void
  reject: (error: Error) => void
}

const PROOF_KEYS = new Set(['turnstile_token', 'tencent_captcha_ticket', 'tencent_captcha_randstr'])
const DEFAULT_CAPTCHA_TTL_MS = 2 * 60 * 1000
type CaptchaPolicy = PlatformPublicCapabilities['captcha']

const CAPTCHA_PROVIDER_HOSTS = {
  disabled: [],
  turnstile: ['challenges.cloudflare.com'],
  tencent: [
    'turing.captcha.qcloud.com',
    'turing.captcha.gtimg.com',
    'ca.turing.captcha.qcloud.com',
    'global.turing.captcha.gtimg.com',
    'www.tycaptcha.com',
    'cloudcache.tencentcs.com',
    'rce.tencentrio.com'
  ],
  aliyun: ['.alicdn.com']
} satisfies Record<PlatformPublicCapabilities['captcha']['provider'], string[]>

function matchesHost(hostname: string, rule: string) {
  return rule.startsWith('.') ? hostname.endsWith(rule) && hostname.length > rule.length : hostname === rule
}

function aliyunRuntimeHosts(policy: CaptchaPolicy) {
  if (policy.provider !== 'aliyun' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(policy.prefix)) {
    return []
  }

  const prefix = policy.prefix.toLowerCase()

  if (policy.region === 'cn') {
    return [
      'cloudauth-device-dualstack.cn-shanghai.aliyuncs.com',
      'cn-shanghai.device.saf.aliyuncs.com',
      `${prefix}.captcha-open.aliyuncs.com`,
      `${prefix}.captcha-open-b.aliyuncs.com`,
      'upload.captcha-open.aliyuncs.com',
      'upload.captcha-open-b.aliyuncs.com'
    ]
  }

  if (policy.region === 'sgp') {
    return [
      'cloudauth-device-dualstack.ap-southeast-1.aliyuncs.com',
      'ap-southeast-1.device.saf.aliyuncs.com',
      `${prefix}.captcha-open-southeast.aliyuncs.com`,
      `${prefix}.captcha-open-southeast-b.aliyuncs.com`,
      'upload.captcha-open-southeast.aliyuncs.com',
      'upload.captcha-open-southeast-b.aliyuncs.com'
    ]
  }

  return []
}

export function isPlatformCaptchaRequestAllowed(rawUrl: string, platformOrigin: string, policy: CaptchaPolicy) {
  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  if (url.username || url.password) {
    return false
  }

  if (url.protocol === 'data:' || url.protocol === 'blob:') {
    return true
  }

  if (url.origin === platformOrigin) {
    return (
      url.pathname === '/desktop/captcha' ||
      url.pathname === '/api/v1/settings/public' ||
      url.pathname === '/logo.svg' ||
      url.pathname.startsWith('/assets/')
    )
  }

  const allowedHosts = [...CAPTCHA_PROVIDER_HOSTS[policy.provider], ...aliyunRuntimeHosts(policy)]

  return url.protocol === 'https:' && url.port === '' && allowedHosts.some(rule => matchesHost(url.hostname, rule))
}

function trustedSender(pending: PendingCaptcha, window: object, mainFrame: boolean, rawUrl: string) {
  if (!mainFrame || window !== pending.window) {
    return false
  }

  try {
    const actual = new URL(rawUrl)
    const expected = new URL(pending.url)

    return (
      actual.origin === expected.origin &&
      actual.pathname === expected.pathname &&
      actual.search === '' &&
      actual.hash === ''
    )
  } catch {
    return false
  }
}

function validateProof(proof: PlatformCaptchaProof, capabilities: PlatformPublicCapabilities) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
    throw new PlatformCaptchaError('captcha_proof_invalid')
  }

  for (const [key, value] of Object.entries(proof)) {
    if (!PROOF_KEYS.has(key) || typeof value !== 'string' || value.length < 1 || value.length > 4096) {
      throw new PlatformCaptchaError('captcha_proof_invalid')
    }
  }

  const keys = Object.keys(proof)

  switch (capabilities.captcha.provider) {
    case 'disabled':
      if (keys.length !== 0) {
        throw new PlatformCaptchaError('captcha_proof_invalid')
      }

      break

    case 'turnstile':

    case 'aliyun':
      if (keys.length !== 1 || !proof.turnstile_token) {
        throw new PlatformCaptchaError('captcha_proof_required')
      }

      break

    case 'tencent':
      if (keys.length !== 2 || !proof.tencent_captcha_ticket || !proof.tencent_captcha_randstr) {
        throw new PlatformCaptchaError('captcha_proof_required')
      }

      break
  }
}

export function createPlatformCaptchaBroker({
  capabilities,
  generation,
  randomNonce,
  now = Date.now,
  ttlMs = DEFAULT_CAPTCHA_TTL_MS
}: {
  capabilities: () => Promise<PlatformPublicCapabilities>
  generation: () => number
  randomNonce: () => string
  now?: () => number
  ttlMs?: number
}) {
  let pending: PendingCaptcha | null = null

  function settle(active: PendingCaptcha, error?: PlatformCaptchaError, proof?: PlatformCaptchaProof) {
    if (active.settled) {
      return false
    }

    active.settled = true
    clearTimeout(active.deadline)

    if (error) {
      if (pending === active) {
        pending = null
      }

      active.reject(error)
    } else {
      active.consumed = true
      active.resolve({ ...proof })
    }

    return true
  }

  function expire(active: PendingCaptcha) {
    if (now() < active.expiresAt) {
      return false
    }

    settle(active, new PlatformCaptchaError('captcha_expired'))

    return true
  }

  return {
    begin(
      window: object,
      url: string,
      initialCapabilities?: PlatformPublicCapabilities
    ): Promise<PlatformCaptchaProof> {
      if (pending && !pending.settled) {
        settle(pending, new PlatformCaptchaError('captcha_superseded'))
      }

      const issuedAt = now()
      let active: PendingCaptcha

      const result = new Promise<PlatformCaptchaProof>((resolve, reject) => {
        active = {
          window,
          url,
          nonce: randomNonce(),
          generation: generation(),
          consumed: false,
          settled: false,
          issuedAt,
          expiresAt: issuedAt + ttlMs,
          deadline: undefined as unknown as ReturnType<typeof setTimeout>,
          policy: initialCapabilities ? Promise.resolve(initialCapabilities) : capabilities(),
          resolve,
          reject
        }
        active.deadline = setTimeout(() => settle(active, new PlatformCaptchaError('captcha_expired')), ttlMs)
        active.deadline.unref?.()
        pending = active
        void active.policy.catch(() => settle(active, new PlatformCaptchaError('captcha_policy_unavailable')))
      })

      void result.catch(() => undefined)

      return result
    },
    getChallenge(input: { window: object; mainFrame: boolean; url: string }) {
      if (!pending || !trustedSender(pending, input.window, input.mainFrame, input.url)) {
        throw new PlatformCaptchaError('captcha_sender_rejected')
      }

      if (pending.consumed) {
        throw new PlatformCaptchaError('captcha_consumed')
      }

      if (expire(pending)) {
        throw new PlatformCaptchaError('captcha_expired')
      }

      return { nonce: pending.nonce, issued_at: pending.issuedAt, expires_at: pending.expiresAt }
    },
    async submit(input: CaptchaSubmit) {
      const active = pending

      if (!active || (input.window === active.window && active.consumed)) {
        throw new PlatformCaptchaError('captcha_consumed')
      }

      if (!trustedSender(active, input.window, input.mainFrame, input.url) || input.nonce !== active.nonce) {
        throw new PlatformCaptchaError('captcha_sender_rejected')
      }

      if (expire(active)) {
        throw new PlatformCaptchaError('captcha_expired')
      }

      if (active.generation !== generation()) {
        const error = new PlatformCaptchaError('captcha_stale')
        settle(active, error)
        throw error
      }

      let initialPolicy: PlatformPublicCapabilities
      let fresh: PlatformPublicCapabilities

      try {
        ;[initialPolicy, fresh] = await Promise.all([active.policy, capabilities()])
      } catch {
        const error = new PlatformCaptchaError('captcha_policy_unavailable')
        settle(active, error)
        throw error
      }

      if (expire(active)) {
        throw new PlatformCaptchaError('captcha_expired')
      }

      if (active !== pending || active.generation !== generation()) {
        if (active === pending) {
          settle(active, new PlatformCaptchaError('captcha_stale'))
        }

        const error = new PlatformCaptchaError('captcha_stale')
        throw error
      }

      if (JSON.stringify(initialPolicy.captcha) !== JSON.stringify(fresh.captcha)) {
        const error = new PlatformCaptchaError('captcha_stale_policy')
        settle(active, error)
        throw error
      }

      validateProof(input.proof, fresh)
      settle(active, undefined, input.proof)
    },
    cancel(window: object, code = 'captcha_cancelled') {
      if (pending?.window === window && !pending.consumed) {
        settle(pending, new PlatformCaptchaError(code))
      }
    }
  }
}

interface CaptchaIpc {
  handle(channel: string, handler: (...args: any[]) => unknown): void
}
interface CaptchaWindow {
  webContents: {
    mainFrame?: unknown
    send?: (...args: unknown[]) => void
    setWindowOpenHandler?(handler: (...args: any[]) => { action: 'deny' }): void
    on?(event: string, handler: (...args: any[]) => void): void
  }
  isDestroyed(): boolean
  loadURL(url: string): Promise<unknown> | unknown
  close(): void
  show?(): void
  once?(event: string, handler: () => void): void
}

interface CaptchaSession {
  webRequest: {
    onBeforeRequest(
      filter: { urls: string[] },
      listener: (details: { url: string }, callback: (result: { cancel: boolean }) => void) => void
    ): void
  }
}

export function createPlatformCaptcha({
  ipc,
  createWindow,
  fromWebContents,
  origin,
  preloadPath,
  createSession,
  capabilities,
  generation,
  randomNonce
}: {
  ipc: CaptchaIpc
  createWindow(options: Record<string, unknown>): CaptchaWindow
  fromWebContents(sender: unknown): CaptchaWindow | null
  origin: string
  preloadPath: string
  createSession(): CaptchaSession
  capabilities: () => Promise<PlatformPublicCapabilities>
  generation: () => number
  randomNonce: () => string
}) {
  const captchaUrl = `${origin}/desktop/captcha`
  const broker = createPlatformCaptchaBroker({ capabilities, generation, randomNonce })
  let captchaSession: CaptchaSession | null = null
  let activeWindow: CaptchaWindow | null = null
  let activePolicy: CaptchaPolicy = { provider: 'disabled', site_key: '', scene_id: '', prefix: '', region: '' }
  let acquisitionGeneration = 0

  function isolatedSession() {
    if (!captchaSession) {
      captchaSession = createSession()
      captchaSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
        callback({ cancel: !isPlatformCaptchaRequestAllowed(details.url, origin, activePolicy) })
      })
    }

    return captchaSession
  }

  function senderInput(event: any) {
    const window = fromWebContents(event?.sender)

    return {
      window: window as object,
      mainFrame: Boolean(window && event.senderFrame === event.sender?.mainFrame),
      url: String(event.senderFrame?.url || '')
    }
  }

  ipc.handle('aino:platform-captcha:get', event => broker.getChallenge(senderInput(event)))
  ipc.handle('aino:platform-captcha:submit', (event, input) =>
    broker.submit({ ...senderInput(event), nonce: String(input?.nonce || ''), proof: input?.proof })
  )

  return {
    async acquire(): Promise<PlatformCaptchaProof> {
      const acquisition = ++acquisitionGeneration
      const operationGeneration = generation()

      if (activeWindow && !activeWindow.isDestroyed()) {
        activeWindow.close()
      }

      let initialCapabilities: PlatformPublicCapabilities

      try {
        initialCapabilities = await capabilities()
      } catch {
        if (acquisition !== acquisitionGeneration) {
          throw new PlatformCaptchaError('captcha_superseded')
        }

        if (operationGeneration !== generation()) {
          throw new PlatformCaptchaError('captcha_stale')
        }

        throw new PlatformCaptchaError('captcha_policy_unavailable')
      }

      if (acquisition !== acquisitionGeneration) {
        throw new PlatformCaptchaError('captcha_superseded')
      }

      if (operationGeneration !== generation()) {
        throw new PlatformCaptchaError('captcha_stale')
      }

      if (initialCapabilities.captcha.provider === 'disabled') {
        return {}
      }

      activePolicy = { ...initialCapabilities.captcha }

      const win = createWindow({
        width: 400,
        height: 560,
        resizable: false,
        maximizable: false,
        minimizable: false,
        show: false,
        webPreferences: {
          preload: preloadPath,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webviewTag: false,
          session: isolatedSession()
        }
      })

      activeWindow = win
      win.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }))
      win.webContents.on?.('will-attach-webview', event => event.preventDefault())

      const denyExternalNavigation = (event: { preventDefault(): void }, target: string) => {
        if (target !== captchaUrl) {
          event.preventDefault()
        }
      }

      win.webContents.on?.('will-navigate', denyExternalNavigation)
      win.webContents.on?.('will-redirect', denyExternalNavigation)
      const pending = broker.begin(win, captchaUrl, initialCapabilities)
      win.once?.('closed', () => {
        broker.cancel(win)

        if (activeWindow === win) {
          activeWindow = null
        }
      })
      win.once?.('ready-to-show', () => win.show?.())

      try {
        const load = Promise.resolve()
          .then(() => win.loadURL(captchaUrl))
          .then(
            () => ({ type: 'loaded' as const }),
            () => ({ type: 'load_failed' as const })
          )

        const first = await Promise.race([load, pending.then(proof => ({ type: 'proof' as const, proof }))])

        if (first.type === 'load_failed') {
          broker.cancel(win, 'captcha_load_failed')
          await pending.catch(() => undefined)
          throw new PlatformCaptchaError('captcha_load_failed')
        }

        if (first.type === 'proof') {
          return first.proof
        }

        return await pending
      } finally {
        if (!win.isDestroyed()) {
          win.close()
        }
      }
    }
  }
}
