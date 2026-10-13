import http from 'node:http'

import { afterEach, describe, expect, it } from 'vitest'

import { createPlatformAuth } from './platform-auth'
import { createPlatformClient } from './platform-client'
import type { PlatformTokenSet, PlatformTokenStore } from './platform-token-store'

const servers: http.Server[] = []
afterEach(async () => Promise.all(servers.splice(0).map(s => new Promise<void>(r => s.close(() => r())))))

async function createPlatformAuthTestRig(options: { delaySave?: boolean } = {}) {
  let pendingProfile: (() => void) | null = null
  let signalPendingProfile: (() => void) | null = null

  const pendingProfileReady = new Promise<void>(resolve => {
    signalPendingProfile = resolve
  })

  let refreshCalls = 0
  let profileCalls = 0

  const server = http.createServer((req, res) => {
    const json = (data: unknown, status = 200) => {
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(data))
    }

    if (req.url === '/api/v1/auth/refresh') {
      refreshCalls += 1
      json({
        code: 0,
        message: 'ok',
        data: {
          access_token: 'rotated-access',
          refresh_token: 'rotated-refresh',
          expires_in: 3600,
          token_type: 'Bearer'
        }
      })
    } else if (req.url === '/api/v1/user/profile') {
      profileCalls += 1

      const reply = () =>
        json({
          code: 0,
          message: 'ok',
          data: {
            id: 17,
            username: 'old account',
            email: '',
            phone_bound: true,
            auth_bindings: { phone: { subject_hint: '139****0000' } }
          }
        })

      if (profileCalls === 1) {
        reply()
      } else {
        pendingProfile = reply
        signalPendingProfile?.()
      }
    } else if (req.url === '/api/v1/auth/logout') {
      json({ code: 0, message: 'ok', data: { success: true } })
    } else {
      json({ code: 'NOT_FOUND', message: 'not found' }, 404)
    }
  })

  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }

  let persisted: PlatformTokenSet | null = {
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    expiresAt: 999_999
  }

  let releaseSave: (() => void) | null = null
  let signalSaveStarted: (() => void) | null = null

  const saveStarted = new Promise<void>(resolve => {
    signalSaveStarted = resolve
  })

  const saveGate = new Promise<void>(resolve => {
    releaseSave = resolve
  })

  const tokenStore: PlatformTokenStore = {
    load: async () => persisted,
    save: async (_origin, tokens) => {
      if (options.delaySave) {
        signalSaveStarted?.()
        await saveGate
      }

      persisted = tokens

      return 'encrypted'
    },
    clear: async () => {
      persisted = null
    }
  }

  const auth = createPlatformAuth({
    client: createPlatformClient({ origin: `http://127.0.0.1:${address.port}`, allowInsecureLoopback: true }),
    tokenStore,
    now: () => 10_000
  })

  await auth.initialize()

  return {
    auth,
    get refreshCalls() {
      return refreshCalls
    },
    waitForPendingProfile: () => pendingProfileReady,
    resolvePendingProfile: () => pendingProfile?.(),
    waitForSave: () => saveStarted,
    releaseSave: () => releaseSave?.(),
    get persisted() {
      return persisted
    }
  }
}

