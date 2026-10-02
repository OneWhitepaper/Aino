import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setApiRequestConnection } from '@/api/client'
import { setRuntimeI18nLocale } from '@/i18n'
import { $connection } from '@/store/session'

import {
  createProjectFolder,
  createRemoteDir,
  desktopDefaultCwd,
  desktopFileDiff,
  desktopFsCacheKey,
  desktopGitRoot,
  readDesktopDir,
  readDesktopFileDataUrl,
  readDesktopFileDataUrlLocalFirst,
  readDesktopFileText,
  renameDesktopPath,
  selectDesktopPaths,
  setDesktopFsRemotePicker,
  trashDesktopPath,
  writeDesktopFileText
} from './desktop-fs'

const readDir = vi.fn(async () => ({ entries: [{ name: 'local', path: '/local', isDirectory: true }] }))
const readFileText = vi.fn(async () => ({ path: '/local/file.txt', text: 'local', byteSize: 5 }))
const readFileDataUrl = vi.fn(async () => 'data:text/plain;base64,bG9jYWw=')
const gitRoot = vi.fn(async () => '/local')
const selectPaths = vi.fn(async () => ['/local'])

const createDir = vi.fn(async (path: string) => ({ path }))

const api = vi.fn(async ({ body, path }: { body?: { path?: string }; path: string }) => {
  if (path.startsWith('/api/fs/list?')) {
    return { entries: [{ name: 'remote', path: '/remote', isDirectory: true }] }
  }

  if (path.startsWith('/api/fs/read-text?')) {
    return { path: '/remote/file.txt', text: 'remote', byteSize: 6 }
  }

  if (path.startsWith('/api/fs/read-data-url?')) {
    return { dataUrl: 'data:text/plain;base64,cmVtb3Rl' }
  }

  if (path.startsWith('/api/fs/git-root?')) {
    return { root: '/remote' }
  }

  if (path === '/api/fs/default-cwd') {
    return { cwd: '/backend/project', branch: 'main' }
  }

  if (path === '/api/files/mkdir') {
    return { ok: true, path: body?.path }
  }

  if (path.startsWith('/api/git/file-diff?')) {
    return { diff: 'remote diff' }
  }

  throw new Error(`unexpected path ${path}`)
})

function stubBridge() {
  vi.stubGlobal('window', {
    hermesDesktop: {
      api,
      createDir,
      gitRoot,
      readDir,
      readFileDataUrl,
      readFileText,
      selectPaths
    }
  })
}

