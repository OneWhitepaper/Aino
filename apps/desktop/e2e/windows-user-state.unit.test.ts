import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, beforeEach, expect, test } from 'vitest'

const helper = path.resolve(import.meta.dirname, '../../../tests/install/e2e-assets/windows-user-state.mjs')
const python = process.env.HERMES_PYTHON || process.env.HERMES_DESKTOP_PYTHON

interface Fixture {
  files: string[]
  accounts: { userId: string; displayName: string; origin: string; model: string; baseUrl: string; home: string; profile: string; sessionIds: string[] }[]
}

let scratch: string
let root: string
let snapshot: string
let report: string

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aino-windows-preservation-'))
  root = path.join(scratch, '用户资料')
  snapshot = path.join(scratch, 'before.json')
  report = path.join(scratch, 'result.json')
})

afterEach(() => fs.rmSync(scratch, { recursive: true, force: true }))

function run(command: string, args: string[] = []) {
  return spawnSync(process.execPath, [helper, command, '--root', root, '--python', python!, ...args], { encoding: 'utf8' })
}

function seed(args: string[] = []): Fixture {
  expect(python, 'Hermes test Python is required to seed real SessionDB history').toBeTruthy()
  const seeded = run('seed', ['--snapshot', snapshot, ...args])
  expect(seeded.status, seeded.stderr).toBe(0)

  return JSON.parse(seeded.stdout) as Fixture
}

test('seeds isolated account histories, Bot identity, model settings and UTF-8 user files', () => {
  const fixture = seed()
  expect(new Set(fixture.accounts.map(account => account.home)).size).toBeGreaterThan(1)

  for (const account of fixture.accounts) {
    const home = path.join(root, account.home)
    expect(account.home).toMatch(/^account-workspaces\/[a-f0-9]{64}\/home$/)
    expect(account.displayName).toMatch(/[\u4e00-\u9fff]/)
    const bot = path.join(home, 'profiles', account.profile)
    expect(fs.readFileSync(path.join(bot, 'profile.yaml'), 'utf8')).toContain('hermes-bots')
    expect(fs.readFileSync(path.join(home, 'config.yaml'), 'utf8')).toContain('model:')
    expect(fs.readFileSync(path.join(home, '.env'), 'utf8')).toContain('inert-fixture-')
    expect(JSON.parse(fs.readFileSync(path.join(home, 'ui-preferences.json'), 'utf8')).values).toHaveProperty('hermes-desktop-theme-v2')
    expect(fs.readFileSync(path.join(home, '资料', '升级保留.txt'), 'utf8')).toContain(account.displayName)

    for (const directory of [home, bot]) {
      const rows = JSON.parse(execFileSync(python!, ['-c', `
import json, sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    print(json.dumps({
        "sessions": db.execute("SELECT id, user_id, title, model FROM sessions").fetchall(),
        "messages": db.execute("SELECT role, content FROM messages ORDER BY id").fetchall()
    }, ensure_ascii=False))
`, path.join(directory, 'state.db')], { encoding: 'utf8' }))

      expect(rows.sessions.some((row: string[]) => account.sessionIds.includes(row[0]) && row[1] === `platform:${account.userId}`)).toBe(true)
      expect(rows.messages.map((row: string[]) => row[0])).toEqual(['user', 'assistant'])
      expect(rows.messages.flat().join(' ')).toContain(account.displayName)
    }
  }
})

