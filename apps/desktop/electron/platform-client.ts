import type {
  PaymentQuote,
  PaymentQuoteInput,
  PhoneChallengeDTO,
  PhoneVerifyDTO,
  PlatformCaptchaProof,
  PlatformCheckoutInfo,
  PlatformCreateOrderInput,
  PlatformDevice,
  PlatformModel,
  PlatformOrder,
  PlatformOrderPage,
  PlatformOrderQuery,
  PlatformPublicCapabilities,
  PlatformWalletSummary
} from '../shared/platform-contract'
import type { PlatformUsagePage, PlatformUsageQuery } from '../shared/platform-contract'

import { parsePlatformCheckoutInfo, parsePlatformWalletSummary } from './platform-billing-contract'
import { parsePlatformDeviceId, parsePlatformDevices } from './platform-device-contract'
import { parsePlatformModel } from './platform-model-contract'
import {
  parsePaymentQuote,
  parsePaymentQuoteInput,
  parsePlatformCreateOrderInput,
  parsePlatformOrder,
  parsePlatformOrderId,
  parsePlatformOrderPage,
  parsePlatformOrderQuery
} from './platform-payment-contract'
import type { PlatformTokenSet } from './platform-token-store'
import { parsePlatformUsagePage, parsePlatformUsageQuery } from './platform-usage-contract'

export const PLATFORM_PRODUCTION_ORIGIN = 'https://api.agentera.com.cn'

export class PlatformClientError extends Error {
  constructor(
    public readonly code: string,
    public readonly authentication = false,
    public readonly retryAfter?: number
  ) {
    super(code)
  }
}
export interface PlatformProfile {
  id: string
  display_name: string
  phone_masked: string
  email: string
}
interface AuthExchange {
  tokens?: PlatformTokenSet
  tempToken?: string
}
export interface PlatformClient {
  listDevices(accessToken: string): Promise<PlatformDevice[]>
  revokeDevice(accessToken: string, deviceId: string): Promise<{ revoked: true }>
  quote(accessToken: string, input: PaymentQuoteInput): Promise<PaymentQuote>
  createOrder(accessToken: string, input: PlatformCreateOrderInput): Promise<string>
  getOrder(accessToken: string, orderId: string): Promise<PlatformOrder>
  listOrders(accessToken: string, input: PlatformOrderQuery): Promise<PlatformOrderPage>
  cancelOrder(accessToken: string, orderId: string): Promise<void>
  walletSummary(accessToken: string): Promise<PlatformWalletSummary>
  checkoutInfo(accessToken: string): Promise<PlatformCheckoutInfo>
  listUsage(accessToken: string, input: PlatformUsageQuery): Promise<PlatformUsagePage>
  readonly origin: string
  capabilities(): Promise<PlatformPublicCapabilities>
  profile(accessToken: string): Promise<PlatformProfile>
  refresh(refreshToken: string): Promise<PlatformTokenSet>
  requestPhoneCode(input: { phone: string; captcha_proof?: PlatformCaptchaProof }): Promise<PhoneChallengeDTO>
  verifyPhone(input: PhoneVerifyDTO): Promise<AuthExchange>
  login(input: { email: string; password: string; captcha_proof?: PlatformCaptchaProof }): Promise<AuthExchange>
  complete2FA(input: { temp_token: string; totp_code: string }): Promise<PlatformTokenSet>
  updateProfile(accessToken: string, displayName: string): Promise<PlatformProfile>
  requestBindingCode(accessToken: string, phone: string, proof?: PlatformCaptchaProof): Promise<PhoneChallengeDTO>
  bindPhone(accessToken: string, input: { phone: string; challenge_id: string; code: string }): Promise<PlatformProfile>
  submitStepUp(accessToken: string, code: string): Promise<void>
  logout(refreshToken: string): Promise<void>
  models(accessToken: string): Promise<PlatformModel[]>
  modelLease(accessToken: string, input: PlatformLeaseInput): Promise<PlatformModelLeaseDTO>
}

export interface PlatformLeaseInput {
  model_id: string
  device_id: string
  connection_grant_id: string
}

export interface PlatformModelLeaseDTO {
  credential_id: string
  api_key: string
  base_url: string
  expires_at: string
  model: PlatformModel
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PlatformClientError('invalid_response')
  }

  return value as Record<string, unknown>
}

function stringField(value: unknown, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new PlatformClientError('invalid_response')
  }

  return value
}

