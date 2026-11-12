import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { Session, WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAccountWorkspaceIpc } from './account-workspace'
import { type ExportVerdict, PreviewSigninsRecord, registerPreviewSigninsIpc } from './preview-signins'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true })
  }
})

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-account-'))
  roots.push(root)
  const handlers = new Map<string, (...args: any[]) => any>()

  const raw = {
    handle: (name: string, run: (...args: any[]) => any) => handlers.set(name, run),
    on: vi.fn(),
    removeListener: vi.fn()
  }

  let allowed = true
  let account = 'a'
  let local = true
  const sets = new Map<string, ReturnType<typeof vi.fn>>()
  const clears = new Map<string, ReturnType<typeof vi.fn>>()

  const fence = createAccountWorkspaceIpc(
    raw,
    () => allowed,
    () => true
  )

  const exportSignins = vi.fn<() => Promise<ExportVerdict>>(async () => ({
    status: 'ok',
    cookies: [{ domain: 'example.com', name: 'auth', value: 'account-cookie' }]
  }))

  const resolveRoute = vi.fn(async (_sender, profile) => ({ profile: profile || 'default', local }))

  registerPreviewSigninsIpc(fence.ipc, () => {
    const owner = account
    const set = sets.get(owner) ?? vi.fn(async () => undefined)
    const remove = clears.get(owner) ?? vi.fn(async () => undefined)
    sets.set(owner, set)
    clears.set(owner, remove)

    return {
      session: () => ({ cookies: { set, remove, get: async () => [] } }) as unknown as Session,
      store: new PreviewSigninsRecord(path.join(root, owner, 'preview-signins.json')),
      resolveRoute,
      exportSignins,
      log: () => undefined
    }
  })

  const invoke = (action: string, payload: unknown) =>
    handlers.get(`hermes:preview-signins:${action}`)!({ sender: { id: 1 } as WebContents }, payload)

  return {
    root,
    sets,
    clears,
    invoke,
    fence,
    exportSignins,
    resolveRoute,
    account: (next: string) => {
      account = next
    },
    allow: (next: boolean) => {
      allowed = next
    },
    local: (next: boolean) => {
      local = next
    }
  }
}

describe('preview sign-ins keep the account and local profile that own their request', () => {
  it('captures queued imports before account activation and drains the existing IPC fence', async () => {
    const h = harness()
    let release!: (result: ExportVerdict) => void
    let started!: () => void

    const exporting = new Promise<void>(resolve => {
      started = resolve
    })

    h.exportSignins.mockImplementationOnce(() => {
      started()

      return new Promise(resolve => {
        release = resolve
      })
    })

    const first = h.invoke('sync', { enabled: true, profile: 'work' })
    await exporting
    const queued = h.invoke('sync', { enabled: true, profile: 'work' })
    let drained = false
    h.allow(false)

    const switching = h.fence.drain().then(() => {
      drained = true
      h.account('b')
    })

    await Promise.resolve()
    expect(drained).toBe(false)
    release({ status: 'ok', cookies: [{ domain: 'example.com', name: 'auth', value: 'a' }] })
    await Promise.all([first, queued, switching])

    expect(h.sets.get('a')).toHaveBeenCalledTimes(2)
    expect(h.sets.has('b')).toBe(false)
    expect(fs.existsSync(path.join(h.root, 'a', 'preview-signins.json'))).toBe(true)
    expect(fs.existsSync(path.join(h.root, 'b'))).toBe(false)
    expect(() => h.invoke('sync', { enabled: true })).toThrow('account_workspace_unavailable')

    h.allow(true)
    await h.invoke('sync', { enabled: true, profile: 'work' })
    expect(h.sets.get('b')).toHaveBeenCalledOnce()
    expect(fs.existsSync(path.join(h.root, 'b', 'preview-signins.json'))).toBe(true)
  })

  it('does not migrate or clear local records for a same-named remote profile', async () => {
    const h = harness()
    await h.invoke('sync', { enabled: true, profile: 'work' })
    const file = path.join(h.root, 'a', 'preview-signins.json')
    const before = fs.readFileSync(file, 'utf8')
    h.local(false)
    await h.invoke('profile-renamed', { oldProfile: 'work', newProfile: 'renamed', connectionId: 'remote' })
    await h.invoke('profile-deleted', { profile: 'work', connectionId: 'remote' })

    expect(fs.readFileSync(file, 'utf8')).toBe(before)
    expect(h.clears.get('a')).not.toHaveBeenCalled()
    expect(h.resolveRoute).toHaveBeenLastCalledWith(expect.anything(), 'work', 'remote', 'existing')
  })
})
