import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { expect, test, vi } from 'vitest'

import { prepareAccountFixture, smokeEnvironment } from '../../tests/install/e2e-assets/desktop-smoke.ts'

test('retained account acceptance rejects fresh authentication while preserving request diagnostics', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'native-account-proof-'))
  const env = smokeEnvironment(process.env, path.join(out, 'home'), path.join(out, 'user-data'))
  const account = await prepareAccountFixture(true, out, env, { requireExisting: true })

  const request = (route: string, method = 'GET') => promisify(execFile)(process.execPath, ['--input-type=module', '-e',
    `const response = await fetch('https://api.agentera.com.cn/api/v1/${route}', {
      method: '${method}', headers: { Authorization: 'Bearer native-access-token' }
    }); await response.text();`], { env })

  try {
    expect(() => account!.assertPreserved()).toThrow('Retained account')
    await request('user/profile')
    expect(() => account!.assertPreserved()).not.toThrow()
    expect(account!.proof()).toMatchObject({ authenticatedProfileRequests: 1,
      freshAuthenticationRequests: 0, authenticationPreservedWithoutLogin: true })
    await request('auth/phone/send-code', 'POST')
    expect(() => account!.assertPreserved()).toThrow('Retained account')
    expect(account!.proof()).toMatchObject({ authenticatedProfileRequests: 1,
      freshAuthenticationRequests: 1, authenticationPreservedWithoutLogin: false })
  } finally {
    await account?.close()
    fs.rmSync(out, { recursive: true, force: true })
  }
})

test('automatic NEW authentication cannot reuse OLD requests and rejects a new login in its own phase', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'native-new-account-proof-'))
  const env = smokeEnvironment(process.env, path.join(out, 'home'), path.join(out, 'user-data'))
  const account = await prepareAccountFixture(true, out, env, { requireExisting: true })

  const request = (route: string, method = 'GET') => promisify(execFile)(process.execPath, ['--input-type=module', '-e',
    `await (await fetch('https://api.agentera.com.cn/api/v1/${route}', {
      method: '${method}', headers: { Authorization: 'Bearer native-access-token' }
    })).text();`], { env })

  const clock = vi.spyOn(Date, 'now')

  try {
    clock.mockReturnValue(1000)
    await request('user/profile')
    const phase = { phase: 'automatic-new', startedAt: 2000, observedAt: 4000 }
    expect(account!.proof(phase)).toMatchObject({ authenticatedProfileRequests: 0, authenticationPreservedWithoutLogin: false })
    clock.mockReturnValue(3000)
    await request('user/profile')
    expect(account!.proof(phase)).toMatchObject({ phase: 'automatic-new', authenticatedProfileRequests: 1,
      freshAuthenticationRequests: 0, authenticationPreservedWithoutLogin: true })
    await request('auth/phone/send-code', 'POST')
    expect(account!.proof(phase)).toMatchObject({ authenticatedProfileRequests: 1,
      freshAuthenticationRequests: 1, authenticationPreservedWithoutLogin: false })
  } finally {
    clock.mockRestore()
    await account?.close()
    fs.rmSync(out, { recursive: true, force: true })
  }
})
