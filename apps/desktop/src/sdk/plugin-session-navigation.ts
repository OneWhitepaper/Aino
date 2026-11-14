import { openSession, type OpenSessionIntent } from '@/app/open-session'
import type { WorkspaceMode } from '@/contrib/types'
import { $activeSessionId, $messages, $selectedStoredSessionId, requestSessionResume } from '@/store/session'
import type { SessionOwnerRoute } from '@/store/session-request-router'
import { $sessionTiles, sessionTileDelegate } from '@/store/session-states'

interface SessionSurfaceOptions {
  awaitHydration?: boolean
  expectHistory?: boolean
  forceResume?: boolean
  intent?: OpenSessionIntent
  tabTitle?: string
  workspaceMode?: WorkspaceMode
  workspaceOwnerKey?: string
}

function existingTileDelegate(storedSessionId: string) {
  return $sessionTiles.get().some(tile => tile.storedSessionId === storedSessionId) ? sessionTileDelegate() : null
}

/** Background wakes refresh only an existing surface; they never navigate or mint a tab. */
export async function refreshVisiblePluginSession(
  storedSessionId: string,
  ownerRoute: SessionOwnerRoute | null
): Promise<void> {
  const tileDelegate = existingTileDelegate(storedSessionId)

  if (tileDelegate) {
    await tileDelegate.resumeTile(storedSessionId, { refreshTranscript: true })
  } else if ($selectedStoredSessionId.get() === storedSessionId) {
    requestSessionResume(storedSessionId, ownerRoute ?? undefined)
  }
}

export function navigatePluginSession(
  storedSessionId: string,
  options: SessionSurfaceOptions,
  ownerRoute: SessionOwnerRoute | null
): string {
  const navigate = (to: string, opts?: { replace?: boolean }) => {
    const target = to.startsWith('#') ? to : `#${to}`

    if (opts?.replace) {
      window.location.replace(target)
    } else {
      window.location.hash = target
    }
  }

  const intent = options.intent ?? 'in-place'

  if (options.workspaceMode === 'bots') {
    openSession(storedSessionId, navigate, intent, {
      ownerRoute: ownerRoute ?? undefined,
      workspaceMode: 'bots',
      workspaceOwnerKey: options.workspaceOwnerKey,
      ...(options.tabTitle ? { workspaceTabTitle: options.tabTitle } : {})
    })
  } else {
    openSession(storedSessionId, navigate, intent)
  }

  return window.location.hash
}

/** Explicit navigation may need fresh history even when a stale cached transcript is already painted. */
export async function refreshPluginSessionAfterOpen(
  storedSessionId: string,
  options: SessionSurfaceOptions,
  ownerRoute: SessionOwnerRoute | null
): Promise<void> {
  const surfaceHealthy =
    $selectedStoredSessionId.get() === storedSessionId &&
    Boolean($activeSessionId.get()) &&
    (!options.expectHistory || $messages.get().length > 0)

  if (!options.awaitHydration || (!options.forceResume && surfaceHealthy)) {
    return
  }
  const tileDelegate = existingTileDelegate(storedSessionId)

  if (tileDelegate) {
    try {
      await tileDelegate.resumeTile(storedSessionId, { refreshTranscript: true })

      return
    } catch {
      // The main route's sequenced request is the existing fallback when the tile refresh fails.
    }
  }

  requestSessionResume(storedSessionId, ownerRoute ?? undefined)
}
