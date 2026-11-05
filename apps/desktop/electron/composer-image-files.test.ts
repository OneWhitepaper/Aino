import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

const appPath = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? appPath.userData : '') },
  dialog: { showSaveDialog: vi.fn() }
}))

const { writeComposerImage } = await import('./composer-image-files')

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })))
})

test('writes pasted images under the active account root supplied by the caller', async () => {
  appPath.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'aino-composer-shared-'))
  const accountA = await fs.mkdtemp(path.join(os.tmpdir(), 'aino-composer-a-'))
  const accountB = await fs.mkdtemp(path.join(os.tmpdir(), 'aino-composer-b-'))
  roots.push(appPath.userData, accountA, accountB)

  const first = await writeComposerImage(Buffer.from('a'), '.png', 'private', accountA)
  const second = await writeComposerImage(Buffer.from('b'), '.png', 'private', accountB)

  expect(first.startsWith(path.join(accountA, 'composer-images') + path.sep)).toBe(true)
  expect(second.startsWith(path.join(accountB, 'composer-images') + path.sep)).toBe(true)
  await expect(fs.readFile(first, 'utf8')).resolves.toBe('a')
  await expect(fs.readFile(second, 'utf8')).resolves.toBe('b')
  await expect(fs.readdir(path.join(appPath.userData, 'composer-images'))).rejects.toMatchObject({ code: 'ENOENT' })
})
