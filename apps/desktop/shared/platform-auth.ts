import {
  type PlatformClient,
  PlatformClientError,
  type PlatformLeaseInput,
  type PlatformProfile
} from './platform-client'
import type {
  PhoneVerifyDTO,
  PlatformAccountSnapshot,
  PlatformAuthResult,
  PlatformBillingScope,
  PlatformCaptchaProof,
  PlatformDeviceInfo,
  PlatformDeviceOwner,
  PlatformPublicCapabilities
} from './platform-contract'
import { parsePlatformDeviceInfo } from './platform-device-contract'
import type { PlatformDeviceKey, PlatformTokenSet, PlatformTokenStore } from './platform-token-contract'

interface RetainedAccount {
  credentials: PlatformTokenSet
  snapshot: PlatformAccountSnapshot
}

export interface PlatformAuth {
  uploadDiagnostics(bundle: string, owner: PlatformDeviceOwner): ReturnType<PlatformClient['uploadDiagnostics']>
  listDevices(owner: PlatformDeviceOwner): ReturnType<PlatformClient['listDevices']>
  revokeDevice(deviceId: string, owner: PlatformDeviceOwner): ReturnType<PlatformClient['revokeDevice']>
  quote(input: Parameters<PlatformClient['quote']>[1], expectedUserId: string): ReturnType<PlatformClient['quote']>
  createOrder(
    input: Parameters<PlatformClient['createOrder']>[1],
    expectedUserId: string
  ): ReturnType<PlatformClient['getOrder']>
  getOrder(orderId: string, expectedUserId: string): ReturnType<PlatformClient['getOrder']>
  listOrders(
    input: Parameters<PlatformClient['listOrders']>[1],
    expectedUserId: string
  ): ReturnType<PlatformClient['listOrders']>
  cancelOrder(orderId: string, expectedUserId: string): ReturnType<PlatformClient['getOrder']>
  billingScope(expectedUserId: string): PlatformBillingScope
  walletSummary(expectedUserId: string): ReturnType<PlatformClient['walletSummary']>
  checkoutInfo(expectedUserId: string): ReturnType<PlatformClient['checkoutInfo']>
  listUsage(
    input: Parameters<PlatformClient['listUsage']>[1],
    expectedUserId: string
  ): ReturnType<PlatformClient['listUsage']>
  models(): ReturnType<PlatformClient['models']>
  modelLease(input: PlatformLeaseInput): ReturnType<PlatformClient['modelLease']>
  ensureDeviceKey(deviceId: string, reauthorize?: boolean): Promise<PlatformDeviceKey & { api_key: string }>
  supportsDeviceKey(deviceId: string): Promise<boolean>
  rejectDeviceKey(deviceId: string, credentialVersion: number): Promise<void>
  initialize(): Promise<PlatformAccountSnapshot>
  generation(): number
  snapshot(): PlatformAccountSnapshot
  subscribe(listener: (snapshot: PlatformAccountSnapshot) => void): () => void
  capabilities(): Promise<PlatformPublicCapabilities>
  refresh(): Promise<PlatformAccountSnapshot>
  retry(): Promise<PlatformAccountSnapshot>
  requestPhoneCode(input: {
    phone: string
    captcha_proof?: PlatformCaptchaProof
  }): ReturnType<PlatformClient['requestPhoneCode']>
  verifyPhoneCode(input: PhoneVerifyDTO): Promise<PlatformAuthResult>
  loginExisting(input: {
    email: string
    password: string
    captcha_proof?: PlatformCaptchaProof
    remember: boolean
  }): Promise<PlatformAuthResult>
  completeSecondFactor(input: { totp_code: string }): Promise<PlatformAccountSnapshot>
  updateProfile(input: { display_name: string }): Promise<PlatformAccountSnapshot>
  requestBindingCode(input: {
    phone: string
    captcha_proof?: PlatformCaptchaProof
  }): ReturnType<PlatformClient['requestBindingCode']>
  submitStepUp(input: {
    totp_code: string
    expected_user_id?: string
    expected_generation?: number
  }): Promise<PlatformAccountSnapshot>
  bindPhone(input: { phone: string; challenge_id: string; code: string }): Promise<PlatformAccountSnapshot>
  logout(): Promise<PlatformAccountSnapshot>
}

