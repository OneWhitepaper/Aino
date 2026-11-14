import { expect, it } from 'vitest'

import { TRANSLATIONS } from '@/i18n'

import { parseErrorSurface } from './error-surface'
import { errorCardText } from './error-surface-copy'

const codes = [
  'provider_policy_blocked',
  'content_policy_blocked',
  'format_error',
  'invalid_response',
  'empty_response',
  'rate_limit',
  'upstream_rate_limit',
  'overloaded',
  'server_error',
  'timeout',
  'ssl_cert_verification'
] as const

it('explains an Aino account entitlement refusal without calling it a provider or key failure', () => {
  const surface = parseErrorSurface({ layer: 'billing', code: 'managed_billing_unavailable', retryable: false })
  const copy = errorCardText(TRANSLATIONS.zh.assistant.thread, surface)
  expect(copy.title).toBe('套餐状态不可用')
  expect(copy.body).toContain('我的账户')
  expect(copy.body).toContain('到期')
  expect(copy.body).not.toMatch(/API 密钥|服务商错误|充值余额/)

  const expired = errorCardText(TRANSLATIONS.zh.assistant.thread, {
    layer: 'billing',
    code: 'managed_subscription_expired',
    retryable: false
  })

  expect(expired.title).toBe('套餐已到期')

  const previous = errorCardText(TRANSLATIONS.zh.assistant.thread, {
    layer: 'provider',
    code: 'managed_upstream_auth_failed',
    retryable: false
  })

  expect(previous.title).not.toBe('套餐已到期')
})

it.each(['zh', 'zh-hant', 'ja'] as const)(
  'renders provider errors in %s without losing the failing provider identity',
  locale => {
    for (const layer of ['network', 'provider', 'endpoint', 'streaming'] as const) {
      const surface = parseErrorSurface({ layer, code: 'unknown_failure', retryable: true })
      const copy = errorCardText(TRANSLATIONS[locale].assistant.thread, surface)
      const english = errorCardText(TRANSLATIONS.en.assistant.thread, surface)
      expect(copy.title, layer).not.toBe(english.title)
      expect(copy.body, layer).not.toBe(english.body)
    }

    expect(TRANSLATIONS[locale].assistant.thread.errorGenericProvider).not.toBe(
      TRANSLATIONS.en.assistant.thread.errorGenericProvider
    )

    for (const code of codes) {
      const surface = parseErrorSurface({
        layer: 'provider',
        code,
        provider: 'fixture-provider',
        provider_label: 'Provider Ω',
        retryable: true
      })

      const copy = errorCardText(TRANSLATIONS[locale].assistant.thread, surface)
      const english = errorCardText(TRANSLATIONS.en.assistant.thread, surface)
      expect(copy.title, code).not.toBe(english.title)
      expect(copy.body, code).not.toBe(english.body)
      expect(copy.body, code).toContain('Provider Ω')
      expect(copy.body, code).not.toContain('fixture-provider')
    }
  }
)

it('does not blame a slow reply when the provider could not be reached', () => {
  // The backend stamps `timeout` for refused connections and DNS failures too
  // (agent/error_classifier.py _CONNECTION_MESSAGE_PATTERNS).
  const surface = parseErrorSurface({
    layer: 'provider',
    code: 'timeout',
    provider_label: 'OpenCode Go',
    retryable: true
  })

  const copy = errorCardText(TRANSLATIONS.en.assistant.thread, surface)

  expect(copy.title).toBe("Can't reach OpenCode Go")
  expect(copy.body).toContain("couldn't reach OpenCode Go")
  expect(copy.body).not.toMatch(/in time|slow/i)
})
