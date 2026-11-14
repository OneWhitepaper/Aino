import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, test } from 'vitest'

import { createPluginFiles, type PluginFiles, type PluginFolderGrant } from './plugin-files'

let scratch: string
let active: string
let accountA: string
let accountB: string
let folderA: string
let folderB: string
let files: PluginFiles

beforeEach(() => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aino-plugin-account-')))
  accountA = path.join(scratch, 'accounts', 'A')
  accountB = path.join(scratch, 'accounts', 'B')
  folderA = path.join(scratch, 'notebook-A')
  folderB = path.join(scratch, 'notebook-B')

  for (const directory of [accountA, accountB, folderA, folderB]) {
    fs.mkdirSync(directory, { recursive: true })
  }
  fs.writeFileSync(path.join(folderA, 'note.txt'), 'Account A private note')
  fs.writeFileSync(path.join(folderB, 'note.txt'), 'Account B private note')
  active = accountA
  files = createPluginFiles({ userDataDir: () => active, protectedRoots: () => [], trashItem: async () => undefined })
})

afterEach(() => fs.rmSync(scratch, { recursive: true, force: true }))

async function grant(folder: string): Promise<PluginFolderGrant> {
  const result = await files.addGrant('notebook', folder)
  expect(result.ok).toBe(true)

  return (result as { folder: PluginFolderGrant }).folder
}

test('account switching isolates plugin folder grants and restores only the returning account', async () => {
  const a = await grant(folderA)
  await expect(
    files.run('notebook', { op: 'writeText', folder: 'data', path: 'draft.txt', text: 'A draft' })
  ).resolves.toMatchObject({ ok: true })
  const readA = files.run('notebook', { op: 'readText', folder: 'data', path: 'draft.txt' })
  active = accountB
  await expect(readA).resolves.toMatchObject({ ok: true, text: 'A draft' })
  expect(await files.grants('notebook')).toEqual([])
  expect(await files.run('notebook', { op: 'readText', folder: a.id, path: 'note.txt' })).toMatchObject({
    ok: false,
    error: 'not-granted'
  })

  const b = await grant(folderB)
  const savedB = JSON.parse(fs.readFileSync(path.join(accountB, 'plugin-files', 'grants.json'), 'utf8'))
  expect(savedB.grants.notebook).toEqual([b])
  expect(await files.run('notebook', { op: 'readText', folder: b.id, path: 'note.txt' })).toMatchObject({
    ok: true,
    text: 'Account B private note'
  })
  expect(await files.run('notebook', { op: 'readText', folder: 'data', path: 'draft.txt' })).toMatchObject({
    ok: false,
    error: 'not-found'
  })
  await expect(
    files.run('notebook', { op: 'writeText', folder: 'data', path: 'draft.txt', text: 'B draft' })
  ).resolves.toMatchObject({ ok: true })

  active = accountA
  expect(await files.grants('notebook')).toEqual([a])
  expect(await files.run('notebook', { op: 'readText', folder: 'data', path: 'draft.txt' })).toMatchObject({
    ok: true,
    text: 'A draft'
  })
  expect(await files.run('notebook', { op: 'readText', folder: a.id, path: 'note.txt' })).toMatchObject({
    ok: true,
    text: 'Account A private note'
  })
  expect(await files.run('notebook', { op: 'readText', folder: b.id, path: 'note.txt' })).toMatchObject({
    ok: false,
    error: 'not-granted'
  })
})

test('a queued grant mutation stays with its original account after the active directory changes', async () => {
  const a = await grant(folderA)
  const revokeA = files.revoke('notebook', a.id)
  const pendingGrantA = files.addGrant('sketchbook', folderA)
  active = accountB
  const b = await grant(folderB)
  await expect(revokeA).resolves.toEqual({ ok: true, removed: 1 })
  const grantedA = await pendingGrantA
  expect(grantedA).toMatchObject({ ok: true })
  expect(await files.grants('notebook')).toEqual([b])
  expect(await files.grants('sketchbook')).toEqual([])

  active = accountA
  expect(await files.grants('notebook')).toEqual([])
  expect(await files.grants('sketchbook')).toEqual([(grantedA as { folder: PluginFolderGrant }).folder])
  const fresh = createPluginFiles({
    userDataDir: () => active,
    protectedRoots: () => [],
    trashItem: async () => undefined
  })
  expect(await fresh.grants('notebook')).toEqual([])
  active = accountB
  expect(await fresh.grants('notebook')).toEqual([b])
})
