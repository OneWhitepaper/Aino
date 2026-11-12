import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import { bundledUpgradeHealth } from './bundled-upgrade-probe.ts'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => '{"commit":"new"}') }))
const temporary: string[] = []
afterEach(() => {
  for (const folder of temporary.splice(0)) { fs.rmSync(folder, { recursive: true, force: true }) }
  vi.clearAllMocks()
})

function installation() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bundled-upgrade-probe-'))
  temporary.push(folder)
  const root = path.join(folder, 'agent-payload')
  const home = path.join(folder, 'account-workspaces', 'known-member', 'home')

  for (const relative of ['tools', 'repo', 'site']) { fs.mkdirSync(path.join(root, relative), { recursive: true }) }
  fs.mkdirSync(home, { recursive: true })
  fs.writeFileSync(path.join(root, 'tools/python'), '')
  const stamp = { payload: 'bundled', commit: 'new', runtime: { storePython: 'tools/python', repoDir: 'repo', sitePackages: 'site' } }
  fs.writeFileSync(path.join(folder, 'install-stamp.json'), JSON.stringify(stamp))

  return { folder, root, home, stamp, commit: 'new', connection: { mode: 'local', baseUrl: 'http://127.0.0.1:12345' },
    identity: { appVersion: '0.1.5', commit: 'new', hermesRoot: root, hermesHome: home, platform: 'darwin' } }
}

test('NEW health probe observes the authenticated account home and exact UI connection', () => {
  const fixture = installation()
  expect(bundledUpgradeHealth(fixture)).toEqual({ commit: 'new' })
  expect(execFileSync).toHaveBeenCalledWith(path.join(fixture.root, 'tools/python'), [
    '-B', expect.stringContaining('bundled-gateway-health.py'), fixture.home, 'new', 'http://127.0.0.1:12345'
  ], expect.objectContaining({ cwd: fixture.root, timeout: 110_000 }))
})

test('OLD installation home and remote UI connection cannot satisfy NEW account health', () => {
  const fixture = installation()
  expect(() => bundledUpgradeHealth({ ...fixture, identity: { ...fixture.identity, hermesHome: fixture.folder } })).toThrow('another account home')
  expect(() => bundledUpgradeHealth({ ...fixture, connection: { mode: 'remote', baseUrl: 'https://example.com' } })).toThrow('local gateway')
  fixture.stamp.commit = 'old'
  fs.writeFileSync(path.join(fixture.folder, 'install-stamp.json'), JSON.stringify(fixture.stamp))
  expect(() => bundledUpgradeHealth(fixture)).toThrow()
  expect(execFileSync).not.toHaveBeenCalled()
})