test('snapshots static fixture bytes and seeded historical rows without capturing runtime files', () => {
  const fixture = seed()
  fs.writeFileSync(path.join(root, 'unrelated-runtime.log'), 'runtime output is not user fixture data')
  const captured = run('snapshot', ['--snapshot', snapshot])
  expect(captured.status, captured.stderr).toBe(0)
  const manifest = JSON.parse(fs.readFileSync(snapshot, 'utf8'))
  expect(manifest.files.map((file: { path: string }) => file.path).sort()).toEqual(fixture.files.sort())

  for (const file of manifest.files) {
    if (file.kind === 'session-db') {
      expect(file.sessions.length).toBeGreaterThan(0)
      expect(file.messages.map((message: { role: string }) => message.role)).toEqual(['user', 'assistant'])

      continue
    }

    expect(file.path).not.toMatch(/\/state.db$/)
    const bytes = fs.readFileSync(path.join(root, file.path))

    expect(file.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(file.size).toBe(bytes.length)
  }

  const verified = run('verify', ['--snapshot', snapshot, '--report', report])
  expect(verified.status, verified.stderr).toBe(0)
  expect(JSON.parse(fs.readFileSync(report, 'utf8'))).toMatchObject({ ok: true, checked: fixture.files.length, missing: [], changed: [], unsafe: [] })
  expect(fs.readFileSync(report, 'utf8')).not.toContain('inert-fixture-')
})

test('keeps seeded history valid after more messages, new sessions and a SQLite checkpoint', () => {
  const fixture = seed()
  const account = fixture.accounts[0]
  const database = path.join(root, account.home, 'state.db')
  execFileSync(python!, ['-c', `
import sqlite3, sys
from pathlib import Path
sys.path.insert(0, sys.argv[2])
from hermes_state import SessionDB
with SessionDB(db_path=Path(sys.argv[1])) as db:
    db.append_message(sys.argv[3], role="user", content="A new question after the update")
    db.create_session("new-session-after-update", source="desktop", model="new-model")
    db.append_message("new-session-after-update", role="user", content="New conversation")
with sqlite3.connect(sys.argv[1]) as db:
    db.execute("UPDATE sessions SET model_config=? WHERE id=?", ('{"base_url":"https://fixture.invalid/v1","provider":"custom"}', sys.argv[3]))
    db.commit()
    db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    db.execute("VACUUM")
`, database, path.resolve(import.meta.dirname, '../../..'), account.sessionIds[0]], {
    encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      HOME: scratch, USERPROFILE: scratch, HERMES_HOME: path.join(scratch, 'isolated-home'),
      HERMES_RUNTIME_DIR: path.join(scratch, 'isolated-runtime'), PYTHONUTF8: '1' }
  })

  const verified = run('verify', ['--snapshot', snapshot, '--report', report])
  expect(verified.status, verified.stderr).toBe(0)
  expect(JSON.parse(fs.readFileSync(report, 'utf8'))).toMatchObject({ ok: true, changed: [], missing: [] })
  const captured = run('snapshot', ['--snapshot', snapshot])
  expect(captured.status, captured.stderr).toBe(0)
  const history = JSON.parse(fs.readFileSync(snapshot, 'utf8')).files.find((file: { path: string }) => file.path === `${account.home}/state.db`)
  expect(history.sessions.map((session: { id: string }) => session.id)).toEqual([account.sessionIds[0]])
  expect(history.messages.map((message: { role: string }) => message.role)).toEqual(['user', 'assistant'])
})

test.each([
  'UPDATE messages SET content="lost original content" WHERE id=1',
  'UPDATE messages SET role="system" WHERE id=1',
  'DELETE FROM messages WHERE id=1',
  'DELETE FROM sessions',
  'UPDATE sessions SET model="wrong-model"',
  'UPDATE sessions SET user_id="wrong-account"',
  'UPDATE sessions SET profile_name="wrong-profile"',
])('rejects lost or rewritten seeded history: %s', statement => {
  const fixture = seed()
  const database = `${fixture.accounts[0].home}/state.db`
  execFileSync(python!, ['-c', 'import sqlite3, sys\nwith sqlite3.connect(sys.argv[1]) as db: db.execute(sys.argv[2])',
    path.join(root, database), statement], { encoding: 'utf8' })

  const verified = run('verify', ['--snapshot', snapshot, '--report', report])
  expect(verified.status).toBe(1)
  expect(JSON.parse(fs.readFileSync(report, 'utf8'))).toMatchObject({ ok: false, changed: [database], missing: [] })
})

