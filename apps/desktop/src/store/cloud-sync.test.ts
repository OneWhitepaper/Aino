import { expect, test, vi } from 'vitest'

import { $cloudSync, connectCloudSync, onCloudHistoryChanged } from './cloud-sync'

test('late status reads cannot overwrite a newer invalidation or publish after retirement', async () => {
  let resolve!: (value: any) => void
  let changed!: (value: any) => void
  const listener = vi.fn()
  const off = onCloudHistoryChanged(listener)

  const disconnect = connectCloudSync({
    status: () =>
      new Promise(r => {
        resolve = r
      }),
    retry: vi.fn(),
    onChanged: handler => {
      changed = handler

      return vi.fn()
    }
  })

  const status = {
    state: 'synced',
    pending: 0,
    error: null,
    changed_profile_ids: [],
    changed_session_ids: ['new'],
    revision: 2
  }
  changed(status)
  resolve({ ...status, changed_session_ids: ['old'], revision: 1 })
  await Promise.resolve()
  expect($cloudSync.get()).toEqual(status)
  expect(listener).toHaveBeenCalledTimes(1)
  disconnect()
  changed({ ...status, revision: 3 })
  expect(listener).toHaveBeenCalledTimes(1)
  off()
})
