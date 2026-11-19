import {
  reloadPersistedDrafts,
  requestComposerDraftSync,
  savedDraftAt,
  stashSessionDraft,
  takeSessionDraft
} from '@/store/composer'
import { $selectedStoredSessionId } from '@/store/session'
import type { SessionCreateResponse } from '@/types/hermes'

import type { ReviewedHandoff } from './handoff-contract'

export function handoffDraftText(handoff: ReviewedHandoff): string {
  return [handoff.summary, ...(handoff.files?.length ? [handoff.files.join('\n')] : [])].join('\n\n')
}

export function recoverHandoffDraft(storedId: string, snapshot: Partial<SessionCreateResponse>): boolean {
  const handoff = snapshot.info?.handoff

  if (!handoff || snapshot.message_count !== 0 || snapshot.messages?.length) {
    return false
  }

  requestComposerDraftSync('flush')
  requestComposerDraftSync('flush', storedId)
  reloadPersistedDrafts()
  const draft = takeSessionDraft(storedId)

  if (savedDraftAt(storedId) !== undefined || draft.text || draft.attachments.length) {
    return false
  }

  stashSessionDraft(storedId, handoffDraftText(handoff), [])

  if ($selectedStoredSessionId.get() === storedId) {
    requestComposerDraftSync('reload')
  }

  return true
}
