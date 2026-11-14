import type { MutableRefObject } from 'react'

import type { ProfileScope } from '@/api/client'
import { getApiRequestConnection, getApiRequestProfile, setSessionArchived, setSessionPinnedRemote } from '@/hermes'
import type { SessionRemovalCopy } from '@/i18n/session-removal'
import type { Translations } from '@/i18n/types'
import { $pinnedSessionIds } from '@/store/layout'
import { $notificationEpoch, clearNotifications, notify, notifyError } from '@/store/notifications'
import { sessionMatchesStoredId, sessionPinId } from '@/store/session'
import {
  beginSessionMutation,
  endSessionMutation,
  tombstoneSessions,
  untombstoneSessions
} from '@/store/session-removal'
import type { SessionOwnerScope } from '@/store/session-request-router'
import { closeSessionTile, dropSessionState } from '@/store/session-states'
import { forgetSessionUnread } from '@/store/session-unread'
import { $archivedSessions } from '@/store/sidebar-archive'
import type { SessionInfo } from '@/types/hermes'

import type { ClientSessionState } from '../../../types'

import { sessionRemovalOwnerUnavailable } from './delete-session-runtime'
import { dropListedSession, findListedSession, resolveSessionOwner, restoreListedSession } from './utils'

export interface SessionArchiveOptions {
  throwOnError?: boolean
}

interface ArchiveContext {
  copy: Translations['desktop']
  removalCopy: SessionRemovalCopy
  runtimeIdByStoredSessionIdRef: MutableRefObject<Map<string, string>>
  selectedStoredSessionIdRef: MutableRefObject<string | null>
  sessionStateByRuntimeIdRef: MutableRefObject<Map<string, ClientSessionState>>
  startFreshSessionDraft: (replace?: boolean) => unknown
}

function mutationLifetime() {
  const epoch = $notificationEpoch.get()
  const connection = getApiRequestConnection()
  const profile = getApiRequestProfile()

  return {
    owner: { connectionId: connection, profile },
    current: () =>
      epoch === $notificationEpoch.get() &&
      connection === getApiRequestConnection() &&
      profile === getApiRequestProfile()
  }
}

function rowOwner(row: SessionInfo | undefined): SessionOwnerScope {
  return row?.connection_id
    ? { connectionId: row.connection_id, profile: row.profile || 'default' }
    : row?.profile?.trim() || undefined
}

/** One restore path for Archived chats and the short Undo offer. */
export async function restoreArchivedSession(
  storedSessionId: string,
  copy: Translations['desktop'],
  options: SessionArchiveOptions & {
    row?: SessionInfo
    owner?: ProfileScope
    restorePinId?: string
  } = {}
): Promise<void> {
  clearNotifications()
  const lifetime = mutationLifetime()

  const archived =
    options.row ?? $archivedSessions.get().find(session => sessionMatchesStoredId(session, storedSessionId))

  const owner = options.owner ?? rowOwner(archived)

  try {
    const result = await setSessionArchived(storedSessionId, false, owner)

    if (!result.ok) {
      throw new Error(copy.unarchiveFailed)
    }

    if (!lifetime.current()) {
      return
    }

    $archivedSessions.set($archivedSessions.get().filter(session => !sessionMatchesStoredId(session, storedSessionId)))

    if (archived) {
      untombstoneSessions([storedSessionId, archived.id, archived._lineage_root_id])
      restoreListedSession({ ...archived, archived: false })
    }

    if (options.restorePinId) {
      const pinResult = await setSessionPinnedRemote(options.restorePinId, true, owner)

      if (!pinResult.ok) {
        throw new Error(copy.unarchiveFailed)
      }

      if (!lifetime.current()) {
        return
      }

      $pinnedSessionIds.set([...new Set([...$pinnedSessionIds.get(), options.restorePinId])])
    }

    notify({ durationMs: 2_000, kind: 'success', message: copy.restored })
  } catch (error) {
    if (!lifetime.current()) {
      return
    }

    if (options.throwOnError) {
      throw error
    }

    notifyError(error, copy.unarchiveFailed)
  }
}

