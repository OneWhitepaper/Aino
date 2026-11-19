import type { SessionOwnerScope } from '@/store/session-request-router'
import type { SessionResumeResult } from '@/types/hermes'

import { recoverHandoffDraft } from './handoff-draft'
import { applyRuntimeInfo } from './runtime-info'

/** Both warm activation and cold resume restore the same durable launch context. */
export function restoreResumedRuntimeInfo(storedId: string, snapshot: SessionResumeResult, owner: SessionOwnerScope) {
  const runtimeInfo = applyRuntimeInfo(snapshot.info, { owner })
  recoverHandoffDraft(storedId, snapshot)

  return runtimeInfo
}