function numberField(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new PlatformClientError('invalid_response')
  }

  return value
}

function positiveNumberField(value: unknown) {
  const number = numberField(value)

  if (number <= 0) {
    throw new PlatformClientError('invalid_response')
  }

  return number
}

function booleanField(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

export function validatePlatformOrigin(raw: string, allowInsecureLoopback = false): string {
  const url = new URL(raw)
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'

  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('invalid_platform_origin')
  }

  if (url.protocol !== 'https:' && !(allowInsecureLoopback && url.protocol === 'http:' && loopback)) {
    throw new Error('invalid_platform_origin')
  }

  return url.origin
}

export function resolvePlatformOrigin({
  isPackaged,
  readDevelopmentConfig
}: {
  isPackaged: boolean
  readDevelopmentConfig: () => string
}): { origin: string; development: boolean } {
  if (isPackaged) {
    return { origin: PLATFORM_PRODUCTION_ORIGIN, development: false }
  }

  let value: unknown

  try {
    value = JSON.parse(readDevelopmentConfig())
  } catch {
    return { origin: PLATFORM_PRODUCTION_ORIGIN, development: false }
  }

  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).enabled !== true
  ) {
    return { origin: PLATFORM_PRODUCTION_ORIGIN, development: false }
  }

  const origin = validatePlatformOrigin(String((value as Record<string, unknown>).origin || ''), true)

  if (new URL(origin).protocol !== 'http:') {
    throw new Error('invalid_platform_origin')
  }

  return { origin, development: true }
}

