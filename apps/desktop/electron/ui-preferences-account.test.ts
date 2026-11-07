import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { expect, test, vi } from 'vitest'

import { registerUiPreferencesIpc, type UiPreferencesSnapshot, writeUiPreferences } from './ui-preferences'

test('preference broadcasts follow the active account and stop after disposal', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aino-account-preferences-'))
  const accountA = path.join(root, 'alpha')
  const accountB = path.join(root, 'beta')
  await writeUiPreferences(path.join(accountA, 'ui-preferences.json'), {
    values: { 'hermes.desktop.account-test': 'alpha' }
  })
  await writeUiPreferences(path.join(accountB, 'ui-preferences.json'), {
    values: { 'hermes.desktop.account-test': 'beta' }
  })
  let activeHome = accountA
  const broadcast = vi.fn<(snapshot: UiPreferencesSnapshot) => void>()
  vi.useFakeTimers()

  const dispose = registerUiPreferencesIpc({
    ipcMain: { on() {}, handle() {} },
    hermesHome: () => activeHome,
    broadcast
  })

  try {
    activeHome = accountB
    await vi.advanceTimersByTimeAsync(2000)
    expect(broadcast).toHaveBeenLastCalledWith(
      expect.objectContaining({ values: { 'hermes.desktop.account-test': 'beta' } })
    )
    broadcast.mockClear()

    await writeUiPreferences(path.join(accountA, 'ui-preferences.json'), {
      values: { 'hermes.desktop.account-test': 'old-alpha' }
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(broadcast).not.toHaveBeenCalled()

    activeHome = accountA
    await vi.advanceTimersByTimeAsync(2000)
    expect(broadcast).toHaveBeenLastCalledWith(
      expect.objectContaining({ values: { 'hermes.desktop.account-test': 'old-alpha' } })
    )
    broadcast.mockClear()
    dispose()
    activeHome = accountB
    await vi.advanceTimersByTimeAsync(2000)
    expect(broadcast).not.toHaveBeenCalled()
  } finally {
    dispose()
    vi.useRealTimers()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