test('seeds an explicit authenticated account and live mock endpoint without sharing workspaces', async () => {
  const fixture = seed(['--origin', 'https://api.agentera.com.cn', '--primary-user-id', '91', '--secondary-user-id', '92', '--mock-url', 'http://127.0.0.1:19001'])
  expect(fixture.accounts.map(account => account.userId)).toEqual(['91', '92'])
  const fixtureModule = await import(pathToFileURL(helper).href)
  expect(fixtureModule.fixtureAccountForHome).toBeTypeOf('function')

  for (const account of fixture.accounts) {
    expect(account.origin).toBe('https://api.agentera.com.cn')
    const scope = createHash('sha256').update(JSON.stringify(['https://api.agentera.com.cn', account.userId])).digest('hex')

    expect(account.home).toBe(`account-workspaces/${scope}/home`)
    expect(account.model).toBeTruthy()
    expect(account.baseUrl).toBe('http://127.0.0.1:19001/v1')
    const home = path.join(root, account.home)

    expect(fs.readFileSync(path.join(home, 'config.yaml'), 'utf8')).toContain('base_url: http://127.0.0.1:19001/v1')
    expect(JSON.parse(fs.readFileSync(path.join(home, '..', 'desktop', 'active-profile.json'), 'utf8'))).toEqual({ profile: 'default' })
    expect(fixtureModule.fixtureAccountForHome({ root, home })).toMatchObject({
      home, relativeHome: account.home, userId: account.userId, model: account.model, baseUrl: account.baseUrl, sessionIds: account.sessionIds
    })
  }

  expect(fixtureModule.fixtureAccountForHome({ root, home: path.join(root, 'account-workspaces', 'signed-out', 'home') })).toBeNull()
  expect(fixtureModule.fixtureAccountForHome({ root, home: scratch })).toBeNull()
})

test('fails verification and records files deleted or corrupted by an installer', () => {
  const fixture = seed()
  const home = fixture.accounts[0].home
  const missing = `${home}/.env`
  const changed = `${home}/state.db`
  fs.unlinkSync(path.join(root, missing))
  fs.writeFileSync(path.join(root, changed), 'corrupted historical data')

  const verified = run('verify', ['--snapshot', snapshot, '--report', report])
  expect(verified.status).toBe(1)
  expect(JSON.parse(fs.readFileSync(report, 'utf8'))).toMatchObject({ ok: false, missing: [missing], changed: [changed], unsafe: [] })
})

test('rejects a profile junction that redirects fixture reads outside the disposable root', () => {
  const fixture = seed()
  const account = fixture.accounts[0]
  const profile = path.join(root, account.home, 'profiles', account.profile)
  const escaped = path.join(scratch, 'outside-profile')
  fs.renameSync(profile, escaped)
  fs.symlinkSync(escaped, profile, 'junction')

  const verified = run('verify', ['--snapshot', snapshot, '--report', report])
  expect(verified.status).toBe(1)
  const result = JSON.parse(fs.readFileSync(report, 'utf8'))
  expect(result.ok).toBe(false)
  expect(result.unsafe.length).toBeGreaterThan(0)
  expect(result.unsafe.every((file: string) => file.startsWith(`${account.home}/profiles/${account.profile}/`))).toBe(true)
  const captured = run('snapshot', ['--snapshot', path.join(scratch, 'escaped.json')])
  expect(captured.status).toBe(1)
  expect(captured.stderr).toMatch(/symlink|junction/i)
  expect(fs.existsSync(path.join(scratch, 'escaped.json'))).toBe(false)
})

test('rejects SQLite sidecar junctions before opening the historical database', () => {
  const fixture = seed()
  const database = `${fixture.accounts[0].home}/state.db`
  const escaped = path.join(scratch, 'outside-sidecar')
  fs.mkdirSync(escaped)
  fs.rmSync(path.join(root, `${database}-wal`), { force: true })
  fs.symlinkSync(escaped, path.join(root, `${database}-wal`), 'junction')

  const verified = run('verify', ['--snapshot', snapshot, '--report', report])
  expect(verified.status).toBe(1)
  expect(JSON.parse(fs.readFileSync(report, 'utf8'))).toMatchObject({ ok: false, unsafe: [database] })
})

test('refuses to seed existing user state or write evidence inside its fixture', () => {
  fs.mkdirSync(root)
  const existing = path.join(root, 'existing-account.txt')
  fs.writeFileSync(existing, 'leave existing data alone')
  const refused = run('seed')
  expect(refused.status).toBe(1)
  expect(refused.stderr).toMatch(/empty|disposable/i)
  expect(fs.readFileSync(existing, 'utf8')).toBe('leave existing data alone')

  fs.unlinkSync(existing)
  seed()
  const overwritten = run('snapshot', ['--snapshot', path.join(root, 'evidence.json')])
  expect(overwritten.status).toBe(1)
  expect(fs.existsSync(path.join(root, 'evidence.json'))).toBe(false)
})
