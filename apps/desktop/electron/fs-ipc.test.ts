/**
 * `hermes:fs:reveal` answers what it did (#115167). `shell.showItemInFolder`
 * selects an existing item and silently no-ops on a missing one, and a remote
 * backend's paths are missing on this computer by construction — a `true` for
 * them left the renderer nothing to say.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  openPath: vi.fn(async () => ''),
  showItemInFolder: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => electron.handlers.set(channel, handler)
  },
  shell: {
    showItemInFolder: electron.showItemInFolder,
    openPath: electron.openPath
  }
}))

vi.mock('./desktop-plugin-install', () => ({ installDesktopPluginFromGit: vi.fn(), probePluginRepo: vi.fn() }))
vi.mock('./desktop-plugins-root', () => ({
  DESKTOP_PLUGINS_DIR: 'desktop-plugins',
  ensureDir: vi.fn(),
  migrateProfileScopedDesktopPlugins: vi.fn(),
  reconcileUnifiedDesktopHalves: vi.fn()
}))

import { registerFsIpc } from './fs-ipc'
import { resolveRequestedPathForIpc } from './hardening'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-fs-ipc-'))

registerFsIpc({
  hermesHome: scratch,
  readActiveDesktopProfile: () => null,
  // `~/` resolves under the scratch dir so tilde paths can be exercised.
  expandUserPath: value => (value.startsWith('~/') ? path.join(scratch, value.slice(2)) : value),
  resolveRequestedPathForIpc,
  directoryExists: value => fs.statSync(value, { throwIfNoEntry: false })?.isDirectory() ?? false,
  resolveGitBinary: () => 'git'
})

const reveal = (target: string) => electron.handlers.get('hermes:fs:reveal')!({}, target)
const createDir = (target: string) => electron.handlers.get('hermes:fs:createDir')!({}, target)

afterEach(() => {
  electron.openPath.mockClear()
  electron.showItemInFolder.mockClear()
})

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true })
})

describe('hermes:fs:reveal', () => {
  it('reveals a path that exists on this computer', async () => {
    const file = path.join(scratch, 'workspace')
    fs.mkdirSync(file)

    await expect(reveal(file)).resolves.toBe(true)
    expect(electron.showItemInFolder).toHaveBeenCalledWith(file)
  })

  // A remote backend's workspace is not on this machine: showItemInFolder
  // would silently no-op, so the door must report the miss instead of success.
  it('reports false without touching the file manager when the path is missing', async () => {
    await expect(reveal(path.join(scratch, 'not-here'))).resolves.toBe(false)
    expect(electron.showItemInFolder).not.toHaveBeenCalled()
  })

  // The renderer may hand over a tilde path; the existence check runs on the
  // expanded path, and the expanded path is what the file manager is shown.
  it('expands a tilde path before checking and revealing it', async () => {
    const here = path.join(scratch, 'tilde.md')

    fs.writeFileSync(here, 'x')

    await expect(reveal('~/tilde.md')).resolves.toBe(true)
    expect(electron.showItemInFolder).toHaveBeenCalledWith(here)
  })
})

describe('hermes:fs:createDir', () => {
  it('creates or reuses a child concurrently without changing its contents or opening the file manager', async () => {
    const parent = path.join(scratch, 'projects')
    fs.mkdirSync(parent)

    const target = path.join(parent, 'Skunkworks')
    await expect(Promise.all([createDir('~/projects/Skunkworks'), createDir(target)])).resolves.toEqual([
      { path: target },
      { path: target }
    ])
    expect(fs.readdirSync(target)).toEqual([])
    const file = path.join(target, 'keep.txt')
    fs.writeFileSync(file, 'preserve me')
    await expect(Promise.all([createDir(target), createDir(target)])).resolves.toEqual([
      { path: target },
      { path: target }
    ])
    expect(fs.readFileSync(file, 'utf8')).toBe('preserve me')
    expect(fs.readdirSync(target)).toEqual(['keep.txt'])
    expect(electron.openPath).not.toHaveBeenCalled()
    expect(electron.showItemInFolder).not.toHaveBeenCalled()
  })

  it('preserves existing paths and rejects invalid paths or missing parents', async () => {
    const existing = path.join(scratch, 'already-there')
    fs.mkdirSync(existing)
    const file = path.join(existing, 'keep.txt')
    fs.writeFileSync(file, 'preserve me')

    await expect(createDir(file)).rejects.toThrow('Path exists and is not a directory')
    await expect(createDir(path.join(file, 'child'))).rejects.toThrow('Parent directory does not exist')
    const missingParent = path.join(scratch, 'not-created')
    await expect(createDir(path.join(missingParent, 'child'))).rejects.toThrow('Parent directory does not exist')
    await expect(createDir(path.join(existing, '\0invalid'))).rejects.toThrow('file path is invalid')
    expect(fs.readFileSync(file, 'utf8')).toBe('preserve me')
    expect(fs.readdirSync(existing)).toEqual(['keep.txt'])
    expect(fs.existsSync(missingParent)).toBe(false)
  })
})
