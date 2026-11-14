import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { expect, it } from 'vitest'

import { accountWorkspace } from './account-workspace'
import { runLegacyHistoryHelper } from './legacy-history-helper'

const repo = path.resolve(import.meta.dirname, '../../..')

it('uses the real Python helper to snapshot and prepare only this account’s history without changing either database', async () => {
  const python = process.env.HERMES_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aino-history-helper-'))
  const sourceHome = path.join(temporary, 'legacy')
  const userData = path.join(temporary, 'desktop')
  const origin = 'https://api.aino.test'
  const userId = '10'
  const targetHome = accountWorkspace(userData, origin, userId).home
  const owner = { platform_origin: origin, user_id: userId }
  const input = { source_home: sourceHome, user_data: userData, target_home: targetHome, owner }
  const runtime = { command: python, cwd: repo }

  const digest = (home: string) =>
    createHash('sha256')
      .update(fs.readFileSync(path.join(home, 'state.db')))
      .digest('hex')

  try {
    execFileSync(
      python,
      [
        '-P',
        '-c',
        `
import json
import sys
from pathlib import Path
from hermes_state import SessionDB

request = json.load(sys.stdin)
owner = request['owner']
source = Path(request['source_home'])
target = Path(request['target_home'])
source.mkdir(parents=True, exist_ok=True)
target.mkdir(parents=True, exist_ok=True)
db = SessionDB(db_path=source / 'state.db')
assert db.import_sessions([
    {'id': 'mine', 'source': 'desktop', 'model_config': {'platform_owner': owner},
     'messages': [{'role': 'user', 'content': 'Archived turn', 'active': 0, 'compacted': 1},
                  {'role': 'assistant', 'content': 'My answer'}]},
    {'id': 'foreign', 'source': 'desktop', 'model_config': {'platform_owner': {**owner, 'user_id': '11'}},
     'messages': [{'role': 'user', 'content': 'Someone else’s conversation'}]},
    {'id': 'unknown', 'source': 'desktop', 'messages': [{'role': 'user', 'content': 'No owner stamp'}]},
])['ok']
db.close()
db = SessionDB(db_path=target / 'state.db')
assert db.import_sessions([{'id': 'new', 'source': 'desktop',
    'messages': [{'role': 'user', 'content': 'Keep my new conversation'}]}])['ok']
db.close()
`
      ],
      {
        cwd: repo,
        env: { ...process.env, HERMES_HOME: targetHome, PYTHONPATH: repo },
        input: JSON.stringify(input),
        stdio: ['pipe', 'pipe', 'pipe']
      }
    )
    const originalSource = digest(sourceHome)
    const originalTarget = digest(targetHome)
    const inspection = await runLegacyHistoryHelper(runtime, { ...input, action: 'inspect' })

    expect(inspection).toMatchObject({ owned: 1, unowned: 1, foreign: 1, conflicts: 0 })
    expect(inspection.planId).toMatch(/^[a-f0-9]{32}$/)

    const prepared = await runLegacyHistoryHelper(runtime, {
      ...input,
      action: 'prepare',
      plan_id: inspection.planId,
      confirm_unowned: false
    })

    const sessions = prepared.groups.flatMap((group: { batches: Array<Array<Record<string, unknown>>> }) =>
      group.batches.flat()
    )

    expect(sessions.map((session: Record<string, unknown>) => session.id)).toEqual(['mine'])
    expect(sessions[0]).not.toHaveProperty('session')
    expect(sessions[0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: 'Archived turn', active: 0, compacted: 1 }),
        expect.objectContaining({ content: 'My answer' })
      ])
    )

    const backup = await runLegacyHistoryHelper(runtime, {
      ...input,
      action: 'backup',
      plan_id: inspection.planId,
      profile: 'default'
    })

    expect(fs.statSync(backup.backupPath).isFile()).toBe(true)

    const later = await runLegacyHistoryHelper(runtime, {
      ...input,
      action: 'remind',
      plan_id: inspection.planId,
      choice: 'later'
    })

    expect(later).toMatchObject({ ok: true, reminderKey: inspection.reminderKey, showReminder: false })
    expect(later.snoozedUntil).toBeGreaterThan(Date.now())
    const snoozed = await runLegacyHistoryHelper(runtime, { ...input, action: 'inspect' })
    expect(snoozed).toMatchObject({ owned: 1, unowned: 1, showReminder: false, reminderKey: inspection.reminderKey })

    const ignored = await runLegacyHistoryHelper(runtime, {
      ...input,
      action: 'remind',
      plan_id: snoozed.planId,
      choice: 'ignore'
    })

    expect(ignored).toMatchObject({ ok: true, showReminder: false, snoozedUntil: null })
    expect(await runLegacyHistoryHelper(runtime, { ...input, action: 'inspect' })).toMatchObject({
      owned: 0,
      unowned: 0,
      showReminder: false
    })
    expect(
      await runLegacyHistoryHelper(runtime, {
        ...input,
        action: 'prepare',
        plan_id: snoozed.planId,
        confirm_unowned: true
      })
    ).toMatchObject({ groups: [] })
    expect(digest(sourceHome)).toBe(originalSource)
    expect(digest(targetHome)).toBe(originalTarget)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}, 120_000)
