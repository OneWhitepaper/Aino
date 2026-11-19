import { handoffCopy } from '@/i18n/handoff'
import { getRuntimeI18nLocale } from '@/i18n/runtime'
import { isMissingRpcMethod } from '@/lib/gateway-rpc'
import type { SessionCreateResponse, SessionRuntimeInfo } from '@/types/hermes'

export type ReviewedHandoff = NonNullable<SessionRuntimeInfo['handoff']>
export type HandoffRequest = <T>(method: string, params?: Record<string, unknown>) => Promise<T>

export async function requireHandoffCapability(request: HandoffRequest): Promise<void> {
  const description = await request<{ capabilities?: string[] }>('runtime.describe', {}).catch(error => {
    if (isMissingRpcMethod(error)) {
      throw new Error(handoffCopy(getRuntimeI18nLocale()).unsupported)
    }

    throw error
  })

  if (!description.capabilities?.includes('work-code-handoff-v1')) {
    throw new Error(handoffCopy(getRuntimeI18nLocale()).unsupported)
  }
}

export function confirmHandoffProvenance(created: SessionCreateResponse, params: Record<string, unknown>): void {
  const expected = params.handoff as ReviewedHandoff
  const actual = created.info?.handoff

  if (
    !created.stored_session_id ||
    !actual ||
    created.info?.execution_mode !== params.execution_mode ||
    actual.source_session_id !== expected.source_session_id ||
    actual.summary !== expected.summary ||
    JSON.stringify(actual.files ?? []) !== JSON.stringify(expected.files ?? [])
  ) {
    throw new Error(handoffCopy(getRuntimeI18nLocale()).unproven)
  }
}
