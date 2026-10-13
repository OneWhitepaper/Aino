import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  home: '',
  handlers: new Map<string, (...args: any[]) => any>()
}))

vi.mock('electron', () => ({
  app: { getPath: () => electron.home },
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => electron.handlers.set(channel, handler)
  }
}))

import { TEXT_PREVIEW_MAX_BYTES } from './preview-file-metadata'
import { registerPreviewFileReadIpc } from './preview-file-read-ipc'
import { createPreviewTargetResolver } from './preview-file-target'
import { closePreviewWatchers, PREVIEW_FILE_CHANGED_CHANNEL, watchPreviewFile } from './preview-file-watch'

const scratch: string[] = []
afterEach(() => {
  closePreviewWatchers()

  for (const dir of scratch.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }

  electron.handlers.clear()
})

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-preview-files-'))
  scratch.push(home)
  electron.home = home
  registerPreviewFileReadIpc({ rememberLog: () => {} })

  const existsAs = (file: string, directory: boolean) => {
    try {
      const stat = fs.statSync(file)

      return directory ? stat.isDirectory() : stat.isFile()
    } catch {
      return false
    }
  }

  const resolve = createPreviewTargetResolver({
    hermesHome: home,
    resolveHermesCwd: () => home,
    fileExists: file => existsAs(file, false),
    directoryExists: file => existsAs(file, true)
  })

  const invoke = (channel: string, ...args: unknown[]) => electron.handlers.get(channel)!({}, ...args)

  return { home, invoke, resolve }
}

test('preview target resolution and registered readers agree on real file identity and missing paths', async () => {
  const { home, invoke, resolve } = setup()
  const file = path.join(home, 'notes with spaces.md')
  fs.writeFileSync(file, 'hello from the preview')
  const target = await resolve('notes%20with%20spaces.md', '')
  expect(target).toMatchObject({ path: file, previewKind: 'text', language: 'markdown' })

  if (!target || !('path' in target)) {
    throw new Error('expected local preview target')
  }

  expect(await invoke('hermes:readFileText', target.path)).toMatchObject({
    path: file,
    text: fs.readFileSync(file, 'utf8'),
    truncated: false
  })
  expect(await resolve(home, '')).toMatchObject({ previewKind: 'directory' })

  const owner = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: (channel: string, payload: unknown) => owner.emit(channel, payload)
  })

  const changed = new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('preview file change was not delivered')), 5000)
    owner.once(PREVIEW_FILE_CHANGED_CHANNEL, payload => {
      clearTimeout(timeout)
      resolve(payload)
    })
  })

  const watcher = await watchPreviewFile(owner, file)

  if (!('id' in watcher)) {
    throw new Error('expected active file watch')
  }

  fs.appendFileSync(file, '\nupdated')
  expect(await changed).toMatchObject({ id: watcher.id, path: file })
  owner.emit('destroyed')
  fs.unlinkSync(file)
  expect(await resolve(file, '')).toMatchObject({ previewKind: 'missing' })
  expect(await invoke('hermes:readFileText', file)).toMatchObject({ error: 'ENOENT' })
})

test('preview truncation leaves plugin reads complete and the persisted data URL cap round-trips', async () => {
  const { home, invoke } = setup()
  const file = path.join(home, 'plugin.js')
  const source = 'x'.repeat(TEXT_PREVIEW_MAX_BYTES + 1)
  fs.writeFileSync(file, source)
  const preview = await invoke('hermes:readFileText', file)
  const plugin = await invoke('hermes:readPluginSource', file)
  expect(preview.text.length).toBeLessThan(plugin.text.length)
  expect(preview).toMatchObject({ truncated: true, byteSize: Buffer.byteLength(source) })
  expect(plugin).toMatchObject({ text: source, truncated: false })
  const saved = await invoke('hermes:data-url-read-max:set', 4)
  registerPreviewFileReadIpc({ rememberLog: () => {} })
  expect(await invoke('hermes:data-url-read-max:get')).toEqual(saved)
})
