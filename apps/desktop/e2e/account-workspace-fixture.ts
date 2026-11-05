import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'

import { startPlatformServer } from '../../../tests-js/scripts/platform-account-fixture'

import type { Sandbox } from './fixtures'

export const ACCOUNT_FIXTURES = [
  { id: '17', email: 'alpha@example.test', displayName: 'Account Alpha', session: 'notebookalpha' },
  { id: '23', email: 'beta@example.test', displayName: 'Account Beta', session: 'notebookbeta' }
] as const

/** Auth requests still cross the real native HTTP client and IPC bridge. */
export async function startAccountWorkspacePlatform() {
  const base = await startPlatformServer()
  const logins: string[] = []

  const server = http.createServer((request, response) => {
    const route = `${request.method} ${request.url}`

    function reply(data: unknown, status = 200) {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ code: status === 200 ? 0 : 'INVALID_CREDENTIALS', message: status === 200 ? 'ok' : 'invalid credentials', data }))
    }

    if (route === 'POST /api/v1/auth/login') {
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { email?: string; password?: string }
        const account = ACCOUNT_FIXTURES.find(candidate => candidate.email === body.email)

        if (!account || body.password !== 'inert-fixture-password') { reply(null, 401);

 return }

        logins.push(account.id)
        reply({ access_token: `fixture-access-${account.id}`, refresh_token: `fixture-refresh-${account.id}`,
          expires_in: 3600, token_type: 'Bearer' })
      })

      return
    }

    if (route === 'GET /api/v1/user/profile') {
      const account = ACCOUNT_FIXTURES.find(candidate => request.headers.authorization === `Bearer fixture-access-${candidate.id}`)

      if (!account) { reply(null, 401);

 return }

      reply({ id: Number(account.id), username: account.displayName, email: account.email, phone_bound: true })

      return
    }

    base.handler(request, response)
  })

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()

    if (!address || typeof address === 'string') { throw new Error('Account workspace fixture failed to bind') }

    return {
      origin: `http://127.0.0.1:${address.port}`,
      logins,
      close: async () => {
        await new Promise<void>(resolve => server.close(() => resolve()))
        await base.close()
      }
    }
  } catch (error) {
    await base.close()
    throw error
  }
}

/** Real disk-backed session writes, in homes selected by the production resolver. */
export function seedWorkspaceSession(python: string, sandbox: Sandbox, home: string, session: string): void {
  const repo = path.resolve(import.meta.dirname, '../../..')
  fs.mkdirSync(home, { recursive: true })
  execFileSync(python, ['-c', `
import sys
from hermes_state import SessionDB
with SessionDB() as db:
    db.create_session(sys.argv[1], source="desktop", model="mock-model")
    db.set_session_title(sys.argv[1], "Private " + sys.argv[1])
    db.append_message(sys.argv[1], role="user", content="Notebook " + sys.argv[1])
    db.append_message(sys.argv[1], role="assistant", content="Saved " + sys.argv[1])
`, session], {
    cwd: repo,
    env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8', HOME: sandbox.root, USERPROFILE: sandbox.root,
      HERMES_HOME: home, PYTHONPATH: repo, HERMES_TEST_ISOLATION: '1' },
    encoding: 'utf8', timeout: 60_000
  })
}
