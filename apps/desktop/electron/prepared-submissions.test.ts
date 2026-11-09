import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { ipcMain } from 'electron'
import { expect, test, vi } from 'vitest'
vi.mock('electron', () => ({ app: {}, ipcMain: { handle: vi.fn(), on: vi.fn(), removeListener: vi.fn(), off: vi.fn() } }))
import { createAccountWorkspaceIpc } from './account-workspace'
import { preparedJournal, registerPreparedSubmissions } from './prepared-submissions'

test('acknowledged journal mutations survive reopening with exact payload and origin isolation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepared-journal-'))

  try {
    const origin = 'http://localhost:5174'
    const key = JSON.stringify(['remote', 'profile-a', 'stored-a'])
    const entry = { id: 'id-a', text: 'Ω 👩🏽‍💻 e\u0301\n  []', attachments: [{ id: 'asset', path: '/tmp/Ω' }], params: { session_id: 'live-a' } }
    preparedJournal(dir, origin).update(key, entry)
    preparedJournal(dir, origin).update('other-profile', { id: 'id-b' })
    expect(preparedJournal(dir, origin).read()[key]).toEqual(entry)
    expect(preparedJournal(dir, 'http://other:5174').read()).toEqual({})
    preparedJournal(dir, origin).update(key, null)
    expect(preparedJournal(dir, origin).read()).toEqual({ 'other-profile': { id: 'id-b' } })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a corrupt journal is quarantined with its bytes kept, and the origin can send again', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepared-journal-'))

  try {
    const origin = 'http://localhost:5174'
    preparedJournal(dir, origin).update('kept', { id: 'id-a' })
    const [file] = fs.readdirSync(dir).map(name => path.join(dir, name))
    fs.writeFileSync(file, '{"kept":{"id":"id-')

    expect(preparedJournal(dir, origin).read()).toEqual({})
    preparedJournal(dir, origin).update('next', { id: 'id-b' })
    expect(preparedJournal(dir, origin).read()).toEqual({ next: { id: 'id-b' } })
    const aside = fs.readdirSync(dir).filter(name => name.includes('.corrupt-'))
    expect(aside.map(name => fs.readFileSync(path.join(dir, name), 'utf8'))).toEqual(['{"kept":{"id":"id-'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a retired account window cannot abandon an identical intent copied into the current account', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepared-journal-account-'))
  const origin = 'https://desktop.invalid'
  const accountA = path.join(dir, 'account-a')
  const accountB = path.join(dir, 'account-b')
  const binding = { connectionId: 'local', profile: 'bot-a', roomId: 'room-a' }
  const key = JSON.stringify(['canonical-group-send-v1', binding.connectionId, binding.profile, binding.roomId])
  const entry = { binding, params: { room_id: binding.roomId, event_id: 'same-event', payload: { text: 'same text' } }, attempts: 1 }
  const original = { handle: ipcMain.handle, on: ipcMain.on, removeListener: ipcMain.removeListener, off: ipcMain.off }
  const handlers = new Map<string, Parameters<typeof ipcMain.handle>[1]>()
  let activeSender = 1
  let accountDir = accountA

  try {
    vi.mocked(ipcMain.handle).mockImplementation((channel, listener) => { handlers.set(channel, listener) })
    createAccountWorkspaceIpc(ipcMain, senderId => senderId === activeSender, () => true)
    registerPreparedSubmissions(() => accountDir)
    preparedJournal(accountA, origin).update(key, entry)
    preparedJournal(accountB, origin).update(key, entry)
    const abandon = handlers.get('hermes:prepared-submissions:compare-and-set')!
    const event = (id: number) => ({ sender: { id }, senderFrame: { url: `${origin}/` } } as Electron.IpcMainInvokeEvent)
    activeSender = 2
    accountDir = accountB

    expect(() => abandon(event(1), key, JSON.stringify(entry), null)).toThrow('account_workspace_unavailable')
    expect(preparedJournal(accountA, origin).read()[key]).toEqual(entry)
    expect(preparedJournal(accountB, origin).read()[key]).toEqual(entry)
    expect(abandon(event(2), key, JSON.stringify(entry), null)).toEqual({ applied: true, current: null })
    expect(preparedJournal(accountA, origin).read()[key]).toEqual(entry)
    expect(preparedJournal(accountB, origin).read()).toEqual({})
  } finally {
    Object.assign(ipcMain, original)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
