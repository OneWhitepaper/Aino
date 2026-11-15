import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { expect, test } from 'vitest'

import { assertPreparationRecovery, runNativeRecovery, withUnavailableDescriptor } from '../../tests/install/e2e-assets/native-update-recovery.ts'

import { type ElectronApplication, type Page } from './e2e-driver-deps.ts'
import { signInPlatformFixture } from './platform-account-fixture.ts'

test('a deliberately unavailable feed is restored even when its native observation fails', async (): Promise<void> => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-feed-recovery-'))
  const descriptor = path.join(directory, 'update.appinstaller')
  const original = '<AppInstaller Version="1.2.3.4" />\n'
  fs.writeFileSync(descriptor, original)

  const server = http.createServer((_request, response) => {
    if (!fs.existsSync(descriptor)) { response.writeHead(404).end();

 return }

    response.end(fs.readFileSync(descriptor))
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()

  if (!address || typeof address === 'string') { throw new Error('Fixture did not bind') }
  const url = `http://127.0.0.1:${address.port}/update.appinstaller`

  try {
    await expect(withUnavailableDescriptor(descriptor, async () => {
      expect((await fetch(url)).status).toBe(404)
      throw new Error('observed native failure')
    })).rejects.toThrow('observed native failure')
    expect(await (await fetch(url)).text()).toBe(original)
    expect(fs.readdirSync(directory)).toEqual(['update.appinstaller'])
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('preparation recovery requires the same OLD process, the actual HTTP failure and another completed chat', (): void => {
  const proof = { beforePid: 1234, afterPid: 1234,
    error: 'App Installer descriptor download failed: HTTP 404', pendingRelaunch: false, chat: { status: 'passed', turnComplete: true } }

  expect(() => assertPreparationRecovery(proof)).not.toThrow()
  expect(() => assertPreparationRecovery({ ...proof, afterPid: 5678 })).toThrow('same OLD process')
  expect(() => assertPreparationRecovery({ ...proof, error: '' })).toThrow('HTTP 404')
  expect(() => assertPreparationRecovery({ ...proof, pendingRelaunch: true })).toThrow('pending relaunch')
  expect(() => assertPreparationRecovery({ ...proof, chat: { status: 'failed', turnComplete: false } })).toThrow('completed chat')
})

test('native recovery refuses a lost retained session before touching the sign-in form', async (): Promise<void> => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'native-recovery-auth-'))
  const mutations: string[] = []
  const login = { getByRole: (role: string) => ({
    isVisible: async () => role === 'textbox',
    fill: async () => { mutations.push('fill'); throw new Error('Unexpected credential entry') },
  }) } as unknown as Page
  const app = {} as ElectronApplication
  try {
    for (const scenario of ['preparation-failure', 'manual-old-reopen'] as const) {
      await expect(runNativeRecovery({ scenario, exe: process.execPath, root: out, home: out,
        'user-data': out, out, 'expect-commit': 'a'.repeat(40), 'mock-url': 'http://127.0.0.1:9',
        descriptor: path.join(out, 'update.appinstaller') }, async options => {
        await signInPlatformFixture(app, login, { allowExisting: true, requireExisting: options['require-existing-account'] })
      })).rejects.toThrow('Persisted platform session')
      const receipt = JSON.parse(fs.readFileSync(path.join(out, 'recovery.json'), 'utf8'))
      expect(receipt).toMatchObject({ status: 'failed', scenario })
    }
    expect(mutations).toEqual([])
  } finally { fs.rmSync(out, { recursive: true, force: true }) }
})
