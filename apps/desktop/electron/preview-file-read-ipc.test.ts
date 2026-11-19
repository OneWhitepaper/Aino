import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

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

async function waitForPreviewChange(owner: EventEmitter, write: () => void, prime = false) {
  // fs.watch has no ready event. macOS can lose writes made immediately after
  // creating its stream, especially for a newly-created nested temp directory.
  // Repeated setup writes stop at the first real delivery; the assertion's
  // edit below is sent once, after that native readiness handshake.
  return new Promise<any>((resolve, reject) => {
    let writes: ReturnType<typeof setInterval> | undefined

    const clear = () => {
      clearTimeout(deadline)

      if (writes) {
        clearInterval(writes)
      }

      owner.removeListener(PREVIEW_FILE_CHANGED_CHANNEL, received)
    }

    const received = (payload: unknown) => {
      clear()
      resolve(payload)
    }

    const deadline = setTimeout(() => {
      clear()
      reject(new Error(prime ? 'preview watcher never became ready' : 'preview file change was not delivered'))
    }, 5000)

    owner.once(PREVIEW_FILE_CHANGED_CHANNEL, received)

    if (prime) {
      writes = setInterval(write, 250)
    }

    write()
  })
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

  const watcher = await watchPreviewFile(owner, file)

  if (!('id' in watcher)) {
    throw new Error('expected active file watch')
  }

  await waitForPreviewChange(owner, () => fs.appendFileSync(file, '\nwatch readiness'), true)
  const changed = await waitForPreviewChange(owner, () => fs.appendFileSync(file, '\nupdated'))
  expect(changed).toMatchObject({ id: watcher.id, path: file })
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

test('source references resolve to the real file for preview reads without losing their citation', async () => {
  const { home, invoke, resolve } = setup()
  const file = path.join(home, 'source with spaces.ts')
  fs.writeFileSync(file, 'export const preview = true\n')

  for (const reference of [
    `${file}:818`,
    `${file}:818:12`,
    `${file}:818-820`,
    `${file}#L818`,
    `${file}#L818-L820`,
    'source%20with%20spaces.ts:818',
    'source%20with%20spaces.ts%3A818',
    `${pathToFileURL(file)}:818`,
    `${pathToFileURL(file)}#L818`
  ]) {
    const target = await resolve(reference, home)
    expect(target, reference).toMatchObject({
      path: file,
      source: reference,
      url: pathToFileURL(file).href,
      previewKind: 'text',
      language: 'typescript'
    })

    if (!target || !('path' in target)) {
      throw new Error('expected a source file preview')
    }

    expect(await invoke('hermes:readFileText', target.path)).toMatchObject({
      text: 'export const preview = true\n',
      truncated: false
    })
  }
})

test('source-reference fallback preserves literal files and does not invent missing files or directories', async () => {
  const { home, resolve } = setup()
  fs.writeFileSync(path.join(home, 'source.ts'), 'ordinary source')

  // Hashes are legal filenames on every desktop host; numeric colons are
  // legal on POSIX. The real file must win over a possible line citation.
  for (const name of ['source.ts#L818', ...(process.platform === 'win32' ? [] : ['source.ts:818'])]) {
    const literal = path.join(home, name)
    fs.writeFileSync(literal, 'literal filename')
    expect(await resolve(literal, home)).toMatchObject({ path: literal, previewKind: 'text' })
    expect(await resolve(pathToFileURL(literal).href, home)).toMatchObject({ path: literal, previewKind: 'text' })
  }

  for (const missing of ['gone.ts:818', 'source.ts:abc', 'source.ts:0', 'source.ts#notes']) {
    expect(await resolve(missing, home)).toMatchObject({ previewKind: 'missing' })
  }

  const directory = path.join(home, 'folder')
  fs.mkdirSync(directory)
  expect(await resolve(`${directory}:818`, home)).toMatchObject({ previewKind: 'missing' })
  expect(await resolve('https://example.com:818/source.ts:12#L3', home)).toMatchObject({
    kind: 'url',
    source: 'https://example.com:818/source.ts:12#L3'
  })
})
