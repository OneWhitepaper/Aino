import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { createPlatformAuth } from '../shared/platform-auth'
import { createPlatformClient } from '../shared/platform-client'

import { createPlatformTokenStore } from './platform-token-store'

const roots: string[] = []
const servers: http.Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(server => {
      server.closeAllConnections()

      return new Promise<void>(resolve => server.close(() => resolve()))
    })
  )

  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

async function fixture(corruption: 'ciphertext' | 'json') {
  let profileAvailable = false

  const server = http.createServer(async (req, res) => {
    let raw = ''

    for await (const chunk of req) {
      raw += chunk
    }

    const reply = (status: number, data: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ code: status === 200 ? 0 : 'INVALID_CREDENTIALS', message: 'fixture', data }))
    }

    if (req.url === '/api/v1/auth/login') {
      const body = JSON.parse(raw)

      return body.password === 'correct-fixture-password'
        ? reply(200, {
            access_token: 'verified-access',
            refresh_token: 'verified-refresh',
            token_type: 'Bearer',
            expires_in: 3600
          })
        : reply(401, null)
    }

    if (
      req.url === '/api/v1/user/profile' &&
      profileAvailable &&
      req.headers.authorization === 'Bearer verified-access'
    ) {
      return reply(200, { id: 17, username: 'Verified member', email: 'member@example.test' })
    }

    return reply(401, null)
  })

  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aino-auth-recovery-'))
  roots.push(root)
  const filePath = path.join(root, 'platform-tokens.json')

  const old =
    corruption === 'json'
      ? '{broken-store'
      : JSON.stringify({
          version: 1,
          accounts: { [origin]: { encoding: 'safeStorage', value: Buffer.from('old-ciphertext').toString('base64') } }
        })

  fs.writeFileSync(filePath, old, { mode: 0o600 })

  const store = createPlatformTokenStore({
    filePath,
    crypto: {
      isAvailable: () => true,
      backend: () => 'keychain',
      encrypt: value => Buffer.from(`sealed:${value}`),
      decrypt: value => {
        if (!value.toString().startsWith('sealed:')) {
          throw new Error('Old encryption key unavailable')
        }

        return value.toString().slice('sealed:'.length)
      }
    }
  })

  const createAuth = () =>
    createPlatformAuth({
      client: createPlatformClient({ origin, allowInsecureLoopback: true }),
      tokenStore: store,
      now: Date.now
    })

  return {
    filePath,
    origin,
    old,
    store,
    createAuth,
    allowProfile: () => {
      profileAvailable = true
    }
  }
}

it.each(['ciphertext', 'json'] as const)(
  'recovers %s storage only after verified sign-in, preserving its ciphertext backup',
  async corruption => {
    const f = await fixture(corruption)
    const auth = f.createAuth()
    await expect(auth.initialize()).resolves.toMatchObject({
      phase: 'signed_out',
      account: null,
      error: { code: 'secure_store_read_failed' }
    })

    for (const password of ['wrong-fixture-password', 'correct-fixture-password']) {
      await expect(
        auth.loginExisting({ email: 'member@example.test', password, remember: true })
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
      expect(fs.readFileSync(f.filePath, 'utf8')).toBe(f.old)
      expect(fs.existsSync(`${f.filePath}.recovery`)).toBe(false)
      expect(auth.snapshot().account).toBeNull()
    }

    f.allowProfile()
    await expect(
      auth.loginExisting({ email: 'member@example.test', password: 'correct-fixture-password', remember: true })
    ).resolves.toMatchObject({
      status: 'signed_in',
      snapshot: { phase: 'signed_in', account: { id: '17' }, remember_state: 'encrypted', error: null }
    })
    const backups = fs.readdirSync(`${f.filePath}.recovery`)
    expect(backups).toHaveLength(1)
    const backupPath = path.join(`${f.filePath}.recovery`, backups[0])
    expect(fs.readFileSync(backupPath, 'utf8')).toBe(f.old)
    expect(fs.readFileSync(f.filePath, 'utf8')).not.toContain('verified-access')

    if (process.platform !== 'win32') {
      expect(fs.statSync(backupPath).mode & 0o777).toBe(0o600)
    }

    await expect(f.store.load(f.origin)).resolves.toMatchObject({
      accessToken: 'verified-access',
      deviceAccount: { id: '17' }
    })
    await expect(f.createAuth().initialize()).resolves.toMatchObject({
      phase: 'signed_in',
      account: { id: '17' },
      error: null
    })
  }
)

it('does not overwrite unreadable credentials or claim sign-in when their backup cannot be written', async () => {
  const f = await fixture('ciphertext')
  const auth = f.createAuth()
  await auth.initialize()
  f.allowProfile()
  fs.writeFileSync(`${f.filePath}.recovery`, 'not-a-directory')

  await expect(
    auth.loginExisting({ email: 'member@example.test', password: 'correct-fixture-password', remember: true })
  ).rejects.toMatchObject({ code: 'secure_store_write_failed' })
  expect(auth.snapshot()).toMatchObject({ phase: 'signed_out', account: null })
  expect(fs.readFileSync(f.filePath, 'utf8')).toBe(f.old)
})
