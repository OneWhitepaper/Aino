import { LOCAL_CONNECTION_ID } from '@hermes/shared'

import { dropBrowserProfilePrefs, migrateBrowserProfilePrefs } from '@/lib/browser-profile-prefs'

import { dropQueuedLaunchPicksForProfile, migrateQueuedLaunchPicksForProfile } from './composer-queued-pick'
import { dropModeWorkspacesForProfile, migrateModeWorkspacesForProfile } from './execution-mode/workspaces'
import { dropPreviewTabsForProfile, migratePreviewTabsForProfile } from './preview'

/** Renderer-owned profile families move with the session tile owner. */
export function migrateProfilePresentation(from: string, to: string): void {
  migrateModeWorkspacesForProfile(from, to)
  migratePreviewTabsForProfile(from, to, LOCAL_CONNECTION_ID)
  migrateBrowserProfilePrefs(from, to)
  migrateQueuedLaunchPicksForProfile(from, to)
}

export function dropProfilePresentation(
  name: string,
  connectionId: string,
  route?: { connectionId?: string; profile?: string }
): void {
  dropModeWorkspacesForProfile(route?.profile?.trim() || name, connectionId)
  dropPreviewTabsForProfile(name, connectionId === LOCAL_CONNECTION_ID, connectionId)
  dropBrowserProfilePrefs(name, route?.connectionId?.trim() || undefined)
  dropQueuedLaunchPicksForProfile(name, route ? (route.connectionId ?? '') : undefined)
}