describe('platform auth ownership', () => {
  it('keeps account revisions stable when authenticated resources fail without changing authentication', async () => {
    const origin = await servePlatform(async ({ path }) => {
      if (path === '/api/v1/user/profile') {
        return okProfile(17, 'owner')
      }

      return errorEnvelope(404, 'NOT_FOUND')
    })

    const auth = createAuth(origin, rememberedTokens('owner'))

    await auth.initialize()
    const snapshot = auth.snapshot()
    const published: unknown[] = []
    const unsubscribe = auth.subscribe(value => published.push(value))

    try {
      await expect(auth.models()).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await expect(auth.walletSummary('17')).rejects.toMatchObject({ code: 'NOT_FOUND' })
      expect(auth.snapshot()).toBe(snapshot)
      expect(published).toEqual([])
      expect(auth.billingScope('17').generation).toBe(auth.generation())
    } finally {
      unsubscribe()
    }
  })

  it('fences wallet results by account ownership and exposes only the safe platform scope', async () => {
    const started = deferred<void>()
    const response = deferred<unknown>()

    const origin = await servePlatform(async ({ path }) => {
      if (path === '/api/v1/user/profile') {
        return okProfile(17, 'owner')
      }

      if (path === '/api/v1/auth/logout') {
        return ok({ success: true })
      }

      if (path === '/api/v1/desktop/billing-summary') {
        started.resolve()

        return ok(await response.promise)
      }

      return errorEnvelope(404, 'NOT_FOUND')
    })

    const auth = createAuth(origin, rememberedTokens('owner'))
    await auth.initialize()
    expect(auth.billingScope('17')).toEqual({ origin, user_id: '17', generation: auth.generation() })
    expect(() => auth.walletSummary('18')).toThrow('platform_account_changed')
    const pending = auth.walletSummary('17')
    const rejected = expect(pending).rejects.toMatchObject({ code: 'auth_attempt_superseded' })
    await started.promise
    await auth.logout()
    response.resolve({
      currency: 'USD',
      balance: '1.00000000',
      available_balance: '1.00000000',
      frozen_balance: '0',
      payment_enabled: false,
      active_subscriptions: [],
      updated_at: '2026-09-16T00:00:00Z'
    })
    await rejected
    expect(() => auth.billingScope('17')).toThrow()
  })

  it('rejects foreign usage reads and suppresses a ledger response arriving after logout', async () => {
    const started = deferred<void>()
    const response = deferred<unknown>()
    let usageRequests = 0

    const origin = await servePlatform(async ({ path }) => {
      if (path === '/api/v1/user/profile') {
        return okProfile(17, 'owner')
      }

      if (path === '/api/v1/auth/logout') {
        return ok({ success: true })
      }

      if (path.startsWith('/api/v1/usage?')) {
        usageRequests += 1
        started.resolve()

        return ok(await response.promise)
      }

      return errorEnvelope(404, 'NOT_FOUND')
    })

    const auth = createAuth(origin, rememberedTokens('owner'))
    await auth.initialize()
    expect(() => auth.listUsage({ page: 1, page_size: 50 }, '18')).toThrow('platform_account_changed')
    expect(usageRequests).toBe(0)
    const pending = auth.listUsage({ page: 1, page_size: 50 }, '17')
    const rejected = expect(pending).rejects.toMatchObject({ code: 'auth_attempt_superseded' })
    await started.promise
    await auth.logout()
    response.resolve({ items: [], page: 1, page_size: 50, total: 0 })
    await rejected
    expect(auth.snapshot().phase).toBe('signed_out')
  })

  it('single-flights refresh and persists the rotated token family', async () => {
    const f = await createPlatformAuthTestRig()
    const one = f.auth.refresh()
    const two = f.auth.refresh()
    await f.waitForPendingProfile()
    f.resolvePendingProfile()
    await Promise.all([one, two])
    expect(f.refreshCalls).toBe(1)
    expect(f.persisted).toMatchObject({ accessToken: 'rotated-access', refreshToken: 'rotated-refresh' })
  })

  it('does not restore a logged-out account from a late response', async () => {
    const f = await createPlatformAuthTestRig()
    const pending = f.auth.refresh()
    await f.waitForPendingProfile()
    await f.auth.logout()
    f.resolvePendingProfile()
    await pending
    expect(f.auth.snapshot().phase).toBe('signed_out')
    expect(f.persisted).toBeNull()
  })

  it('clears a remembered token write that finishes after logout', async () => {
    const f = await createPlatformAuthTestRig({ delaySave: true })
    const pending = f.auth.refresh()
    await f.waitForSave()
    const logout = f.auth.logout()
    f.releaseSave()
    await Promise.all([pending, logout])
    expect(f.persisted).toBeNull()
  })

  it('keeps the last account while offline but requires reauthentication on a confirmed 401', async () => {
    const origin = await serveSequence([
      [200, { code: 0, message: 'ok', data: { id: 2, username: 'Lin', email: 'lin@example.test' } }],
      [503, { code: 'UPSTREAM', message: 'down' }],
      [401, { code: 'TOKEN_INVALID', message: 'revoked' }]
    ])

    const tokens = { accessToken: 'access', refreshToken: 'refresh', expiresAt: 999_999 }
    const store: PlatformTokenStore = { load: async () => tokens, save: async () => 'encrypted', clear: async () => {} }

    const auth = createPlatformAuth({
      client: createPlatformClient({ origin, allowInsecureLoopback: true }),
      tokenStore: store,
      now: () => 1
    })

    await auth.initialize()
    expect(auth.snapshot().phase).toBe('signed_in')
    await auth.refresh()
    expect(auth.snapshot()).toMatchObject({ phase: 'offline', account: { id: '2' } })
    await auth.refresh()
    expect(auth.snapshot()).toMatchObject({ phase: 'reauth_required', account: { id: '2' } })
  })

  it('rejects a stale 2FA result and keeps only the newest pending challenge', async () => {
    let resolveOld: ((value: unknown) => void) | null = null

    const oldResult = new Promise<unknown>(resolve => {
      resolveOld = resolve
    })

    let completedTempToken = ''
    let profileId = 1

    const origin = await servePlatform(async ({ path, body }) => {
      if (path === '/api/v1/user/profile') {
        return okProfile(profileId, profileId === 1 ? 'old' : 'new')
      }

      if (path === '/api/v1/auth/login') {
        if (body.email === 'old-attempt@example.test') {
          return oldResult
        }

        return ok({ requires_2fa: true, temp_token: 'new-temp' })
      }

      if (path === '/api/v1/auth/login/2fa') {
        completedTempToken = String(body.temp_token)
        profileId = 2

        return okTokens('new')
      }

      throw new Error(`unexpected ${path}`)
    })

    const auth = createAuth(origin)
    await auth.initialize()

    const stale = auth.loginExisting({
      email: 'old-attempt@example.test',
      password: 'old-password',
      remember: false
    })

    const current = auth.loginExisting({ email: 'new-attempt@example.test', password: 'new-password', remember: false })
    await expect(current).resolves.toEqual({ status: 'requires_2fa' })
    resolveOld?.(ok({ requires_2fa: true, temp_token: 'old-temp' }))
    await expect(stale).rejects.toMatchObject({ code: 'auth_attempt_superseded' })
    await expect(auth.completeSecondFactor({ totp_code: '123456' })).resolves.toMatchObject({
      phase: 'signed_in',
      account: { id: '2' }
    })
    expect(completedTempToken).toBe('new-temp')
  })

  it('clears an older 2FA challenge when a replacement attempt fails', async () => {
    const origin = await servePlatform(async ({ path, body }) => {
      if (path === '/api/v1/auth/login') {
        return body.email === 'first@example.test'
          ? ok({ requires_2fa: true, temp_token: 'old-temp' })
          : errorEnvelope(401, 'INVALID_CREDENTIALS')
      }

      throw new Error(`unexpected ${path}`)
    })

    const auth = createAuth(origin)
    await auth.initialize()
    await auth.loginExisting({ email: 'first@example.test', password: 'password', remember: false })

    await expect(
      auth.loginExisting({ email: 'second@example.test', password: 'wrong', remember: false })
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    await expect(auth.completeSecondFactor({ totp_code: '123456' })).rejects.toMatchObject({
      code: 'second_factor_not_pending'
    })
  })

  it('preserves the old signed-in account and token after a failed account switch', async () => {
    let updateAuth = ''

    const origin = await servePlatform(async ({ path, authorization, body }) => {
      if (path === '/api/v1/user/profile') {
        return okProfile(1, 'old')
      }

      if (path === '/api/v1/auth/login') {
        return errorEnvelope(401, 'INVALID_CREDENTIALS')
      }

      if (path === '/api/v1/user') {
        updateAuth = authorization

        return okProfile(1, String(body.username))
      }

      throw new Error(`unexpected ${path}`)
    })

    const auth = createAuth(origin, rememberedTokens('old'))
    await auth.initialize()

    await expect(
      auth.loginExisting({ email: 'other@example.test', password: 'wrong', remember: true })
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    expect(auth.snapshot()).toMatchObject({ phase: 'signed_in', account: { id: '1', display_name: 'old' } })
    await expect(auth.updateProfile({ display_name: 'still-old' })).resolves.toMatchObject({
      phase: 'signed_in',
      account: { id: '1', display_name: 'still-old' }
    })
    expect(updateAuth).toBe('Bearer old-access')
  })

  it('keeps logout truthful, attempts remote revocation, and restores after local deletion failure', async () => {
    let logoutCalls = 0

    const origin = await servePlatform(async ({ path }) => {
      if (path === '/api/v1/user/profile') {
        return okProfile(1, 'old')
      }

      if (path === '/api/v1/auth/logout') {
        logoutCalls += 1

        return errorEnvelope(503, 'REVOCATION_UNAVAILABLE')
      }

      throw new Error(`unexpected ${path}`)
    })

    const stored = rememberedTokens('old')

    const store: PlatformTokenStore = {
      load: async () => stored,
      save: async () => 'encrypted',
      clear: async () => {
        throw Object.assign(new Error('disk denied'), { code: 'secure_store_write_failed' })
      }
    }

    const first = createAuth(origin, stored, store)
    await first.initialize()
    await expect(first.logout()).rejects.toMatchObject({ code: 'secure_store_write_failed' })
    expect(logoutCalls).toBe(1)
    expect(first.snapshot()).toMatchObject({
      phase: 'signed_in',
      account: { id: '1' },
      error: { code: 'secure_store_write_failed' }
    })

    const restarted = createAuth(origin, stored, store)
    await restarted.initialize()
    expect(restarted.snapshot()).toMatchObject({ phase: 'signed_in', account: { id: '1' } })
  })

  it('surfaces unconfirmed remote revocation after durable local logout', async () => {
    const origin = await servePlatform(async ({ path }) => {
      if (path === '/api/v1/user/profile') {
        return okProfile(1, 'old')
      }

      if (path === '/api/v1/auth/logout') {
        return errorEnvelope(503, 'REVOCATION_UNAVAILABLE')
      }
      throw new Error(`unexpected ${path}`)
    })

    const auth = createAuth(origin, rememberedTokens('old'))
    await auth.initialize()

    await expect(auth.logout()).resolves.toMatchObject({
      phase: 'signed_out',
      error: { code: 'logout_revocation_unconfirmed' }
    })
  })

  it('isolates subscriber failures from a successful authentication transition', async () => {
    const origin = await servePlatform(async ({ path }) => {
      if (path === '/api/v1/auth/login') {
        return okTokens('new')
      }

      if (path === '/api/v1/user/profile') {
        return okProfile(2, 'new')
      }
      throw new Error(`unexpected ${path}`)
    })

    const auth = createAuth(origin)
    await auth.initialize()
    auth.subscribe(() => {
      throw new Error('observer failed')
    })

    await expect(
      auth.loginExisting({ email: 'new@example.test', password: 'password', remember: false })
    ).resolves.toMatchObject({ status: 'signed_in', snapshot: { account: { id: '2' } } })
  })

  it('coalesces concurrent authenticated 401s into one refresh and retries idempotent profile updates', async () => {
    let refreshCalls = 0
    let oldUpdateCalls = 0
    let newUpdateCalls = 0

    const origin = await servePlatform(async ({ path, authorization, body }) => {
      if (path === '/api/v1/user/profile') {
        return okProfile(1, 'old')
      }

      if (path === '/api/v1/user') {
        if (authorization === 'Bearer old-access') {
          oldUpdateCalls += 1

          return errorEnvelope(401, 'TOKEN_EXPIRED')
        }

        newUpdateCalls += 1

        return okProfile(1, String(body.username))
      }

      if (path === '/api/v1/auth/refresh') {
        refreshCalls += 1

        return okTokens('new')
      }

      throw new Error(`unexpected ${path}`)
    })

    const auth = createAuth(origin, rememberedTokens('old'))
    await auth.initialize()

    await Promise.all([auth.updateProfile({ display_name: 'first' }), auth.updateProfile({ display_name: 'second' })])
    expect(oldUpdateCalls).toBe(2)
    expect(refreshCalls).toBe(1)
    expect(newUpdateCalls).toBe(2)
  })

  it('refreshes but does not automatically replay a non-repeatable binding-code request', async () => {
    let bindingCalls = 0
    let refreshCalls = 0

    const origin = await servePlatform(async ({ path, authorization }) => {
      if (path === '/api/v1/user/profile') {
        return okProfile(1, 'old')
      }

      if (path === '/api/v1/user/account-bindings/phone/send-code') {
        bindingCalls += 1

        if (authorization === 'Bearer old-access') {
          return errorEnvelope(401, 'TOKEN_EXPIRED')
        }

        return ok({ challenge_id: 'challenge', expires_in: 300, retry_after: 60, delivery: 'submitted' })
      }

      if (path === '/api/v1/auth/refresh') {
        refreshCalls += 1

        return okTokens('new')
      }

      throw new Error(`unexpected ${path}`)
    })

    const auth = createAuth(origin, rememberedTokens('old'))
    await auth.initialize()

    await expect(auth.requestBindingCode({ phone: '13900000000' })).rejects.toMatchObject({
      code: 'authentication_refreshed_retry_required'
    })
    expect(bindingCalls).toBe(1)
    expect(refreshCalls).toBe(1)
    await expect(auth.requestBindingCode({ phone: '13900000000' })).resolves.toMatchObject({
      challenge_id: 'challenge'
    })
    expect(bindingCalls).toBe(2)
  })

  it('does not let an older delayed logout overwrite a newer completed login', async () => {
    const logoutResponse = deferred<ReturnType<typeof ok>>()
    const logoutStarted = deferred<void>()
    let profile = 'old'

    const origin = await servePlatform(async ({ path }) => {
      if (path === '/api/v1/user/profile') {
        return okProfile(profile === 'old' ? 1 : 2, profile)
      }

      if (path === '/api/v1/auth/logout') {
        logoutStarted.resolve()

        return logoutResponse.promise
      }

      if (path === '/api/v1/auth/login') {
        profile = 'new'

        return okTokens('new')
      }

      throw new Error(`unexpected ${path}`)
    })

    let stored: PlatformTokenSet | null = rememberedTokens('old')

    const store: PlatformTokenStore = {
      load: async () => stored,
      save: async (_origin, value) => {
        stored = value

        return 'encrypted'
      },
      clear: async () => {
        stored = null
      }
    }

    const auth = createAuth(origin, stored, store)
    await auth.initialize()

    const logout = auth.logout()
    await logoutStarted.promise
    await expect(
      auth.loginExisting({ email: 'new@example.test', password: 'password', remember: true })
    ).resolves.toMatchObject({ status: 'signed_in', snapshot: { account: { id: '2' } } })
    expect(stored).toMatchObject({ accessToken: 'new-access' })
    logoutResponse.resolve(ok({ success: true }))
    await logout

    expect(auth.snapshot()).toMatchObject({ phase: 'signed_in', account: { id: '2' } })
    expect(stored).toMatchObject({ accessToken: 'new-access' })
  })

  it('rejects authenticated account work while its credentials are being logged out', async () => {
    const logoutResponse = deferred<ReturnType<typeof ok>>()
    const logoutStarted = deferred<void>()
    let updateCalls = 0

    const origin = await servePlatform(async ({ path }) => {
      if (path === '/api/v1/user/profile') {
        return okProfile(1, 'old')
      }

      if (path === '/api/v1/auth/logout') {
        logoutStarted.resolve()

        return logoutResponse.promise
      }

      if (path === '/api/v1/user') {
        updateCalls += 1

        return okProfile(1, 'revived')
      }

      throw new Error(`unexpected ${path}`)
    })

    const auth = createAuth(origin, rememberedTokens('old'))
    await auth.initialize()
    const logout = auth.logout()
    await logoutStarted.promise

    try {
      await expect(auth.updateProfile({ display_name: 'revived' })).rejects.toMatchObject({
        code: 'logout_in_progress'
      })
    } finally {
      logoutResponse.resolve(ok({ success: true }))
      await logout
    }

    expect(updateCalls).toBe(0)
    expect(auth.snapshot()).toMatchObject({ phase: 'signed_out', account: null })
  })

  it('coalesces concurrent logout callers without releasing the credential guard early', async () => {
    const logoutResponses = [deferred<ReturnType<typeof ok>>(), deferred<ReturnType<typeof ok>>()]
    const logoutStarted = deferred<void>()
    let logoutCalls = 0
    let updateCalls = 0

    const origin = await servePlatform(async ({ path }) => {
      if (path === '/api/v1/user/profile') {
        return okProfile(1, 'old')
      }

      if (path === '/api/v1/auth/logout') {
        const response = logoutResponses[logoutCalls]
        logoutCalls += 1
        logoutStarted.resolve()

        return response.promise
      }

      if (path === '/api/v1/user') {
        updateCalls += 1

        return okProfile(1, 'revived')
      }

      throw new Error(`unexpected ${path}`)
    })

    const auth = createAuth(origin, rememberedTokens('old'))
    await auth.initialize()
    const first = auth.logout()
    await logoutStarted.promise
    const second = auth.logout()

    await expect(auth.updateProfile({ display_name: 'revived' })).rejects.toMatchObject({
      code: 'logout_in_progress'
    })
    logoutResponses[0].resolve(ok({ success: true }))
    logoutResponses[1].resolve(ok({ success: true }))
    await Promise.all([first, second])

    expect(logoutCalls).toBe(1)
    expect(updateCalls).toBe(0)
    expect(auth.snapshot()).toMatchObject({ phase: 'signed_out', account: null })
  })

  it('retires successfully logged-out credentials after a newer replacement login fails', async () => {
    const logoutResponse = deferred<ReturnType<typeof ok>>()
    const logoutStarted = deferred<void>()
    let updateCalls = 0

    const origin = await servePlatform(async ({ path }) => {
      if (path === '/api/v1/user/profile') {
        return okProfile(1, 'old')
      }

      if (path === '/api/v1/auth/logout') {
        logoutStarted.resolve()

        return logoutResponse.promise
      }

      if (path === '/api/v1/auth/login') {
        return errorEnvelope(401, 'INVALID_CREDENTIALS')
      }

      if (path === '/api/v1/user') {
        updateCalls += 1

        return okProfile(1, 'revived')
      }

      throw new Error(`unexpected ${path}`)
    })

    let stored: PlatformTokenSet | null = rememberedTokens('old')

    const store: PlatformTokenStore = {
      load: async () => stored,
      save: async () => 'encrypted',
      clear: async () => {
        stored = null
      }
    }

    const auth = createAuth(origin, stored, store)
    await auth.initialize()
    const logout = auth.logout()
    await logoutStarted.promise
    await expect(
      auth.loginExisting({ email: 'replacement@example.test', password: 'wrong', remember: true })
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    logoutResponse.resolve(ok({ success: true }))
    await logout

    expect(stored).toBeNull()
    expect(auth.snapshot()).toMatchObject({ phase: 'signed_out', account: null })
    await expect(auth.updateProfile({ display_name: 'revived' })).rejects.toMatchObject({
      code: 'authentication_required'
    })
    expect(updateCalls).toBe(0)
  })

  it('does not restore retired credentials when a replacement login fails after logout completes', async () => {
    const logoutResponse = deferred<ReturnType<typeof ok>>()
    const logoutStarted = deferred<void>()
    const loginResponse = deferred<ReturnType<typeof errorEnvelope>>()
    const loginStarted = deferred<void>()
    let updateCalls = 0

    const origin = await servePlatform(async ({ path }) => {
      if (path === '/api/v1/user/profile') {
        return okProfile(1, 'old')
      }

      if (path === '/api/v1/auth/logout') {
        logoutStarted.resolve()

        return logoutResponse.promise
      }

      if (path === '/api/v1/auth/login') {
        loginStarted.resolve()

        return loginResponse.promise
      }

      if (path === '/api/v1/user') {
        updateCalls += 1

        return okProfile(1, 'revived')
      }

      throw new Error(`unexpected ${path}`)
    })

    let stored: PlatformTokenSet | null = rememberedTokens('old')

    const store: PlatformTokenStore = {
      load: async () => stored,
      save: async (_origin, value) => {
        stored = value

        return 'encrypted'
      },
      clear: async () => {
        stored = null
      }
    }

    const auth = createAuth(origin, stored, store)
    await auth.initialize()
    const logout = auth.logout()
    await logoutStarted.promise

    const login = expect(
      auth.loginExisting({ email: 'replacement@example.test', password: 'wrong', remember: true })
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })

    await loginStarted.promise
    logoutResponse.resolve(ok({ success: true }))
    await expect(logout).resolves.toMatchObject({ phase: 'signed_out', account: null })
    loginResponse.resolve(errorEnvelope(401, 'INVALID_CREDENTIALS'))
    await login

    expect(stored).toBeNull()
    await expect(auth.updateProfile({ display_name: 'revived' })).rejects.toMatchObject({
      code: 'authentication_required'
    })
    expect(updateCalls).toBe(0)
    expect(auth.snapshot()).toMatchObject({ phase: 'signed_out', account: null, remember_state: 'session_only' })
  })

  it.each(['before', 'after'])('preserves a newer 2FA challenge arriving %s logout completes', async ordering => {
    const logoutResponse = deferred<ReturnType<typeof ok>>()
    const logoutStarted = deferred<void>()
    const loginResponse = deferred<ReturnType<typeof ok>>()
    const loginStarted = deferred<void>()
    let profile = 'old'

    const origin = await servePlatform(async ({ path, body }) => {
      if (path === '/api/v1/user/profile') {
        return okProfile(profile === 'old' ? 1 : 2, profile)
      }

      if (path === '/api/v1/auth/logout') {
        logoutStarted.resolve()

        return logoutResponse.promise
      }

      if (path === '/api/v1/auth/login') {
        loginStarted.resolve()

        return loginResponse.promise
      }

      if (path === '/api/v1/auth/login/2fa') {
        expect(body.temp_token).toBe('replacement-temp')

        if (body.totp_code === '000000') {
          return errorEnvelope(401, 'INVALID_TOTP_CODE')
        }
        profile = 'new'

        return okTokens('new')
      }

      throw new Error(`unexpected ${path}`)
    })

    const auth = createAuth(origin, rememberedTokens('old'))
    await auth.initialize()
    const logout = auth.logout()
    await logoutStarted.promise

    const login = expect(
      auth.loginExisting({ email: 'replacement@example.test', password: 'password', remember: false })
    ).resolves.toEqual({ status: 'requires_2fa' })

    await loginStarted.promise

    if (ordering === 'before') {
      loginResponse.resolve(ok({ requires_2fa: true, temp_token: 'replacement-temp' }))
      await login
    }

    logoutResponse.resolve(ok({ success: true }))
    await logout

    if (ordering === 'after') {
      loginResponse.resolve(ok({ requires_2fa: true, temp_token: 'replacement-temp' }))
      await login
    }

    expect(auth.snapshot()).toMatchObject({ phase: 'signed_out', account: null })
    await expect(auth.completeSecondFactor({ totp_code: '000000' })).rejects.toMatchObject({
      code: 'INVALID_TOTP_CODE'
    })
    expect(auth.snapshot()).toMatchObject({ phase: 'signed_out', account: null })
    await expect(auth.completeSecondFactor({ totp_code: '123456' })).resolves.toMatchObject({
      phase: 'signed_in',
      account: { id: '2' }
    })
  })

  it('coalesces a delayed old-token 401 after the first refresh has already rotated credentials', async () => {
    const secondOldResponse = deferred<ReturnType<typeof errorEnvelope>>()
    const secondOldStarted = deferred<void>()
    const firstNewUpdate = deferred<void>()
    let oldCalls = 0
    let refreshCalls = 0

    const origin = await servePlatform(async ({ path, authorization, body }) => {
      if (path === '/api/v1/user/profile') {
        return okProfile(1, 'old')
      }

      if (path === '/api/v1/user') {
        if (authorization === 'Bearer old-access') {
          oldCalls += 1

          if (oldCalls === 2) {
            secondOldStarted.resolve()

            return secondOldResponse.promise
          }

          return errorEnvelope(401, 'TOKEN_EXPIRED')
        }

        firstNewUpdate.resolve()

        return okProfile(1, String(body.username))
      }

      if (path === '/api/v1/auth/refresh') {
        refreshCalls += 1

        return okTokens('new')
      }

      throw new Error(`unexpected ${path}`)
    })

    const auth = createAuth(origin, rememberedTokens('old'))
    await auth.initialize()
    const first = auth.updateProfile({ display_name: 'first' })
    const second = auth.updateProfile({ display_name: 'second' })
    await secondOldStarted.promise
    await firstNewUpdate.promise
    secondOldResponse.resolve(errorEnvelope(401, 'TOKEN_EXPIRED'))
    await Promise.all([first, second])

    expect(refreshCalls).toBe(1)
  })

  it('retains a rotated refresh family when profile recovery is transiently unavailable', async () => {
    let profileCalls = 0
    let refreshCalls = 0
    let stored: PlatformTokenSet | null = rememberedTokens('old')

    const origin = await servePlatform(async ({ path, authorization }) => {
      if (path === '/api/v1/user/profile') {
        profileCalls += 1

        if (profileCalls === 2) {
          return errorEnvelope(503, 'PROFILE_UNAVAILABLE')
        }

        expect(authorization).toBe(profileCalls === 1 ? 'Bearer old-access' : 'Bearer new-access')

        return okProfile(1, 'old')
      }

      if (path === '/api/v1/auth/refresh') {
        refreshCalls += 1

        return refreshCalls === 1 ? okTokens('new') : errorEnvelope(401, 'REFRESH_TOKEN_REVOKED')
      }

      throw new Error(`unexpected ${path}`)
    })

    const store: PlatformTokenStore = {
      load: async () => stored,
      save: async (_origin, value) => {
        stored = value

        return 'encrypted'
      },
      clear: async () => {
        stored = null
      }
    }

    const auth = createAuth(origin, stored, store)
    await auth.initialize()
    await auth.refresh()

    expect(auth.snapshot()).toMatchObject({ phase: 'offline', account: { id: '1' } })
    expect(stored).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh' })
    await expect(auth.retry()).resolves.toMatchObject({ phase: 'signed_in', account: { id: '1' } })
    expect(refreshCalls).toBe(1)
  })

  it('retries offline restoration through the narrow account recovery method', async () => {
    let available = false

    const origin = await servePlatform(async ({ path }) => {
      if (path === '/api/v1/user/profile') {
        return available ? okProfile(1, 'old') : errorEnvelope(503, 'OFFLINE')
      }

      if (path === '/api/v1/auth/refresh') {
        return okTokens('new')
      }
      throw new Error(`unexpected ${path}`)
    })

    const auth = createAuth(origin, rememberedTokens('old'))
    await auth.initialize()
    expect(auth.snapshot().phase).toBe('offline')
    available = true

    await expect(auth.retry()).resolves.toMatchObject({ phase: 'signed_in', account: { id: '1' } })
  })
})

function rememberedTokens(prefix: string): PlatformTokenSet {
  return { accessToken: `${prefix}-access`, refreshToken: `${prefix}-refresh`, expiresAt: 999_999 }
}

function createAuth(origin: string, initial: PlatformTokenSet | null = null, suppliedStore?: PlatformTokenStore) {
  let stored = initial

  const store: PlatformTokenStore = suppliedStore ?? {
    load: async () => stored,
    save: async (_origin, value) => {
      stored = value

      return 'encrypted'
    },
    clear: async () => {
      stored = null
    }
  }

  return createPlatformAuth({
    client: createPlatformClient({ origin, allowInsecureLoopback: true, now: () => 1 }),
    tokenStore: store,
    now: () => 1
  })
}

function ok(data: unknown) {
  return { status: 200, body: { code: 0, message: 'success', data } }
}

function okProfile(id: number, username: string) {
  return ok({ id, username, email: `${username}@example.test`, phone_bound: false })
}

function okTokens(prefix: string) {
  return ok({
    access_token: `${prefix}-access`,
    refresh_token: `${prefix}-refresh`,
    expires_in: 3600,
    token_type: 'Bearer'
  })
}

function errorEnvelope(status: number, reason: string) {
  return { status, body: { code: status, message: reason, reason } }
}

async function servePlatform(
  handler: (request: { path: string; body: Record<string, unknown>; authorization: string }) => Promise<any>
) {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []

    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk))
    }
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : {}

    const result = await handler({
      path: req.url || '/',
      body,
      authorization: String(req.headers.authorization || '')
    })

    res.statusCode = result.status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(result.body))
  })

  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))

  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}

async function serveSequence(responses: Array<[number, unknown]>) {
  const server = http.createServer((_req, res) => {
    const [status, body] = responses.shift() ?? [500, {}]
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  })

  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))

  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}
