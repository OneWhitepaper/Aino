import { requestComposerDraftSync } from '@/store/composer'
import { lineageAliases, ownerLookupSessionRows, resolveComposerSessionKey } from '@/store/session'
import { isSessionOwnerRoute, type SessionOwnerRoute, type SessionOwnerScope } from '@/store/session-request-router'
import { knownOwnerForSession, storedSessionIdForRuntimeId } from '@/store/session-states'

function sameOwner(candidate: SessionOwnerScope, owner: SessionOwnerRoute): boolean {
  return (
    isSessionOwnerRoute(candidate) &&
    candidate.connectionId === owner.connectionId &&
    candidate.profile === owner.profile &&
    (candidate.targetProfile ?? candidate.profile) === (owner.targetProfile ?? owner.profile)
  )
}

/** Links use canonical logical IDs; existing editors can still own physical aliases. */
export function handoffDraftTarget(sessionId: string, owner: SessionOwnerRoute) {
  const rows = ownerLookupSessionRows().filter(row => sameOwner(knownOwnerForSession(row.id), owner))
  const bound = storedSessionIdForRuntimeId(sessionId)
  const storedId = bound && sameOwner(knownOwnerForSession(bound), owner) ? bound : sessionId
  const aliases = [...new Set([...lineageAliases(sessionId, rows), ...lineageAliases(storedId, rows)])]

  return { storedId, key: resolveComposerSessionKey(storedId, rows) ?? storedId, aliases }
}

export function flushHandoffDrafts(aliases: string[]): void {
  requestComposerDraftSync('flush')

  for (const id of aliases) {
    requestComposerDraftSync('flush', `tile:${id}`)
  }
}
