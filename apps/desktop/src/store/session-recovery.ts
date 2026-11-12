import { atom, type ReadableAtom } from 'nanostores'

import { platformAccountActions } from '@/api/platform'

import type { PlatformAccountSnapshot } from '../../shared/platform-contract'

import { $notificationEpoch } from './notifications'
import { $sessionStates, knownOwnerForSession } from './session-states'

/** Presentation recovery captures the same account/source epoch as its failing chat. */
export function captureSessionRecovery(runtimeId: string) {
  const epoch = $notificationEpoch.get()
  const bridge = window.hermesDesktop?.platformAccount
  const actions = bridge ? platformAccountActions(bridge) : null
  const account = actions?.snapshot.get()
  const boundAccount = $sessionStates.get()[runtimeId]?.platformModel?.ownerUserId
  const owner = JSON.stringify(knownOwnerForSession(runtimeId))

  return {
    runtimeId,
    accountStore: actions?.snapshot,
    isCurrent: () => {
      const next = actions?.snapshot.get()

      return (
        $notificationEpoch.get() === epoch &&
        (!boundAccount || boundAccount === account?.account?.id) &&
        window.hermesDesktop?.platformAccount === bridge &&
        next?.account?.id === account?.account?.id &&
        next?.revision === account?.revision &&
        next?.mode === account?.mode &&
        JSON.stringify(knownOwnerForSession(runtimeId)) === owner
      )
    }
  }
}

export interface DeferredSessionSignIn {
  runtimeId: string
  isCurrent: () => boolean
  recover: () => Promise<void>
  accountStore?: ReadableAtom<PlatformAccountSnapshot | null>
}

export const $deferredSessionSignIns = atom<Readonly<Record<string, DeferredSessionSignIn>>>({})

export function deferSessionSignIn(entry: DeferredSessionSignIn): void {
  if (entry.isCurrent()) {
    $deferredSessionSignIns.set({ ...$deferredSessionSignIns.get(), [entry.runtimeId]: entry })
  }
}

$notificationEpoch.listen(() => $deferredSessionSignIns.set({}))
