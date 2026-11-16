import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { expect, test } from 'vitest'

import { assertNaturalZipMigration, findPersistedChat } from '../../tests/install/e2e-assets/released-zip-migration.ts'

test('a ZIP chat receipt selects the durable API rows written by that exact completed prompt', async (): Promise<void> => {
  const messages = [{ id: 10, role: 'user', content: 'earlier prompt' },
    { id: 11, role: 'assistant', content: 'earlier answer' },
    { id: 12, role: 'user', content: 'unique ZIP prompt' },
    { id: 13, role: 'assistant', content: 'the completed ZIP answer' }]

  const api = async (route: string): Promise<unknown> => route.startsWith('/api/sessions/search?')
    ? { results: [{ session_id: 'zip-session' }] } : { session_id: 'zip-session', messages }

  expect(await findPersistedChat(api, 'unique ZIP prompt', 'completed ZIP answer')).toEqual({
    profile: 'default', sessionId: 'zip-session', messages: messages.slice(2),
  })
  await expect(findPersistedChat(api, 'absent prompt', 'completed ZIP answer')).rejects.toThrow('durable')
  await expect(findPersistedChat(api, 'unique ZIP prompt', 'another answer')).rejects.toThrow('durable')
})

test('natural ZIP migration requires the same data roots and a new owner from the candidate payload', (): void => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-owner-'))
  const payloadRoot = path.join(directory, 'candidate', 'agent-payload')
  fs.mkdirSync(payloadRoot, { recursive: true })
  fs.writeFileSync(path.join(payloadRoot, 'python.exe'), 'candidate runtime')
  const oldExecutable = path.join(directory, 'legacy-python.exe')
  fs.writeFileSync(oldExecutable, 'legacy runtime')

  const legacy = { userData: '/isolated/user-data', hermesHome: '/isolated/account',
    owner: { pid: 101, startTime: 1000, instanceId: 'zip-owner', home: '/isolated/account',
      commit: 'a'.repeat(40), executable: oldExecutable } }

  const current = { userData: legacy.userData, hermesHome: legacy.hermesHome,
    owner: { pid: 202, startTime: 2000, instanceId: 'msix-owner', home: legacy.hermesHome,
      commit: 'b'.repeat(40), executable: path.join(payloadRoot, 'python.exe') } }

  const expected = { commit: 'b'.repeat(40), payloadRoot }

  try {
  expect(() => assertNaturalZipMigration(legacy, current, expected)).not.toThrow()
  expect(() => assertNaturalZipMigration(legacy, { ...current, userData: '/fresh' }, expected)).toThrow('data')
  expect(() => assertNaturalZipMigration(legacy, { ...current, hermesHome: '/fresh' }, expected)).toThrow('data')
  expect(() => assertNaturalZipMigration(legacy, { ...current, owner: legacy.owner }, expected)).toThrow('code')
  expect(() => assertNaturalZipMigration(legacy, { ...current, owner: { ...current.owner,
    instanceId: legacy.owner.instanceId } }, expected)).toThrow('owner')
  expect(() => assertNaturalZipMigration(legacy, { ...current, owner: { ...current.owner,
    executable: legacy.owner.executable } }, expected)).toThrow('payload')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