export function createPlatformClient({
  origin: rawOrigin,
  allowInsecureLoopback = false,
  timeoutMs = 10_000,
  fetchImpl = fetch,
  now = Date.now
}: {
  origin: string
  allowInsecureLoopback?: boolean
  timeoutMs?: number
  fetchImpl?: typeof fetch
  now?: () => number
}): PlatformClient {
  const origin = validatePlatformOrigin(rawOrigin, allowInsecureLoopback)

  async function request(method: string, endpoint: string, body?: unknown, token?: string): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetchImpl(`${origin}/api/v1${endpoint}`, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      })

      if (response.status >= 300 && response.status < 400) {
        throw new PlatformClientError('redirect_rejected')
      }

      let payload: Record<string, unknown>

      try {
        payload = object(await response.json())
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error
        }

        throw new PlatformClientError('invalid_response')
      }

      if (typeof payload.message !== 'string') {
        throw new PlatformClientError('invalid_response')
      }

      if (!response.ok) {
        const reason = payload.reason
        const legacyCode = payload.code

        const code =
          typeof reason === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(reason)
            ? reason
            : typeof legacyCode === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(legacyCode)
              ? legacyCode
              : `http_${response.status}`

        const retryHeader = response.headers.get('retry-after')
        const retry = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : undefined

        throw new PlatformClientError(
          code,
          response.status === 401,
          retry !== undefined && Number.isSafeInteger(retry) ? retry : undefined
        )
      }

      if (
        typeof payload.code !== 'number' ||
        !Number.isFinite(payload.code) ||
        payload.code !== 0 ||
        !Object.prototype.hasOwnProperty.call(payload, 'data')
      ) {
        throw new PlatformClientError('invalid_response')
      }

      return payload.data
    } catch (error) {
      if (error instanceof PlatformClientError) {
        throw error
      }

      throw new PlatformClientError(
        error instanceof Error && error.name === 'AbortError' ? 'network_timeout' : 'network_unavailable'
      )
    } finally {
      clearTimeout(timer)
    }
  }

  function tokens(value: unknown): PlatformTokenSet {
    const data = object(value)

    if (data.token_type !== 'Bearer') {
      throw new PlatformClientError('invalid_response')
    }

    return {
      accessToken: stringField(data.access_token),
      refreshToken: stringField(data.refresh_token),
      expiresAt: now() + positiveNumberField(data.expires_in) * 1000
    }
  }

  function authExchange(value: unknown): AuthExchange {
    const data = object(value)

    return data.requires_2fa === true ? { tempToken: stringField(data.temp_token) } : { tokens: tokens(data) }
  }

  function profile(value: unknown): PlatformProfile {
    const data = object(value)

    const bindings =
      data.auth_bindings && typeof data.auth_bindings === 'object'
        ? (data.auth_bindings as Record<string, unknown>)
        : data.identity_bindings && typeof data.identity_bindings === 'object'
          ? (data.identity_bindings as Record<string, unknown>)
          : {}

    const phone =
      bindings.phone && typeof bindings.phone === 'object' ? (bindings.phone as Record<string, unknown>) : {}

    return {
      id: String(numberField(data.id)),
      // Phone registration need not assign a name; the UI uses the masked identity.
      display_name: stringField(data.display_name ?? data.username, true),
      phone_masked: data.phone_bound === true ? stringField(phone.subject_hint ?? '', true) : '',
      email: stringField(data.email ?? '', true)
    }
  }

  function challenge(value: unknown): PhoneChallengeDTO {
    const data = object(value)

    return {
      challenge_id: stringField(data.challenge_id),
      expires_in: numberField(data.expires_in),
      retry_after: numberField(data.retry_after ?? 0),
      delivery: stringField(data.delivery)
    }
  }

  function proof(value?: PlatformCaptchaProof) {
    return value ? { ...value } : {}
  }

  return {
    origin,
    async listDevices(token) {
      return parsePlatformDevices(await request('GET', '/desktop/devices', undefined, token))
    },
    async revokeDevice(token, deviceId) {
      const data = object(
        await request('DELETE', `/desktop/devices/${parsePlatformDeviceId(deviceId)}`, undefined, token)
      )

      if (data.revoked !== true) {
        throw new PlatformClientError('invalid_response')
      }

      return { revoked: true }
    },
    async quote(token, input) {
      return parsePaymentQuote(await request('POST', '/payment/quote', parsePaymentQuoteInput(input), token))
    },
    async createOrder(token, input) {
      const { amount, ...intent } = parsePlatformCreateOrderInput(input)

      const data = object(
        await request(
          'POST',
          '/payment/orders',
          {
            ...intent,
            amount_decimal: amount,
            payment_source: 'aino_desktop'
          },
          token
        )
      )

      return parsePlatformOrderId(data.order_id, 'invalid_response')
    },
    async getOrder(token, orderId) {
      const id = parsePlatformOrderId(orderId)
      const order = parsePlatformOrder(await request('GET', `/payment/orders/${id}`, undefined, token), now())

      if (order.order_id !== id) {
        throw new PlatformClientError('invalid_response')
      }

      return order
    },
    async listOrders(token, input) {
      const query = parsePlatformOrderQuery(input)
      const search = new URLSearchParams({ page: String(query.page), page_size: String(query.page_size) })

      return parsePlatformOrderPage(await request('GET', `/payment/orders/my?${search}`, undefined, token), now())
    },
    async cancelOrder(token, orderId) {
      await request('POST', `/payment/orders/${parsePlatformOrderId(orderId)}/cancel`, {}, token)
    },
    async capabilities() {
      const data = object(await request('GET', '/settings/public'))

      const documents = Array.isArray(data.login_agreement_documents)
        ? data.login_agreement_documents.map(item => {
            const doc = object(item)

            return {
              id: stringField(doc.id),
              title: stringField(doc.title),
              content_md: stringField(doc.content_md, true)
            }
          })
        : []

      const enabledProviders = [
        booleanField(data.turnstile_enabled)
          ? { provider: 'turnstile' as const, configured: Boolean(data.turnstile_site_key) }
          : null,
        booleanField(data.tencent_captcha_enabled)
          ? { provider: 'tencent' as const, configured: Boolean(data.tencent_captcha_app_id) }
          : null,
        booleanField(data.aliyun_captcha_enabled)
          ? {
              provider: 'aliyun' as const,
              configured: Boolean(data.aliyun_captcha_scene_id && data.aliyun_captcha_prefix)
            }
          : null
      ].filter((value): value is NonNullable<typeof value> => value !== null)

      if (enabledProviders.length > 1 || (enabledProviders[0] && !enabledProviders[0].configured)) {
        throw new PlatformClientError('invalid_response')
      }

      const provider = enabledProviders[0]?.provider ?? 'disabled'

      return {
        desktop_api_version: numberField(data.desktop_api_version),
        registration_enabled: booleanField(data.registration_enabled),
        registration_url: `${origin}/register`,
        phone_login_enabled: booleanField(data.phone_login_enabled),
        phone_registration_enabled: booleanField(data.phone_registration_enabled),
        phone_binding_enabled: booleanField(data.phone_binding_enabled),
        phone_regions: Array.isArray(data.phone_regions) ? data.phone_regions.map(value => stringField(value)) : [],
        phone_code_length: numberField(data.phone_code_length),
        invitation_code_enabled: booleanField(data.invitation_code_enabled),
        promo_code_enabled: booleanField(data.promo_code_enabled),
        login_agreement_enabled: booleanField(data.login_agreement_enabled),
        login_agreement_mode: stringField(data.login_agreement_mode ?? '', true),
        login_agreement_revision: stringField(data.login_agreement_revision ?? '', true),
        login_agreement_documents: documents,
        captcha: {
          provider,
          site_key: stringField(
            provider === 'tencent' ? (data.tencent_captcha_app_id ?? '') : (data.turnstile_site_key ?? ''),
            true
          ),
          scene_id: stringField(data.aliyun_captcha_scene_id ?? '', true),
          prefix: stringField(data.aliyun_captcha_prefix ?? '', true),
          region: stringField(data.aliyun_captcha_region ?? data.tencent_captcha_region ?? '', true)
        }
      }
    },
    async profile(token) {
      return profile(await request('GET', '/user/profile', undefined, token))
    },
    async refresh(refreshToken) {
      return tokens(await request('POST', '/auth/refresh', { refresh_token: refreshToken }))
    },
    async requestPhoneCode(input) {
      return challenge(
        await request('POST', '/auth/phone/send-code', { phone: input.phone, ...proof(input.captcha_proof) })
      )
    },
    async verifyPhone(input) {
      const { remember: _remember, ...payload } = input

      return authExchange(await request('POST', '/auth/phone/verify', payload))
    },
    async login(input) {
      return authExchange(
        await request('POST', '/auth/login', {
          email: input.email,
          password: input.password,
          ...proof(input.captcha_proof)
        })
      )
    },
    async complete2FA(input) {
      return tokens(await request('POST', '/auth/login/2fa', input))
    },
    async updateProfile(token, displayName) {
      return profile(await request('PUT', '/user', { username: displayName }, token))
    },
    async requestBindingCode(token, phoneValue, captcha) {
      return challenge(
        await request('POST', '/user/account-bindings/phone/send-code', { phone: phoneValue, ...proof(captcha) }, token)
      )
    },
    async bindPhone(token, input) {
      const data = object(await request('POST', '/user/account-bindings/phone', input, token))

      return profile(data.user)
    },
    async submitStepUp(token, code) {
      await request('POST', '/user/totp/step-up', { code }, token)
    },
    async logout(refreshToken) {
      await request('POST', '/auth/logout', { refresh_token: refreshToken })
    },
    async models(token) {
      const data = await request('GET', '/desktop/models', undefined, token)

      if (!Array.isArray(data)) {
        throw new PlatformClientError('invalid_response')
      }

      return data.map(parsePlatformModel)
    },
    async listUsage(token, input) {
      const query = new URLSearchParams(
        Object.entries(parsePlatformUsageQuery(input)).map(([key, value]) => [key, String(value)])
      )

      return parsePlatformUsagePage(await request('GET', `/usage?${query}`, undefined, token))
    },
    async walletSummary(token) {
      return parsePlatformWalletSummary(await request('GET', '/desktop/billing-summary', undefined, token))
    },
    async checkoutInfo(token) {
      const [info, summary] = await Promise.all([
        request('GET', '/payment/checkout-info', undefined, token),
        request('GET', '/desktop/billing-summary', undefined, token)
      ])

      return parsePlatformCheckoutInfo(info, parsePlatformWalletSummary(summary).payment_enabled)
    },
    async modelLease(token, input) {
      const data = object(await request('POST', '/desktop/credentials', input, token))
      const model = parsePlatformModel(data.model)
      const expiresAt = stringField(data.expires_at)
      const baseUrl = stringField(data.base_url)

      if (
        model.id !== input.model_id ||
        model.state !== 'available' ||
        !model.capabilities.tools ||
        !Number.isFinite(Date.parse(expiresAt)) ||
        Date.parse(expiresAt) <= now() ||
        baseUrl !== `${origin}/v1`
      ) {
        throw new PlatformClientError('invalid_response')
      }

      return {
        credential_id: stringField(data.credential_id),
        api_key: stringField(data.api_key),
        base_url: baseUrl,
        expires_at: expiresAt,
        model
      }
    }
  }
}
