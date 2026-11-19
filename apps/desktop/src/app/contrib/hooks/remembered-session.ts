import { appViewForPath, isRouteBlockingSurface, NEW_CHAT_ROUTE, routeSessionId } from '@/app/routes'
import {
  forgetSessionOwnerHintsForSession,
  sessionBelongsToProfile,
  sessionMatchesStoredId,
  sessionOwnerRouteFromRow,
  setSessionOwnerHint
} from '@/store/session'
import type { SessionInfo } from '@/types/hermes'

/**
 * Returns the session safe to remember/restore: a delegate child
 * (`source === 'subagent'`) is replaced by its parent, everything else keeps
 * its own id. Delegate children are deliberately omitted from the sidebar list
 * (`_LISTABLE_CHILD_SQL`), so remembering one leaves the next cold start split
 * between the highlighted parent and the invisible child the chat area shows
 * (#56983). `/branch` children also carry `parent_session_id` but ARE
 * user-facing — `source`, not parenthood, is the discriminator.
 *
 * Accepts metadata fetched directly by id (`getSession`): the by-id endpoint
 * serves delegate children even though the list does not, so this repairs a
 * stale child id without the sidebar list. `null` means "do not remember"
 * (an orphaned delegate child whose parent is gone).
 */
export async function resolveRememberedSessionId(
  id: string,
  getSession: (id: string) => Promise<SessionInfo>
): Promise<null | string> {
  const session = await getSession(id)

  return session.source === 'subagent' ? (session.parent_session_id ?? null) : session.id
}

/** Apply the click path's owner hygiene before pathname-driven cold restore.
 * Untagged legacy remote rows must not inherit a stale local connection hint. */
export function repairOwnerHintsForRestore(
  id: string,
  row: Pick<SessionInfo, 'connection_id' | 'profile'> | undefined
): void {
  if (!row) {
    return
  }

  const ownerRoute = sessionOwnerRouteFromRow(row)

  if (ownerRoute) {
    setSessionOwnerHint(id, ownerRoute)
  } else {
    forgetSessionOwnerHintsForSession(id)
  }
}

/** Only a real page or an owner-matching, user-facing session is a boot target. */
export function canRestoreRememberedRoute(
  route: string | null,
  sessions: readonly Pick<SessionInfo, 'id' | '_lineage_root_id' | 'profile' | 'source'>[],
  profile: string
): route is string {
  if (!route || route === NEW_CHAT_ROUTE || isRouteBlockingSurface(appViewForPath(route))) {
    return false
  }

  const id = routeSessionId(route)

  return (
    !id ||
    (sessions.find(row => sessionMatchesStoredId(row, id))?.source !== 'subagent' &&
      sessionBelongsToProfile(sessions, id, profile))
  )
}