/** Archive keeps server history; only this reversible mutation offers Undo. */
export async function archiveStoredSession(
  storedSessionId: string,
  context: ArchiveContext,
  options: SessionArchiveOptions = {}
): Promise<void> {
  clearNotifications()
  const lifetime = mutationLifetime()
  const { copy, removalCopy } = context
  const listed = findListedSession(storedSessionId)
  const archived = listed?.session
  const owner = rowOwner(archived) ?? (await resolveSessionOwner(storedSessionId))

  if (!lifetime.current()) {
    return
  }

  const profile = typeof owner === 'object' ? owner?.profile : owner

  if (sessionRemovalOwnerUnavailable(Boolean(listed), archived?.profile?.trim(), profile)) {
    reportArchiveFailure(new Error(copy.sessionOwnershipUnavailable), options, copy.archiveFailed)

    return
  }

  const previousPinned = $pinnedSessionIds.get()
  const archivedPinId = archived ? sessionPinId(archived) : storedSessionId
  const archivedIds = [storedSessionId, archived?.id, archived?._lineage_root_id]
  const wasPinned = previousPinned.includes(archivedPinId)

  // Freeze the route before the row disappears; Undo never resolves ambient ownership.
  const capturedOwner =
    typeof owner === 'object' ? owner : { ...lifetime.owner, profile: owner || lifetime.owner.profile }

  beginSessionMutation(archivedIds)
  let evicted = false

  const evict = () => {
    evicted = true
    dropListedSession(storedSessionId)
    tombstoneSessions(archivedIds)
    $pinnedSessionIds.set(previousPinned.filter(id => id !== storedSessionId && id !== archivedPinId))

    if (context.selectedStoredSessionIdRef.current === storedSessionId) {
      context.startFreshSessionDraft(true)
    }
  }

  // A row owns its confirmation. Keep it mounted until the write succeeds so
  // failure and retry remain in that decision rather than losing the dialog.
  if (!options.throwOnError) {
    evict()
  }

  try {
    const result = await setSessionArchived(storedSessionId, true, capturedOwner)

    if (!result.ok) {
      throw new Error(copy.archiveFailed)
    }

    if (!lifetime.current()) {
      return
    }

    if (!evicted) {
      evict()
    }

    finishSessionArchive(storedSessionId, archived, archivedIds, profile || undefined, context)
    offerArchiveUndo(storedSessionId, archived, capturedOwner, wasPinned ? archivedPinId : undefined, lifetime, context)
  } catch (error) {
    if (!lifetime.current()) {
      return
    }

    if (evicted && archived) {
      restoreListedSession(archived, listed?.slice)
    }

    if (evicted) {
      untombstoneSessions(archivedIds)
      $pinnedSessionIds.set(previousPinned)
    }

    reportArchiveFailure(error, options, copy.archiveFailed)
  } finally {
    endSessionMutation(archivedIds)
  }
}

function reportArchiveFailure(error: unknown, options: SessionArchiveOptions, fallback: string): void {
  if (options.throwOnError) {
    throw error
  }

  notifyError(error, fallback)
}

function finishSessionArchive(
  storedSessionId: string,
  archived: SessionInfo | undefined,
  archivedIds: Array<string | null | undefined>,
  profile: string | undefined,
  context: ArchiveContext
): void {
  forgetSessionUnread(archivedIds, profile)
  const runtimeId = context.runtimeIdByStoredSessionIdRef.current.get(storedSessionId)
  closeSessionTile(storedSessionId)

  if (runtimeId) {
    context.runtimeIdByStoredSessionIdRef.current.delete(storedSessionId)
    context.sessionStateByRuntimeIdRef.current.delete(runtimeId)
    dropSessionState(runtimeId)
  }

  if (archived) {
    $archivedSessions.set([
      { ...archived, archived: true },
      ...$archivedSessions.get().filter(row => !sessionMatchesStoredId(row, storedSessionId))
    ])
  }
}

function offerArchiveUndo(
  storedSessionId: string,
  archived: SessionInfo | undefined,
  owner: ProfileScope,
  restorePinId: string | undefined,
  lifetime: ReturnType<typeof mutationLifetime>,
  { copy, removalCopy }: ArchiveContext
): void {
  notify({
    kind: 'success',
    title: removalCopy.removed,
    message: archived?.title ? removalCopy.kept(archived.title) : copy.archived,
    durationMs: 8_000,
    action: {
      label: removalCopy.undo,
      onClick: async () => {
        if (!lifetime.current()) {
          throw new Error(removalCopy.unavailable)
        }

        await restoreArchivedSession(storedSessionId, copy, {
          row: archived,
          owner,
          throwOnError: true,
          restorePinId
        })
      }
    }
  })
}