describe('desktop filesystem facade', () => {
  beforeEach(() => {
    setRuntimeI18nLocale('en')
    stubBridge()
    $connection.set(null)
    setApiRequestConnection(null)
  })

  afterEach(() => {
    setRuntimeI18nLocale('en')
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    $connection.set(null)
    setApiRequestConnection(null)
    setDesktopFsRemotePicker(null)
  })

  it('uses local Electron filesystem methods in local mode', async () => {
    $connection.set({ mode: 'local', profile: 'team-local' } as never)

    await expect(readDesktopDir('/work')).resolves.toEqual({
      entries: [{ name: 'local', path: '/local', isDirectory: true }]
    })
    await expect(readDesktopFileText('/work/file.txt')).resolves.toMatchObject({ text: 'local' })
    await expect(readDesktopFileDataUrl('/work/file.txt')).resolves.toBe('data:text/plain;base64,bG9jYWw=')
    await expect(desktopGitRoot('/work')).resolves.toBe('/local')
    await expect(selectDesktopPaths({ directories: true })).resolves.toEqual(['/local'])

    expect(readDir).toHaveBeenCalledWith('/work')
    expect(readFileText).toHaveBeenCalledWith('/work/file.txt')
    expect(readFileDataUrl).toHaveBeenCalledWith('/work/file.txt')
    expect(gitRoot).toHaveBeenCalledWith('/work')
    expect(selectPaths).toHaveBeenCalledWith({ directories: true, profile: 'team-local' })
    expect(api).not.toHaveBeenCalled()
  })

  it('uses Simplified Chinese copy when local edit methods are unavailable', async () => {
    setRuntimeI18nLocale('zh')

    await expect(writeDesktopFileText('/local/file.txt', 'updated')).rejects.toThrow('保存功能不可用')
    await expect(renameDesktopPath('/local/file.txt', 'renamed.txt')).rejects.toThrow('重命名功能不可用')
    await expect(trashDesktopPath('/local/file.txt')).rejects.toThrow('删除功能不可用')
  })

  it('routes filesystem reads through authenticated backend REST in remote mode', async () => {
    $connection.set({ mode: 'remote' } as never)

    await expect(readDesktopDir('/home/user/project')).resolves.toMatchObject({ entries: [{ name: 'remote' }] })
    await expect(readDesktopFileText('/home/user/project/a b.txt')).resolves.toMatchObject({ text: 'remote' })
    await expect(readDesktopFileDataUrl('/home/user/project/a b.txt')).resolves.toBe('data:text/plain;base64,cmVtb3Rl')
    await expect(desktopGitRoot('/home/user/project')).resolves.toBe('/remote')
    await expect(desktopDefaultCwd()).resolves.toEqual({ cwd: '/backend/project', branch: 'main' })

    expect(api).toHaveBeenCalledWith({ path: '/api/fs/list?path=%2Fhome%2Fuser%2Fproject' })
    expect(api).toHaveBeenCalledWith({ path: '/api/fs/read-text?path=%2Fhome%2Fuser%2Fproject%2Fa%20b.txt' })
    expect(api).toHaveBeenCalledWith({ path: '/api/fs/read-data-url?path=%2Fhome%2Fuser%2Fproject%2Fa%20b.txt' })
    expect(api).toHaveBeenCalledWith({ path: '/api/fs/git-root?path=%2Fhome%2Fuser%2Fproject' })
    expect(api).toHaveBeenCalledWith({ path: '/api/fs/default-cwd' })
    expect(readDir).not.toHaveBeenCalled()
    expect(readFileText).not.toHaveBeenCalled()
    expect(readFileDataUrl).not.toHaveBeenCalled()
    expect(gitRoot).not.toHaveBeenCalled()
  })

  it('creates remote folders through the backend mkdir route for the active profile', async () => {
    $connection.set({ mode: 'remote', profile: 'team-remote' } as never)

    await expect(createRemoteDir('/home/user/new folder')).resolves.toBe('/home/user/new folder')

    expect(api).toHaveBeenCalledWith({
      body: { path: '/home/user/new folder' },
      method: 'POST',
      path: '/api/files/mkdir',
      profile: 'team-remote'
    })
  })

  it('creates a same-named local project folder under the selected parent', async () => {
    $connection.set({ mode: 'local' } as never)

    await expect(createProjectFolder('/Users/test/projects', 'Skunkworks')).resolves.toBe(
      '/Users/test/projects/Skunkworks'
    )
    expect(createDir).toHaveBeenCalledWith('/Users/test/projects/Skunkworks')
  })

  it('creates a same-named remote project folder under the selected backend parent', async () => {
    $connection.set({ mode: 'remote' } as never)

    await expect(createProjectFolder('/backend/project', 'Skunkworks')).resolves.toBe('/backend/project/Skunkworks')
    expect(api).toHaveBeenCalledWith({
      body: { path: '/backend/project/Skunkworks' },
      method: 'POST',
      path: '/api/files/mkdir'
    })
  })

  it('does not retry the same unreadable path through the local facade', async () => {
    const error = new Error('not readable')

    $connection.set({ mode: 'local' } as never)
    readFileDataUrl.mockRejectedValueOnce(error)

    await expect(readDesktopFileDataUrlLocalFirst('/missing.png')).rejects.toBe(error)
    expect(readFileDataUrl).toHaveBeenCalledOnce()
    expect(api).not.toHaveBeenCalled()
  })

  it('falls back from local disk to the active gateway in remote mode', async () => {
    $connection.set({ mode: 'remote' } as never)
    readFileDataUrl.mockRejectedValueOnce(new Error('not on host'))

    await expect(readDesktopFileDataUrlLocalFirst('/remote/image.png')).resolves.toBe('data:text/plain;base64,cmVtb3Rl')
    expect(readFileDataUrl).toHaveBeenCalledOnce()
    expect(api).toHaveBeenCalledWith({ path: '/api/fs/read-data-url?path=%2Fremote%2Fimage.png' })
  })

  it('targets the active profile backend so a remote profile never reads local disk', async () => {
    $connection.set({ mode: 'remote', profile: 'remote-docker' } as never)

    await readDesktopDir('/srv/project')
    await desktopDefaultCwd()

    expect(api).toHaveBeenCalledWith({ path: '/api/fs/list?path=%2Fsrv%2Fproject', profile: 'remote-docker' })
    expect(api).toHaveBeenCalledWith({ path: '/api/fs/default-cwd', profile: 'remote-docker' })
  })

  it('pins SSH filesystem reads to the active registry connection', async () => {
    $connection.set({
      connectionId: 'work-ssh',
      mode: 'remote',
      profile: 'default',
      remoteKind: 'ssh'
    } as never)
    setApiRequestConnection('work-ssh')

    await readDesktopFileDataUrl('/srv/project/image.png')

    expect(api).toHaveBeenCalledWith({
      connectionId: 'work-ssh',
      path: '/api/fs/read-data-url?path=%2Fsrv%2Fproject%2Fimage.png',
      profile: 'default'
    })
  })

  it('pins remote filesystem requests to the active registry connection', async () => {
    $connection.set({ connectionId: 'mr-small', mode: 'remote', profile: 'default' } as never)
    setApiRequestConnection('mr-small')

    await readDesktopDir('/home/doug/default-profile-workspace')
    await readDesktopFileText('/home/doug/default-profile-workspace/IDEA.md')
    await readDesktopFileDataUrl('/home/doug/default-profile-workspace/IDEA.md')
    await desktopGitRoot('/home/doug/default-profile-workspace')
    await desktopDefaultCwd()
    await desktopFileDiff('/home/doug/default-profile-workspace', 'IDEA.md')

    expect(api).toHaveBeenCalledTimes(6)

    for (const [request] of api.mock.calls) {
      expect(request).toMatchObject({ connectionId: 'mr-small', profile: 'default' })
    }
  })

  it('separates filesystem cache keys for registered connections sharing a profile', () => {
    $connection.set({
      baseUrl: 'https://gateway.example',
      connectionId: 'mr-small',
      mode: 'remote',
      profile: 'default'
    } as never)
    const mrSmallKey = desktopFsCacheKey()

    $connection.set({
      baseUrl: 'https://gateway.example',
      connectionId: 'other-default',
      mode: 'remote',
      profile: 'default'
    } as never)

    expect(desktopFsCacheKey()).not.toBe(mrSmallKey)
  })

  it('prefers registry connection identity over SSH host identity', () => {
    $connection.set({
      baseUrl: 'http://127.0.0.1:41001',
      connectionId: 'connection-a',
      mode: 'remote',
      remoteHost: 'operator@remote-box',
      remoteKind: 'ssh',
      remoteIdentity: 'operator@remote-box',
      profile: 'default'
    } as never)
    const first = desktopFsCacheKey()

    $connection.set({
      baseUrl: 'http://127.0.0.1:52002',
      connectionId: 'connection-b',
      mode: 'remote',
      remoteHost: 'operator@remote-box',
      remoteKind: 'ssh',
      remoteIdentity: 'operator@remote-box',
      profile: 'default'
    } as never)

    expect(desktopFsCacheKey()).not.toBe(first)
  })

  it('keys SSH filesystem caches by stable host identity instead of the forwarded port', () => {
    $connection.set({
      mode: 'remote',
      remoteKind: 'ssh',
      remoteHost: 'operator@remote-box',
      baseUrl: 'http://127.0.0.1:41001'
    } as never)
    const first = desktopFsCacheKey()

    $connection.set({
      mode: 'remote',
      remoteKind: 'ssh',
      remoteHost: 'operator@remote-box',
      baseUrl: 'http://127.0.0.1:52002'
    } as never)

    expect(desktopFsCacheKey()).toBe(first)
    expect(first).toContain('operator@remote-box')
    expect(first).not.toContain('41001')
  })

  it('separates SSH filesystem caches by ownership and profile', () => {
    $connection.set({
      mode: 'remote',
      remoteKind: 'ssh',
      remoteHost: 'host-a',
      remoteIdentity: 'owner-a',
      profile: 'one'
    } as never)
    const first = desktopFsCacheKey()
    $connection.set({
      mode: 'remote',
      remoteKind: 'ssh',
      remoteHost: 'host-a',
      remoteIdentity: 'owner-b',
      profile: 'one'
    } as never)
    const otherOwner = desktopFsCacheKey()
    $connection.set({
      mode: 'remote',
      remoteKind: 'ssh',
      remoteHost: 'host-a',
      remoteIdentity: 'owner-a',
      profile: 'two'
    } as never)

    expect(otherOwner).not.toBe(first)
    expect(desktopFsCacheKey()).not.toBe(first)
  })

  it('routes file diffs through backend git in remote mode', async () => {
    $connection.set({ mode: 'remote' } as never)

    await expect(desktopFileDiff('/repo', 'src/a b.ts')).resolves.toBe('remote diff')
    expect(api).toHaveBeenCalledWith({ path: '/api/git/file-diff?path=%2Frepo&file=src%2Fa%20b.ts' })
  })

  it('uses the registered in-app directory picker in remote mode', async () => {
    const remoteSelect = vi.fn(async () => ['/remote/project'])
    $connection.set({ mode: 'remote' } as never)
    setDesktopFsRemotePicker({ selectPaths: remoteSelect })

    await expect(selectDesktopPaths({ defaultPath: '/remote', directories: true, multiple: false })).resolves.toEqual([
      '/remote/project'
    ])

    expect(remoteSelect).toHaveBeenCalledWith({ defaultPath: '/remote', directories: true, multiple: false })
    expect(selectPaths).not.toHaveBeenCalled()
  })

  it('uses the local Electron picker for remote file selection', async () => {
    const remoteSelect = vi.fn(async () => ['/remote/project'])
    $connection.set({ mode: 'remote', profile: 'team-remote' } as never)
    setDesktopFsRemotePicker({ selectPaths: remoteSelect })

    await expect(selectDesktopPaths({ directories: false, multiple: false })).resolves.toEqual(['/local'])

    expect(selectPaths).toHaveBeenCalledWith({ directories: false, multiple: false, profile: 'team-remote' })
    expect(remoteSelect).not.toHaveBeenCalled()
  })

  it('limits the remote picker to single-directory selection', async () => {
    const remoteSelect = vi.fn(async () => ['/remote/project'])
    $connection.set({ mode: 'remote' } as never)
    setDesktopFsRemotePicker({ selectPaths: remoteSelect })

    await expect(selectDesktopPaths({ directories: true })).resolves.toEqual(['/remote/project'])

    expect(remoteSelect).toHaveBeenCalledWith({ directories: true, multiple: false })
    expect(selectPaths).not.toHaveBeenCalled()
  })
})
