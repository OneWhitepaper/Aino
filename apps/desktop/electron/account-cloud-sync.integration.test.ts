import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { expect, test } from 'vitest'

import { createPlatformAuth } from '../shared/platform-auth'
import { createPlatformClient } from '../shared/platform-client'

import { createAccountCloudSync } from './account-cloud-sync'
import { createCloudSyncLocalAdapter } from './account-cloud-sync-local'
import { prepareAccountWorkspace } from './account-workspace'

const repo = path.resolve(import.meta.dirname, '../../..')
const python = process.env.HERMES_PYTHON || 'python3'

test('two real homes exchange media and continued history through private Python pipes with response-loss retry', async () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'aino-sync-native-')))
  const env = { PYTHONPATH: repo, HERMES_RUNTIME_DIR: path.join(root, 'runtime') }

  const run = (home: string, source: string) =>
    execFileSync(python, ['-P', '-c', source], {
      cwd: repo,
      env: { ...process.env, ...env, HERMES_HOME: home },
      encoding: 'utf8'
    }).trim()

  const workspace = (name: string) => ({
    key: name,
    home: path.join(root, name, 'home'),
    ui: path.join(root, name, 'ui'),
    userId: '17'
  })
  const a = workspace('a'),
    b = workspace('b')
  prepareAccountWorkspace(a)
  prepareAccountWorkspace(b)
  mkdirSync(path.join(a.home, 'images'))
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6V1sAAAAASUVORK5CYII=',
    'base64'
  )
  writeFileSync(path.join(a.home, 'images', 'image.png'), png)
  run(
    a.home,
    `import os\nfrom hermes_state import SessionDB\nfrom pathlib import Path\nh=Path(os.environ['HERMES_HOME'])\ndb=SessionDB(h/'state.db')\ndb.create_session('conversation','cli',model='test')\ndb.append_message('conversation','user','![image]('+str(h/'images'/'image.png')+')',message_uid='first')\ndb.append_message('conversation','assistant','First answer',message_uid='answer')\ndb.close()`
  )
  const records = new Map<string, any>(),
    receipts = new Map<string, any>(),
    blobs = new Map<string, Buffer>()
  let revision = 0,
    loseResponse = true

  const server = http.createServer(async (req, res) => {
    expect(req.headers.authorization).toBe('Bearer native-only')

    if (req.url === '/api/v1/user/profile') {
      res.end(
        JSON.stringify({ code: 0, message: 'ok', data: { id: 17, username: 'A', email: '', phone_bound: false } })
      )

      return
    }

    const blob = req.url?.match(/^\/api\/v1\/desktop\/sync\/blobs\/([a-f0-9]{64})$/)?.[1]

    if (blob) {
      if (req.method === 'PUT') {
        const chunks: Buffer[] = []

        for await (const chunk of req) {
          chunks.push(chunk)
        }
        blobs.set(blob, Buffer.concat(chunks))
        res.end('{}')
      } else {
        res.end(blobs.get(blob))
      }

      return
    }

    const chunks: Buffer[] = []

    for await (const chunk of req) {
      chunks.push(chunk)
    }
    const input = JSON.parse(Buffer.concat(chunks).toString())

    const results = input.operations.map((operation: any) => {
      if (!receipts.has(operation.operation_id)) {
        const previous = records.get(operation.key)
        const conflict = (previous?.revision ?? '0') !== operation.base_revision || previous?.deleted
        const record = conflict
          ? previous
          : {
              key: operation.key,
              revision: String(++revision),
              deleted: operation.deleted,
              payload: operation.payload,
              device_id: input.device_id
            }

        if (!conflict) {
          records.set(operation.key, record)
        }
        receipts.set(operation.operation_id, {
          operation_id: operation.operation_id,
          status: conflict ? 'conflict' : 'applied',
          record
        })
      }

      return receipts.get(operation.operation_id)
    })

    if (loseResponse) {
      loseResponse = false
      req.socket.destroy()

      return
    }

    res.end(
      JSON.stringify({
        code: 0,
        message: 'ok',
        data: {
          cursor: String(revision),
          has_more: false,
          results,
          changes: [...records.values()].filter(record => BigInt(record.revision) > BigInt(input.after))
        }
      })
    )
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const client = createPlatformClient({
    origin: `http://127.0.0.1:${(server.address() as any).port}`,
    allowInsecureLoopback: true
  })
  const auth = createPlatformAuth({
    client,
    now: () => 0,
    tokenStore: {
      load: async () => ({ accessToken: 'native-only', refreshToken: 'unused', expiresAt: 100_000 }),
      save: async () => 'session_only',
      clear: async () => {}
    }
  })
  await auth.initialize()
  const local = createCloudSyncLocalAdapter(
    async () => ({ command: python, env }),
    () => repo
  )
  const sync = createAccountCloudSync({ auth, local, deviceId: () => 'native-test-device' })

  try {
    sync.start(a)
    await sync.retry()
    expect(sync.snapshot().state).toBe('offline')
    await sync.stop()
    sync.start(a)
    await sync.retry()
    expect(sync.snapshot().state).toBe('synced')
    expect(receipts.size).toBe(1)
    expect(blobs.size).toBe(1)
    await sync.stop()
    sync.start(b)
    await sync.retry()
    expect(sync.snapshot().state).toBe('synced')
    const messages = JSON.parse(
      run(
        b.home,
        `import os,json\nfrom pathlib import Path\nfrom hermes_state import SessionDB\ndb=SessionDB(Path(os.environ['HERMES_HOME'])/'state.db')\nprint(json.dumps(db.get_messages('conversation')))\ndb.append_message('conversation','user','Continue',message_uid='continue')\ndb.append_message('conversation','assistant','Second answer',message_uid='second')\ndb.close()`
      )
    )
    expect(messages).toHaveLength(2)
    const imagePath = messages[0].content.match(/!\[image\]\((.*)\)/)[1]
    expect(readFileSync(imagePath)).toEqual(png)
    await sync.retry()
    await sync.stop()
    sync.start(a)
    await sync.retry()
    expect(sync.snapshot().state).toBe('synced')
    const final = JSON.parse(
      run(
        a.home,
        `import os,json\nfrom pathlib import Path\nfrom hermes_state import SessionDB\ndb=SessionDB(Path(os.environ['HERMES_HOME'])/'state.db')\nprint(json.dumps([m['message_uid'] for m in db.get_messages('conversation')]))\ndb.close()`
      )
    )
    expect(final).toEqual(['first', 'answer', 'continue', 'second'])
  } finally {
    await sync.stop()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
