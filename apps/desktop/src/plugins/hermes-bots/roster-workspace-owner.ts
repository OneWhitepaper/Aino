import { host } from '@hermes/plugin-sdk'

import { $focusedBotOwner, $selectedRosterKey, focusedRosterOwner, saveSelectedRosterBot } from './bot-state'
import { botRosterKey } from './data'
import { botRouteKey, botWorkspaceOwnerKey, resolveBotConnectionRoute, setBotsWorkspaceOwner } from './routing'
import type { RosterRow } from './types'

/** An explicit source jump already chose its Bot; rail entry must not reopen another chat. */
export function adoptRequestedBotWorkspace(roster: RosterRow[]): boolean {
  const ownerKey = host.state.workspaceOwnerKey?.get?.()

  if (
    host.state.workspaceMode?.get?.() !== 'bots' ||
    !ownerKey ||
    host.state.workspaceIsPage?.get?.() ||
    !host.state.focusedStoredSessionId?.get?.()
  ) {
    return false
  }

  const focused = focusedRosterOwner($focusedBotOwner.get())

  if (!focused?.authoritative || !focused.connectionId) {
    return false
  }

  const selected = roster.find(bot => botWorkspaceOwnerKey(bot) === ownerKey)

  if (!selected) {
    // The plugin owns this namespace. A cold/offline roster must not replace
    // an explicitly chosen bot source with whichever cached row loads first.
    return ownerKey === `bot:${botRouteKey({ connectionId: focused.connectionId, profile: focused.name })}`
  }

  const route = resolveBotConnectionRoute(selected).route

  if (
    focused.connectionId !== (route?.connectionId ?? selected.connectionId ?? 'local') ||
    focused.name !== (route?.profile ?? selected.name)
  ) {
    return false
  }

  if (botRosterKey(selected) !== $selectedRosterKey.get()) {
    saveSelectedRosterBot(selected)
  }

  return true
}

/** A roster refresh may update presentation; it cannot take focus from a session. */
export function reconcileRosterWorkspaceOwner(roster: RosterRow[]): void {
  const focused = focusedRosterOwner($focusedBotOwner.get())
  const focusedStoredId = host.state.focusedStoredSessionId?.get?.()

  const hasSession =
    focusedStoredId !== undefined ? Boolean(focusedStoredId) : Boolean(host.state.activeSessionId?.get?.())

  let selected = roster.find(bot => botRosterKey(bot) === $selectedRosterKey.get())

  if (hasSession) {
    if (!focused?.authoritative || !focused.connectionId) {
      return
    }

    selected = roster.find(bot => {
      const route = resolveBotConnectionRoute(bot).route
      const connectionId = route?.connectionId ?? bot.connectionId ?? 'local'
      const profile = route?.profile ?? bot.name

      return connectionId === focused.connectionId && profile === focused.name
    })

    if (!selected) {
      return
    }

    if (botRosterKey(selected) !== $selectedRosterKey.get()) {
      saveSelectedRosterBot(selected)
    }
  }

  if (selected) {
    setBotsWorkspaceOwner(botWorkspaceOwnerKey(selected), selected)
  }
}
