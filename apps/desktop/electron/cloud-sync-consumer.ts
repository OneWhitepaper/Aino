/** Local integration driver. Fixture credentials arrive only through private stdin. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { createPlatformAuth } from '../shared/platform-auth'
import { createPlatformClient } from '../shared/platform-client'

import { createAccountCloudSync } from './account-cloud-sync'
import { createCloudSyncLocalAdapter } from './account-cloud-sync-local'
import type { AccountWorkspace } from './account-workspace'
import { prepareAccountWorkspace } from './account-workspace'
import { recoverLargeConflicts } from './cloud-sync-recovery-consumer'

interface Fixture {
  origin: string
  user_id: string
  token: string
  other_user_id: string
  other_token: string
}

export async function runCloudSyncConsumer(fixture: Fixture, repo: string, python: string) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'aino-sync-consumer-')))
  const env = { PYTHONPATH: repo, HERMES_RUNTIME_DIR: path.join(root, 'runtime') }
  const home = (name: string, userId = fixture.user_id) => ({
    key: name,
    home: path.join(root, name, 'home'),
    ui: path.join(root, name, 'ui'),
    userId
  })
  const a = home('a'),
    b = home('b'),
    other = home('other', fixture.other_user_id)

  for (const workspace of [a, b, other]) {
    prepareAccountWorkspace(workspace)
  }

  const run = (workspace: AccountWorkspace, script: string) =>
    execFileSync(
      python,
      [
        '-P',
        '-c',
        `import os,json\nfrom pathlib import Path\nfrom hermes_state import SessionDB\nh=Path(os.environ['HERMES_HOME'])\ndb=SessionDB(h/'state.db')\n${script}\ndb.close()`
      ],
      { cwd: repo, env: { ...process.env, ...env, HERMES_HOME: workspace.home }, encoding: 'utf8' }
    ).trim()

  let offline = false,
    loseResponse = true
  const recoveryFault = { dropRebatch: false, dropped: 0 }

  const proxy = http.createServer(async (req, res) => {
    if (offline) {
      req.socket.destroy()

      return
    }

    try {
      const chunks: Buffer[] = []

      for await (const chunk of req) {
        chunks.push(chunk)
      }

      const upstream = await fetch(new URL(req.url!, fixture.origin), {
        method: req.method,
        headers: {
          authorization: String(req.headers.authorization || ''),
          'content-type': String(req.headers['content-type'] || 'application/json')
        },
        body: req.method === 'GET' ? undefined : Buffer.concat(chunks),
        redirect: 'manual'
      })

      const body = Buffer.from(await upstream.arrayBuffer())

      if (loseResponse && req.url?.endsWith('/sync/exchange') && upstream.ok) {
        loseResponse = false
        req.socket.destroy()

        return
      }

      if (recoveryFault.dropRebatch && body.includes('DESKTOP_SYNC_REBATCH')) {
        recoveryFault.dropRebatch = false
        recoveryFault.dropped++
        req.socket.destroy()

        return
      }

      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/octet-stream'
      })
      res.end(body)
    } catch {
      res.writeHead(502)
      res.end()
    }
  })

  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
  const client = createPlatformClient({
    origin: `http://127.0.0.1:${(proxy.address() as any).port}`,
    allowInsecureLoopback: true
  })

  const authentication = async (token: string) => {
    const auth = createPlatformAuth({
      client,
      now: () => 0,
      tokenStore: {
        load: async () => ({ accessToken: token, refreshToken: 'unused-fixture', expiresAt: 100_000 }),
        save: async () => 'session_only',
        clear: async () => {}
      }
    })
    await auth.initialize()

    return auth
  }

  const coordinators: Array<ReturnType<typeof createAccountCloudSync>> = []

  try {
    const auth = await authentication(fixture.token)

    if (auth.snapshot().account?.id !== fixture.user_id) {
      throw new Error('fixture_identity_mismatch')
    }
    const local = createCloudSyncLocalAdapter(
      async () => ({ command: python, env }),
      () => repo
    )
    const sync = createAccountCloudSync({ auth, local, deviceId: () => 'native-consumer-fixture' })
    coordinators.push(sync)

    const requireState = (expected = 'synced') => {
      if (sync.snapshot().state !== expected) {
        throw new Error(`sync_${sync.snapshot().state}_${sync.snapshot().error}`)
      }
    }

    const settle = async (workspace: AccountWorkspace) => {
      sync.start(workspace)

      for (let attempt = 0; attempt < 8; attempt++) {
        await sync.retry()

        if (sync.snapshot().state !== 'pending') {
          break
        }
      }

      requireState()
      await sync.stop()
    }

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6V1sAAAAASUVORK5CYII=',
      'base64'
    )
    mkdirSync(path.join(a.home, 'images'))
    writeFileSync(path.join(a.home, 'images', 'image.png'), png)
    run(
      a,
      "db.create_session('conversation','cli',model='fixture')\ndb.append_message('conversation','user','![image]('+str(h/'images'/'image.png')+')',message_uid='first')"
    )
    sync.start(a)
    await sync.retry()
    requireState('offline')
    await sync.stop()
    await settle(a)
    await settle(b)
    const first = JSON.parse(run(b, "print(json.dumps(db.get_messages('conversation')))"))
    const imagePath = first[0].content.match(/!\[image\]\((.*)\)/)[1]

    if (!imagePath.endsWith('.png') || !readFileSync(imagePath).equals(png)) {
      throw new Error('restored_media_mismatch')
    }
    offline = true
    run(b, "db.append_message('conversation','assistant','Offline continuation',message_uid='continued')")
    sync.start(b)
    await sync.retry()
    requireState('offline')
    await sync.stop()
    offline = false
    await settle(b)
    await settle(a)
    const continued = JSON.parse(
      run(a, "print(json.dumps([m['message_uid'] for m in db.get_messages('conversation')]))")
    )

    if (continued.join(',') !== 'first,continued') {
      throw new Error('continued_history_mismatch')
    }
    run(a, "db.append_message('conversation','user','A edit',message_uid='a-edit')")
    run(b, "db.append_message('conversation','user','B edit',message_uid='b-edit')")
    await settle(a)
    await settle(b)
    const conflictCount = Number(
      run(
        b,
        'print(db._conn.execute("SELECT COUNT(*) FROM sessions WHERE title LIKE \'%sync conflict%\'").fetchone()[0])'
      )
    )

    if (conflictCount < 1) {
      throw new Error('conflict_not_preserved')
    }
    const recoveredOperations = await recoverLargeConflicts({ a, b, auth, local, run, settle, fault: recoveryFault })
    const otherAuth = await authentication(fixture.other_token)

    if (otherAuth.snapshot().account?.id !== fixture.other_user_id) {
      throw new Error('other_fixture_identity_mismatch')
    }
    const otherSync = createAccountCloudSync({ auth: otherAuth, local, deviceId: () => 'other-consumer-fixture' })
    coordinators.push(otherSync)
    otherSync.start(other)
    await otherSync.retry()
    await otherSync.stop()

    if (Number(run(other, 'print(db.session_count())')) !== 0) {
      throw new Error('cross_account_history_leak')
    }

    return {
      recovered_operations: recoveredOperations,
      continued_messages: continued.length,
      conflict_copies: conflictCount,
      attachment_bytes: png.length,
      account_isolation: true
    }
  } finally {
    await Promise.all(coordinators.map(coordinator => coordinator.stop()))
    proxy.closeAllConnections()
    await new Promise<void>(resolve => proxy.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  }
}

if (!process.env.VITEST) {
  const fixture = JSON.parse(readFileSync(0, 'utf8')) as Fixture
  runCloudSyncConsumer(
    fixture,
    process.env.AINO_SYNC_DESKTOP_ROOT || process.cwd(),
    process.env.AINO_SYNC_PYTHON || process.env.HERMES_PYTHON || 'python3'
  )
    .then(result => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch(error => {
      process.stderr.write(String(error.message) + '\n')
      process.exitCode = 1
    })
}
