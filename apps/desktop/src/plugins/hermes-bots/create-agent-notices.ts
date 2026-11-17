import { host } from '@hermes/plugin-sdk'

import { $lastRoster, botRosterKey } from './data'
import type { useBots } from './i18n'
import type { ConnectionRow, RosterRow } from './types'

export type RuntimeReadiness = { error?: string; ok?: boolean; provider?: string } | null

/** Report creation separately from whether its first model turn is ready. */
export function notifyCreatedBot(
  readiness: RuntimeReadiness,
  {
    bot,
    createdMessage,
    editor,
    onConfigureModel,
    remoteTarget,
    resolveBot
  }: {
    bot: RosterRow
    createdMessage: string
    editor: ReturnType<typeof useBots>['editor']
    onConfigureModel: ((bot: RosterRow) => void) | undefined
    remoteTarget: boolean
    resolveBot?: () => RosterRow
  }
): boolean {
  const needsModel = readiness?.ok === false
  const platformUnavailable = needsModel && readiness?.provider === 'aino'
  host.notify(
    needsModel
      ? {
          kind: 'warning',
          persistent: true,
          title: createdMessage,
          message: platformUnavailable ? readiness.error || editor.modelSwitchFailed : editor.needsModel,
          ...(!platformUnavailable ? { detail: readiness?.error } : {}),
          ...(!platformUnavailable && !remoteTarget && onConfigureModel
            ? { action: { label: editor.configureModel, onClick: () => onConfigureModel(resolveBot?.() ?? bot) } }
            : {})
        }
      : { kind: 'success', message: createdMessage }
  )

  return needsModel
}

export interface DraftReceipt {
  adopted?: boolean
  owner: string
  warning: null | { message: string; title: string }
}

/** A creation warning names the profile and the machine it was created on
 *  (no machine on a legacy gateway without connection ids: never guess 'local'). */
export function creationWarningTitle(profile: string, connectionId: string, connections: ConnectionRow[] | null) {
  const machine = (connections || []).find(c => c.id === connectionId)?.label

  return connectionId ? `${profile} — ${machine ? `${machine} (${connectionId})` : connectionId}` : profile
}

/** The bot's live roster row on the connection it was created on (what Edit
 *  Profile gets from the roster). Until the roster lists it: `fallback` while
 *  that connection is still the active one, else a row pinned to it, so a
 *  same-named bot on the gateway switched to is never the one edited. */
export function liveRosterRow(name: string, connectionId: string, fallback: RosterRow): RosterRow {
  const key = botRosterKey({ connectionId: connectionId || undefined, name })
  const live = $lastRoster.get().find(row => botRosterKey(row) === key)
  const active = String(host.state?.connectionId?.get?.() || '').trim()

  return (
    live ?? (connectionId && connectionId !== active ? { ...fallback, connectionId, sourceScoped: true } : fallback)
  )
}

export function adoptCreationReceipt(ref: { current: DraftReceipt | null }, fallbackOwner: string) {
  const receipt = ref.current

  if (receipt) {
    receipt.adopted = true
  }

  return { receipt, createdOn: receipt?.owner ?? fallbackOwner }
}

export function publishCreationWarning(receipt: DraftReceipt | null, current: DraftReceipt | null): void {
  if (receipt?.adopted && receipt.warning && receipt === current) {
    host.notify({ kind: 'warning', title: receipt.warning.title, message: receipt.warning.message, persistent: true })
  }
}
