import { atom } from 'nanostores'

import type { CloudSyncBridge, CloudSyncStatus } from '../../shared/platform-sync-contract'

export const $cloudSync = atom<CloudSyncStatus>({
  state: 'disabled',
  pending: 0,
  error: null,
  revision: 0,
  changed_session_ids: [],
  changed_profile_ids: []
})
const historyListeners = new Set<(status: CloudSyncStatus) => void>()

export function onCloudHistoryChanged(listener: (status: CloudSyncStatus) => void) {
  historyListeners.add(listener)

  return () => {
    historyListeners.delete(listener)
  }
}

export function connectCloudSync(bridge: CloudSyncBridge) {
  let alive = true
  let revision = -1

  const apply = (status: CloudSyncStatus) => {
    if (!alive || !status || status.revision <= revision) {
      return
    }
    revision = status.revision
    $cloudSync.set(status)

    if (status.changed_session_ids.length || status.changed_profile_ids.length) {
      for (const listener of historyListeners) {
        listener(status)
      }
    }
  }

  const off = bridge.onChanged(apply)
  void bridge
    .status()
    .then(apply)
    .catch(() => {})

  return () => {
    alive = false
    off()
  }
}
