import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { expect, test } from 'vitest'

import { seedUserState, snapshotUserState, verifyUserState } from '../tests/install/e2e-assets/windows-user-state.mjs'

test('the pre-MSIX snapshot protects actual ZIP-written rows alongside seeded history', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'released-zip-history-'))
  const root = path.join(directory, 'user-data')
  const python = execFileSync(process.env.HERMES_PYTHON || 'python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', timeout: 15_000 }).trim()
  const snapshotPath = path.join(directory, 'before.json')
  const historyPath = path.join(directory, 'released-zip-opened.json')
  try {
    const fixture = seedUserState({ root, python })
    const account = fixture.accounts[0]
    const home = path.join(root, account.home)
    const script = `import json,sys
from pathlib import Path
from hermes_state import SessionDB
with SessionDB(db_path=Path(sys.argv[1])) as db:
    db.create_session('real-zip-session', source='desktop', model='zip-model')
    first=db.append_message('real-zip-session', role='user', content='actual ZIP prompt')
    second=db.append_message('real-zip-session', role='assistant', content='actual ZIP reply')
print(json.dumps([first,second]))`
    const ids = JSON.parse(execFileSync(python, ['-c', script, path.join(home, 'state.db')], {
      cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8', timeout: 15_000, env: { ...process.env, HERMES_HOME: home },
    }))
    fs.writeFileSync(historyPath, JSON.stringify({ purpose: 'aino-released-zip-history', status: 'passed',
      legacyCommit: '22a472fcbca8775f56c0f89374027b8e4c68ab5b', userData: fs.realpathSync(root), hermesHome: fs.realpathSync(home),
      storedChat: { profile: 'default', sessionId: 'real-zip-session', messages: [
        { id: ids[0], role: 'user', content: 'actual ZIP prompt' }, { id: ids[1], role: 'assistant', content: 'actual ZIP reply' }] } }))
    const snapshot = snapshotUserState({ root, python, snapshotPath, historyPath })
    expect(snapshot.files.find(file => file.path === `${account.home}/state.db`).sessions.map(row => row.id)).toContain('real-zip-session')
    expect(verifyUserState({ root, python, snapshotPath }).ok).toBe(true)
    execFileSync(python, ['-c', 'import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute("UPDATE messages SET content=? WHERE id=?",("changed after install",int(sys.argv[2]))); db.commit()',
      path.join(home, 'state.db'), String(ids[1])], { timeout: 15_000 })
    expect(verifyUserState({ root, python, snapshotPath })).toMatchObject({ ok: false, changed: [`${account.home}/state.db`] })
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
}, 60_000)