export function createPlatformAuth({
  client,
  tokenStore,
  now,
  nativeDeviceId,
  nativeDeviceInfo
}: {
  client: PlatformClient
  tokenStore: PlatformTokenStore
  now: () => number
  /** Only the native desktop prepares a device credential after a fresh login. */
  nativeDeviceId?: () => string
  nativeDeviceInfo?: () => PlatformDeviceInfo | Promise<PlatformDeviceInfo>
}): PlatformAuth {
  let tokens: PlatformTokenSet | null = null
  let pendingSecondFactor: { tempToken: string; remember: boolean } | null = null
  let generation = 0
  let catalog: { generation: number; models: Awaited<ReturnType<PlatformClient['models']>> } | null = null
  const deviceFlights = new Map<string, Promise<PlatformDeviceKey & { api_key: string }>>()
  const revokedDevices = new Set<string>()
  const suspendedDevices = new Set<string>()
  const rolloutDeniedDevices = new Set<string>()
  const deviceCapabilities = new Map<string, Promise<boolean>>()
  const deviceIntents = new Map<string, number>()
  const sentDeviceInfo = new Set<string>()
  const deviceInfoFlights = new Map<string, Promise<void>>()
  let nativeInfoSnapshot: PlatformDeviceInfo | undefined

  let refreshFlight: {
    generation: number
    source: PlatformTokenSet
    promise: Promise<PlatformAccountSnapshot>
  } | null = null

  const logoutFlights = new Map<PlatformTokenSet, Promise<PlatformAccountSnapshot>>()
  let persistence = Promise.resolve<unknown>(undefined)

  let current: PlatformAccountSnapshot = {
    revision: 0,
    phase: 'signed_out',
    account: null,
    mode: client.origin === 'https://api.agentera.com.cn' ? 'production' : 'development',
    remember_state: 'session_only',
    error: null
  }

  const listeners = new Set<(snapshot: PlatformAccountSnapshot) => void>()

  function publish(patch: Partial<PlatformAccountSnapshot>, advanceRevision = true) {
    current = { ...current, ...patch, revision: current.revision + (advanceRevision ? 1 : 0) }

    for (const listener of listeners) {
      try {
        listener(current)
      } catch {
        // Observers cannot roll back an authoritative account transition.
      }
    }

    return current
  }

  function safeError(error: unknown) {
    return error instanceof PlatformClientError
      ? { code: error.code, ...(error.retryAfter === undefined ? {} : { retry_after: error.retryAfter }) }
      : {
          code:
            typeof (error as { code?: unknown })?.code === 'string'
              ? String((error as { code: string }).code)
              : 'platform_error'
        }
  }

  function requireTokens() {
    if (!tokens) {
      throw new PlatformClientError('authentication_required', true)
    }

    if (logoutFlights.has(tokens)) {
      throw new PlatformClientError('logout_in_progress')
    }

    return tokens
  }

  function persist<T>(operation: () => Promise<T>): Promise<T> {
    const result = persistence.then(operation, operation)
    persistence = result.then(
      () => undefined,
      () => undefined
    )

    return result
  }

  async function storeTokens(next: PlatformTokenSet, remember: boolean, expected: number) {
    if (expected !== generation) {
      return false
    }

    const rememberState = remember
      ? await persist(() => tokenStore.save(client.origin, next))
      : await persist(async () => {
          await tokenStore.clear(client.origin)

          return 'session_only' as const
        })

    if (expected !== generation) {
      return false
    }

    return expected === generation ? rememberState : null
  }

  async function rememberVerifiedProfile(profile: PlatformProfile, expected: number) {
    const source = tokens

    if (!source || expected !== generation) {
      return
    }
    const next = { ...source, deviceAccount: profile }

    if (current.remember_state === 'encrypted') {
      await persist(async () => {
        if (tokens === source && generation === expected) {
          await tokenStore.save(client.origin, next)
        }
      })
    }

    if (tokens === source && generation === expected) {
      tokens = next
    }
  }

  async function finishAuthentication(next: PlatformTokenSet, remember: boolean, expected: number) {
    const profile = await client.profile(next.accessToken)

    if (expected !== generation) {
      throw new PlatformClientError('auth_attempt_superseded')
    }

    if (current.account?.id === profile.id && tokens?.deviceKeys) {
      next.deviceKeys = tokens.deviceKeys
      next.deviceModels = tokens.deviceModels
    }

    next.deviceAccount = profile
    const rememberState = await storeTokens(next, remember, expected)

    if (!rememberState || expected !== generation) {
      throw new PlatformClientError('auth_attempt_superseded')
    }

    tokens = next
    pendingSecondFactor = null

    for (const scope of suspendedDevices) {
      if (JSON.parse(scope)[1] === profile.id) {
        suspendedDevices.delete(scope)
      }
    }

    publish({
      phase: 'signed_in',
      account: profile,
      remember_state: rememberState,
      error: null,
      model_identity_ready: Boolean(next.deviceKeys?.some(key => key.user_id === profile.id)),
      model_identity_version: next.deviceKeys?.find(key => key.user_id === profile.id)?.version
    })

    await prepareLoginDeviceKey(profile.id, expected)

    if (expected !== generation) {
      throw new PlatformClientError('auth_attempt_superseded')
    }

    void syncNativeDeviceInfo()

    return current
  }

  async function prepareLoginDeviceKey(userId: string, expected: number) {
    if (!nativeDeviceId) {
      return
    }
    const ownsLogin = () => expected === generation && current.account?.id === userId

    try {
      const deviceId = nativeDeviceId()

      // Creation or recovery requires recent authentication; do not defer it to the first prompt.
      if ((await api.supportsDeviceKey(deviceId)) && ownsLogin()) {
        await ensureDeviceKey(deviceId)
      }
    } catch (error) {
      if (
        !ownsLogin() ||
        (error instanceof PlatformClientError && error.code === 'DESKTOP_DEVICE_KEY_ROLLOUT_DENIED')
      ) {
        return
      }
      // Account login already succeeded. Preserve it and expose the model-credential failure.
      publish(
        {
          error: safeError(error),
          ...(error instanceof PlatformClientError && error.authentication ? {} : { phase: 'signed_in' })
        },
        false
      )
    }
  }

  async function finishExchange(
    exchange: Awaited<ReturnType<PlatformClient['login']>>,
    remember: boolean,
    expected: number
  ): Promise<PlatformAuthResult> {
    if (expected !== generation) {
      throw new PlatformClientError('auth_attempt_superseded')
    }

    if (exchange.tempToken) {
      pendingSecondFactor = { tempToken: exchange.tempToken, remember }

      return { status: 'requires_2fa' }
    }

    if (!exchange.tokens) {
      throw new PlatformClientError('invalid_response')
    }

    return { status: 'signed_in', snapshot: await finishAuthentication(exchange.tokens, remember, expected) }
  }

  function operationPhase(error: unknown) {
    if (error instanceof PlatformClientError && error.authentication) {
      return 'reauth_required' as const
    }

    if (error instanceof PlatformClientError && error.code.startsWith('network_')) {
      return 'offline' as const
    }

    return current.phase
  }

  async function performRefresh(expected: number, failedTokens?: PlatformTokenSet) {
    const previous = requireTokens()

    if (failedTokens && previous !== failedTokens) {
      return current
    }

    if (refreshFlight?.generation === expected && refreshFlight.source === previous) {
      return refreshFlight.promise
    }

    const remember = current.remember_state === 'encrypted'

    const promise = (async () => {
      const next = await client.refresh(previous.refreshToken)

      if (previous.deviceKeys) {
        next.deviceKeys = previous.deviceKeys
      }

      if (previous.deviceAccount) {
        next.deviceAccount = previous.deviceAccount
        next.deviceModels = previous.deviceModels
      }

      if (previous.suspendedDevices) {
        next.suspendedDevices = previous.suspendedDevices
      }
      const rememberState = await storeTokens(next, remember, expected)

      if (!rememberState || expected !== generation) {
        throw new PlatformClientError('auth_attempt_superseded')
      }

      tokens = next
      current = { ...current, remember_state: rememberState }

      const profile = await client.profile(next.accessToken)
      await rememberVerifiedProfile(profile, expected)

      if (expected !== generation) {
        throw new PlatformClientError('auth_attempt_superseded')
      }

      const snapshot = publish({ phase: 'signed_in', account: profile, error: null })
      void syncNativeDeviceInfo()

      return snapshot
    })()

    refreshFlight = { generation: expected, source: previous, promise }

    try {
      return await promise
    } finally {
      if (refreshFlight?.promise === promise) {
        refreshFlight = null
      }
    }
  }

  async function authenticated<T>(operation: (token: string) => Promise<T>, repeatSafe: boolean): Promise<T> {
    const expected = generation
    const initialTokens = requireTokens()

    try {
      try {
        const value = await operation(initialTokens.accessToken)

        if (expected !== generation) {
          throw new PlatformClientError('auth_attempt_superseded')
        }

        return value
      } catch (error) {
        if (!(error instanceof PlatformClientError) || !error.authentication || expected !== generation) {
          throw error
        }

        await performRefresh(expected, initialTokens)

        if (!repeatSafe) {
          throw new PlatformClientError('authentication_refreshed_retry_required')
        }

        const value = await operation(requireTokens().accessToken)

        if (expected !== generation) {
          throw new PlatformClientError('auth_attempt_superseded')
        }

        return value
      }
    } catch (error) {
      const phase = operationPhase(error)

      // Resource errors belong to the caller; new account revisions invalidate
      // resource caches and can turn a failed read into an automatic retry loop.
      if (expected === generation && phase !== current.phase) {
        publish({ phase, error: safeError(error) })
      }

      throw error
    }
  }

  async function withAccountProfile(operation: (token: string) => Promise<PlatformProfile>, repeatSafe: boolean) {
    const profile = await authenticated(operation, repeatSafe)

    return publish({ phase: 'signed_in', account: profile, error: null })
  }

  function beginAuthentication() {
    const previous: RetainedAccount | null =
      tokens && current.account ? { credentials: tokens, snapshot: current } : null

    const expected = ++generation
    deviceFlights.clear()
    deviceCapabilities.clear()
    rolloutDeniedDevices.clear()
    pendingSecondFactor = null

    if (previous) {
      publish({ error: null })
    } else {
      publish({ phase: 'loading', account: null, error: null })
    }

    return { expected, previous }
  }

  function failAuthentication(error: unknown, expected: number, previous: RetainedAccount | null) {
    if (expected !== generation) {
      return
    }

    // A newer intent can survive logout, but its retired account cannot be restored.
    if (previous && previous.credentials !== tokens) {
      publish({ error: safeError(error) })

      return
    }

    if (previous) {
      publish({
        phase: previous.snapshot.phase,
        account: previous.snapshot.account,
        remember_state: previous.snapshot.remember_state,
        error: safeError(error)
      })
    } else {
      publish({ phase: 'signed_out', account: null, error: safeError(error) })
    }
  }

  async function paymentOperation<T>(
    owner: string,
    operation: (token: string) => Promise<T>,
    repeatSafe: boolean
  ): Promise<T> {
    api.billingScope(owner)

    const value = await authenticated(token => {
      api.billingScope(owner)

      return operation(token)
    }, repeatSafe)

    api.billingScope(owner)

    return value
  }

  function checkDeviceOwner(owner: PlatformDeviceOwner) {
    const scope = api.billingScope(owner.expected_user_id)

    if (!Number.isSafeInteger(owner.expected_generation) || scope.generation !== owner.expected_generation) {
      throw new PlatformClientError('platform_account_changed')
    }
  }

  async function deviceOperation<T>(
    owner: PlatformDeviceOwner,
    operation: (token: string) => Promise<T>,
    repeatSafe: boolean
  ) {
    checkDeviceOwner(owner)

    const result = await authenticated(token => {
      checkDeviceOwner(owner)

      return operation(token)
    }, repeatSafe)

    checkDeviceOwner(owner)

    return result
  }

  async function syncNativeDeviceInfo(): Promise<PlatformDeviceInfo | undefined> {
    if (!nativeDeviceId || !nativeDeviceInfo) {
      return undefined
    }
    const expected = generation
    const userId = current.account?.id

    try {
      const info = parsePlatformDeviceInfo(await nativeDeviceInfo(), 'invalid_platform_input')
      nativeInfoSnapshot = info
      const ownsAccount = () =>
        expected === generation && current.account?.id === userId && current.phase === 'signed_in'

      if (!userId || !ownsAccount() || !tokens) {
        return info
      }
      const id = nativeDeviceId()
      const scope = JSON.stringify([client.origin, userId, id, info])
      const flightKey = JSON.stringify([scope, expected])

      if (!sentDeviceInfo.has(scope) && !deviceInfoFlights.has(flightKey)) {
        // Background presentation data never holds a read or changes model authority.
        const flight = client
          .updateDeviceInfo(tokens.accessToken, id, info)
          .then(() => {
            if (ownsAccount()) {
              sentDeviceInfo.add(scope)
            }
          })
          .catch(() => undefined)
          .finally(() => {
            deviceInfoFlights.delete(flightKey)
          })

        deviceInfoFlights.set(flightKey, flight)
      }

      return info
    } catch {
      return undefined
    }
  }

  async function ensureDeviceKey(
    deviceId: string,
    reauthorize = false
  ): Promise<PlatformDeviceKey & { api_key: string }> {
    const userId = current.account?.id

    if (!userId) {
      throw new PlatformClientError('authentication_required', true)
    }

    const scope = JSON.stringify([client.origin, userId, deviceId])
    const active = deviceFlights.get(scope)

    if (active) {
      return active
    }

    const intent = deviceIntents.get(scope) ?? 0
    const cached = tokens?.deviceKeys?.find(key => key.user_id === userId && key.device_id === deviceId)

    if (!reauthorize && revokedDevices.has(scope)) {
      throw new PlatformClientError('DESKTOP_DEVICE_KEY_REVOKED')
    }

    if (!reauthorize && suspendedDevices.has(scope)) {
      throw new PlatformClientError('managed_credential_rejected')
    }

    if (!reauthorize && cached) {
      return cached
    }

    if (reauthorize) {
      generation++
      publish({ model_identity_ready: false, model_identity_version: undefined })
    }

    const expected = generation

    const check = () => {
      if (generation !== expected || current.account?.id !== userId || (deviceIntents.get(scope) ?? 0) !== intent) {
        throw new PlatformClientError('auth_attempt_superseded')
      }
    }

    const promise = (async () => {
      try {
        let key = reauthorize
          ? await authenticated(async token => {
              const state = await client.deviceKeyState(token, deviceId)

              return client.deviceKey(token, {
                device_id: deviceId,
                expected_version: state.version,
                ...(state.status === 'revoked' ? { reauthorize: true } : { rotate: true })
              })
            }, false)
          : await authenticated(token => client.deviceKey(token, { device_id: deviceId }), false)

        check()

        if (key.status === 'revoked') {
          throw new PlatformClientError('DESKTOP_DEVICE_KEY_REVOKED')
        }

        if (!key.api_key) {
          key = await authenticated(
            token => client.deviceKey(token, { device_id: deviceId, rotate: true, expected_version: key.version }),
            false
          )
          check()
        }

        if (key.status !== 'active' || !key.api_key) {
          throw new PlatformClientError('invalid_response')
        }

        const retained = { ...key, api_key: key.api_key, user_id: userId }
        const previous = requireTokens()

        const next = {
          ...previous,
          deviceAccount: current.account!,
          suspendedDevices: previous.suspendedDevices?.filter(
            device => device.user_id !== userId || device.device_id !== deviceId
          ),
          deviceModels: catalog?.models ?? previous.deviceModels,
          deviceKeys: [
            ...(previous.deviceKeys ?? []).filter(key => key.user_id !== userId || key.device_id !== deviceId),
            retained
          ]
        }

        if (current.remember_state === 'encrypted') {
          await persist(async () => {
            check()
            await tokenStore.save(client.origin, next)
          })
          check()
        }

        tokens = next
        revokedDevices.delete(scope)
        suspendedDevices.delete(scope)

        if (reauthorize) {
          publish({ model_identity_ready: true, model_identity_version: key.version })
        }
        // This hint adds no account authority; keep in-flight account fences intact.
        else {
          publish({ model_identity_ready: true, model_identity_version: key.version }, false)
        }

        return retained
      } catch (error) {
        if (error instanceof PlatformClientError && error.code === 'DESKTOP_DEVICE_KEY_REVOKED') {
          revokedDevices.add(scope)
        }

        if (error instanceof PlatformClientError && error.code === 'DESKTOP_DEVICE_KEY_ROLLOUT_DENIED') {
          rolloutDeniedDevices.add(scope)
        }

        throw error
      }
    })()

    deviceFlights.set(scope, promise)

    try {
      return await promise
    } finally {
      if (deviceFlights.get(scope) === promise) {
        deviceFlights.delete(scope)
      }
    }
  }

  const api: PlatformAuth = {
    uploadDiagnostics: (bundle, owner) =>
      deviceOperation(owner, token => client.uploadDiagnostics(token, bundle), false),
    async listDevices(owner) {
      const rows = await deviceOperation(owner, token => client.listDevices(token), true)
      void syncNativeDeviceInfo()
      const info = nativeInfoSnapshot
      checkDeviceOwner(owner)
      const id = nativeDeviceId?.().toLowerCase()

      return id
        ? rows.map(row => ({
            ...row,
            is_current: row.device_id === id,
            ...(row.device_id === id && info ? { device_info: info } : {})
          }))
        : rows
    },
    async revokeDevice(id, owner) {
      const result = await deviceOperation(owner, token => client.revokeDevice(token, id), false)
      const key = tokens?.deviceKeys?.find(key => key.device_id === id && key.user_id === owner.expected_user_id)

      if (key) {
        const scope = JSON.stringify([client.origin, key.user_id, id])
        revokedDevices.add(scope)
        deviceIntents.set(scope, (deviceIntents.get(scope) ?? 0) + 1)
        tokens!.deviceKeys = tokens!.deviceKeys!.filter(row => row !== key)

        if (current.remember_state === 'encrypted') {
          await persist(() => tokenStore.save(client.origin, tokens!))
        }

        publish({ model_identity_ready: Boolean(tokens?.deviceKeys?.length) })
      }

      return result
    },
    quote: (input, owner) => paymentOperation(owner, token => client.quote(token, input), true),
    async createOrder(input, owner) {
      const scope = api.billingScope(owner)
      const id = await paymentOperation(owner, token => client.createOrder(token, input), false)

      if (scope.generation !== generation) {
        throw new PlatformClientError('auth_attempt_superseded')
      }

      return api.getOrder(id, owner)
    },
    getOrder: (id, owner) => paymentOperation(owner, token => client.getOrder(token, id), true),
    listOrders: (input, owner) => paymentOperation(owner, token => client.listOrders(token, input), true),
    async cancelOrder(id, owner) {
      const scope = api.billingScope(owner)
      await paymentOperation(owner, token => client.cancelOrder(token, id), false)

      if (scope.generation !== generation) {
        throw new PlatformClientError('auth_attempt_superseded')
      }

      return api.getOrder(id, owner)
    },
    billingScope(expectedUserId) {
      requireTokens()

      if (current.account?.id !== expectedUserId) {
        throw new PlatformClientError('platform_account_changed')
      }

      return { origin: client.origin, user_id: expectedUserId, generation }
    },
    walletSummary(expectedUserId) {
      api.billingScope(expectedUserId)

      return authenticated(token => client.walletSummary(token), true)
    },
    checkoutInfo(expectedUserId) {
      api.billingScope(expectedUserId)

      return authenticated(token => client.checkoutInfo(token), true)
    },
    listUsage(input, expectedUserId) {
      if (api.snapshot().account?.id !== expectedUserId) {
        throw new PlatformClientError('platform_account_changed')
      }

      return authenticated(token => client.listUsage(token, input), true)
    },
    async models() {
      if (current.phase !== 'signed_in' && current.model_identity_ready && catalog?.generation === generation) {
        return catalog.models
      }

      if (current.phase !== 'signed_in' && current.model_identity_ready && tokens?.deviceModels) {
        return tokens.deviceModels
      }

      const models = await authenticated(token => client.models(token), true)
      catalog = { generation, models }

      return models
    },
    ensureDeviceKey,
    async rejectDeviceKey(deviceId, credentialVersion) {
      if (current.model_identity_version !== credentialVersion || !current.model_identity_ready) {
        return
      }
      const userId = current.account?.id

      if (!userId) {
        return
      }

      const scope = JSON.stringify([client.origin, userId, deviceId])

      if (revokedDevices.has(scope) || suspendedDevices.has(scope)) {
        return
      }

      // A confirmed inference rejection suspends reuse until management can inspect it.
      suspendedDevices.add(scope)
      deviceIntents.set(scope, (deviceIntents.get(scope) ?? 0) + 1)
      const expected = generation

      if (tokens?.deviceKeys) {
        tokens.deviceKeys = tokens.deviceKeys.filter(key => key.user_id !== userId || key.device_id !== deviceId)
      }

      if (tokens) {
        tokens.suspendedDevices = [...(tokens.suspendedDevices ?? []), { user_id: userId, device_id: deviceId }]
      }
      publish({ model_identity_ready: false })

      if (tokens && current.remember_state === 'encrypted') {
        await persist(async () => {
          if (expected === generation && tokens) {
            await tokenStore.save(client.origin, tokens)
          }
        })
      }

      if (expected !== generation || current.account?.id !== userId) {
        return
      }
      const state = await authenticated(token => client.deviceKeyState(token, deviceId), true)

      if (expected !== generation || current.account?.id !== userId) {
        return
      }

      if (state.status === 'revoked') {
        revokedDevices.add(scope)
        suspendedDevices.delete(scope)
      }
    },
    supportsDeviceKey(deviceId) {
      const userId = current.account?.id

      if (!userId) {
        return Promise.resolve(false)
      }

      if (tokens?.deviceKeys?.some(key => key.user_id === userId && key.device_id === deviceId)) {
        return Promise.resolve(true)
      }

      const scope = JSON.stringify([client.origin, userId, deviceId])

      if (rolloutDeniedDevices.has(scope)) {
        return Promise.resolve(false)
      }

      let capability = deviceCapabilities.get(scope)

      if (!capability) {
        capability = authenticated(token => client.supportsDeviceKey(token, deviceId), true).catch(error => {
          deviceCapabilities.delete(scope)
          throw error
        })
        deviceCapabilities.set(scope, capability)
      }

      return capability
    },
    modelLease: input => authenticated(token => client.modelLease(token, input), true),
    async initialize() {
      const expected = ++generation
      publish({ phase: 'loading', error: null })

      try {
        const restored = await tokenStore.load(client.origin)

        if (expected !== generation) {
          return current
        }

        if (!restored) {
          return publish({ phase: 'signed_out', account: null, remember_state: 'session_only', error: null })
        }

        tokens = restored

        for (const device of restored.suspendedDevices ?? []) {
          suspendedDevices.add(JSON.stringify([client.origin, device.user_id, device.device_id]))
        }

        current = {
          ...current,
          remember_state: 'encrypted',
          ...(restored.deviceAccount
            ? {
                account: restored.deviceAccount,
                model_identity_ready: Boolean(restored.deviceKeys?.length),
                model_identity_version: restored.deviceKeys?.[0]?.version
              }
            : {})
        }

        if (restored.expiresAt <= now() + 30_000) {
          return api.refresh()
        }

        const profile = await client.profile(restored.accessToken)
        await rememberVerifiedProfile(profile, expected)

        const snapshot =
          expected === generation
            ? publish({
                phase: 'signed_in',
                account: profile,
                error: null,
                model_identity_ready: Boolean(tokens?.deviceKeys?.some(key => key.user_id === profile.id)),
                model_identity_version: tokens?.deviceKeys?.find(key => key.user_id === profile.id)?.version
              })
            : current

        if (expected === generation) {
          void syncNativeDeviceInfo()
        }

        return snapshot
      } catch (error) {
        if (expected !== generation) {
          return current
        }

        if (error instanceof PlatformClientError && error.authentication && tokens?.refreshToken) {
          return api.refresh()
        }

        return publish({ phase: tokens ? 'offline' : 'signed_out', error: safeError(error) })
      }
    },
    generation: () => generation,
    snapshot: () => current,
    subscribe(listener) {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    capabilities: () => client.capabilities(),
    refresh() {
      const expected = generation

      return (async () => {
        try {
          return await performRefresh(expected)
        } catch (error) {
          if (expected === generation) {
            publish({
              phase: error instanceof PlatformClientError && error.authentication ? 'reauth_required' : 'offline',
              error: safeError(error)
            })
          }

          return current
        }
      })()
    },
    async retry() {
      if (!tokens) {
        return api.initialize()
      }

      const profile = await authenticated(token => client.profile(token), true)

      const snapshot = publish({ phase: 'signed_in', account: profile, error: null })
      void syncNativeDeviceInfo()

      return snapshot
    },
    requestPhoneCode: input => client.requestPhoneCode(input),
    async verifyPhoneCode(input) {
      const { expected, previous } = beginAuthentication()

      try {
        return await finishExchange(await client.verifyPhone(input), input.remember, expected)
      } catch (error) {
        failAuthentication(error, expected, previous)

        throw error
      } finally {
        input.code = ''
      }
    },
    async loginExisting(input) {
      const { expected, previous } = beginAuthentication()

      try {
        return await finishExchange(await client.login(input), input.remember, expected)
      } catch (error) {
        failAuthentication(error, expected, previous)

        throw error
      } finally {
        input.password = ''
      }
    },
    async completeSecondFactor(input) {
      const pending = pendingSecondFactor

      if (!pending) {
        throw new PlatformClientError('second_factor_not_pending')
      }

      const expected = generation

      try {
        return await finishAuthentication(
          await client.complete2FA({ temp_token: pending.tempToken, totp_code: input.totp_code }),
          pending.remember,
          expected
        )
      } finally {
        input.totp_code = ''
      }
    },
    async updateProfile(input) {
      const name = input.display_name.trim()

      if (name.length < 1 || name.length > 32) {
        throw new PlatformClientError('invalid_display_name')
      }

      return withAccountProfile(token => client.updateProfile(token, name), true)
    },
    requestBindingCode(input) {
      return authenticated(token => client.requestBindingCode(token, input.phone, input.captcha_proof), false)
    },
    async submitStepUp(input) {
      try {
        if (input.expected_user_id !== undefined || input.expected_generation !== undefined) {
          await deviceOperation(
            { expected_user_id: input.expected_user_id!, expected_generation: input.expected_generation! },
            token => client.submitStepUp(token, input.totp_code),
            false
          )
        } else {
          await authenticated(token => client.submitStepUp(token, input.totp_code), false)
        }

        return current
      } finally {
        input.totp_code = ''
      }
    },
    bindPhone(input) {
      return withAccountProfile(token => client.bindPhone(token, input), false)
    },
    logout() {
      const previous = tokens
      const activeLogout = previous ? logoutFlights.get(previous) : undefined

      if (activeLogout) {
        return activeLogout
      }

      const previousSnapshot = current
      generation += 1

      if (tokens) {
        delete tokens.deviceKeys
        delete tokens.deviceModels
        delete tokens.deviceAccount
        delete tokens.suspendedDevices
      }

      catalog = null
      deviceCapabilities.clear()
      rolloutDeniedDevices.clear()
      deviceFlights.clear()
      pendingSecondFactor = null
      refreshFlight = null
      // Retire local runtime authority before durable token deletion or remote
      // revocation can stall. Controllers observe the generation via publish().
      publish({ model_identity_ready: false })

      let promise!: Promise<PlatformAccountSnapshot>
      promise = (async () => {
        try {
          const [local, remote] = await Promise.allSettled([
            persist(() => tokenStore.clear(client.origin)),
            previous?.refreshToken ? client.logout(previous.refreshToken) : Promise.resolve()
          ])

          if (tokens !== previous) {
            return current
          }

          if (local.status === 'rejected') {
            publish({
              phase: previousSnapshot.phase,
              account: previousSnapshot.account,
              remember_state: previousSnapshot.remember_state,
              error: safeError(local.reason)
            })
            throw local.reason
          }

          tokens = null

          return publish({
            phase: 'signed_out',
            account: null,
            remember_state: 'session_only',
            error: remote.status === 'rejected' ? { code: 'logout_revocation_unconfirmed' } : null
          })
        } finally {
          if (previous && logoutFlights.get(previous) === promise) {
            logoutFlights.delete(previous)
          }
        }
      })()

      if (previous) {
        logoutFlights.set(previous, promise)
      }

      return promise
    }
  }

  return api
}
