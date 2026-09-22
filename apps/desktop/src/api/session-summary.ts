import type { SessionSummaryResult } from '@hermes/shared'

import type { Locale } from '@/i18n'
import type { SessionOwnerScope } from '@/store/session-request-router'

import { capabilityScoped, hermesApi } from './client'

export interface SessionSummaryScope {
  connectionId: string
  profile: string
}

export function readSessionSummary(id: string, scope: SessionSummaryScope, language: Locale) {
  const query = new URLSearchParams({ profile: scope.profile, language })

  return hermesApi<SessionSummaryResult>({
    ...capabilityScoped(scope),
    path: `/api/sessions/${encodeURIComponent(id)}/summary?${query}`
  })
}

export async function generateSessionSummary(
  id: string,
  scope: SessionSummaryScope,
  language: Locale,
  runtime: { id: string; owner: SessionOwnerScope } | null,
  retry = false
): Promise<SessionSummaryResult> {
  if (runtime) {
    const [{ requestForSessionProfile }, { $gateway }, { preparePlatformSessionRequest }] = await Promise.all([
      import('@/store/session-request-router'),
      import('@/store/gateway'),
      import('./platform-session-binding')
    ])

    const request = <T>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T> =>
      requestForSessionProfile<T>(
        runtime.owner,
        async <R>(name: string, payload?: Record<string, unknown>, timeout?: number) => {
          const gateway = $gateway.get()

          if (!gateway) {
            throw new Error('Session gateway is unavailable')
          }

          return gateway.request<R>(name, payload, timeout)
        },
        method,
        params,
        timeoutMs
      )

    const params = { session_id: runtime.id, language, retry }

    await preparePlatformSessionRequest(runtime.owner, 'session.summary', params, request)

    return request<SessionSummaryResult>('session.summary', params, 120_000)
  }

  // A stored-only view can use an explicitly configured summary model. The
  // backend rejects implicit model fallback without an authenticated runtime.
  return hermesApi<SessionSummaryResult>({
    ...capabilityScoped(scope),
    path: `/api/sessions/${encodeURIComponent(id)}/summary`,
    method: 'POST',
    body: { profile: scope.profile, language, retry },
    timeoutMs: 120_000
  })
}
