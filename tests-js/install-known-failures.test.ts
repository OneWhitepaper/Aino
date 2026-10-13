import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const { matchKnownFailure, rules } = createRequire(import.meta.url)('../tests/install/e2e-assets/known-failures.cjs')
const classifier = path.resolve(import.meta.dirname, '../tests/install/e2e-assets/known-failures.cjs')

const lockedLog = [
  'error: failed to remove file `C:/install/venv/Lib/site-packages/../../Scripts/hermes.exe`: Access is denied. (os error 5)',
  "⚠ Git update failed: Command '['uv', 'pip', 'install', '-e', '.', '--quiet']' returned non-zero exit status 2.",
].join('\n')

const base = {
  platform: 'windows', phase: 'update', commit: 'a370ab8391ca5f8de7ebbc449f05cb0df36ade7c',
  installMethod: 'installer-script', updateMethod: 'hermes-update',
  error: 'E2E ASSERTION FAILED: hermes update exited 1 (expected 0)', logs: { update: lockedLog },
}

describe('known install failures', () => {
  it('requires the exact released Windows handoff and completed checkout before runtime recovery', () => {
    const sample = {
      platform: 'windows', phase: 'update', commit: '5fc308a70719a83cccdbba4c0e39c23f5a8239d5',
      checkout: 'f'.repeat(40), target: 'f'.repeat(40),
      installMethod: 'installer-script+desktop', updateMethod: 'open-app-update',
      error: 'E2E ASSERTION FAILED: updater result ok=true',
      logs: { handoff: [
        "gateway auto-restart failed: cannot import name 'base_url_origin' from 'utils'",
        'SQLite runtime repair deferred: the updater itself runs from the live venv it must replace',
        'SQLite 3.45.1 still has the WAL-reset corruption bug.',
        'retry exit code: 1',
      ].join('\n') },
    }

    expect(matchKnownFailure(sample)?.id).toBe('windows-august-runtime-handoff')

    for (const change of [
      { platform: 'linux' }, { commit: 'e'.repeat(40) }, { checkout: 'e'.repeat(40) },
      { target: '' }, { updateMethod: 'hermes-update' }, { installMethod: 'desktop-installer@latest' },
      { error: 'onboarding timed out' },
      { logs: { handoff: sample.logs.handoff.replace('retry exit code: 1', 'retry exit code: 0') } },
      { logs: { handoff: sample.logs.handoff.replace('the updater itself runs from the live venv it must replace', 'another process holds the venv') } },
    ]) {
      expect(matchKnownFailure({ ...sample, ...change })).toBeNull()
    }
  })

  it('allows fresh-process recovery only for the exact released cache failure after the target checkout lands', () => {
    const sample = {
      platform: 'linux', phase: 'update', commit: '5fc308a70719a83cccdbba4c0e39c23f5a8239d5',
      checkout: 'f'.repeat(40), target: 'f'.repeat(40),
      installMethod: 'installer-script', updateMethod: 'hermes-update',
      error: 'hermes update exited 1',
      logs: { update: "Update complete! (v0.20.6 -> v0.21.3)\ngateway auto-restart failed: cannot import name 'base_url_origin' from 'utils'" },
    }

    expect(matchKnownFailure(sample)?.id).toBe('august-cli-stale-utils')

    for (const change of [
      { platform: 'windows' }, { commit: 'e'.repeat(40) }, { checkout: 'e'.repeat(40) },
      { target: '' }, { updateMethod: 'hermes-desktop-app-update' }, { error: 'hermes update exited 0' },
      { logs: { update: "gateway auto-restart failed: cannot import name 'base_url_origin' from 'utils'" } },
      { logs: { update: 'Update complete! (v0.20.6 -> v0.21.3)\ngateway auto-restart failed: service unavailable' } },
    ]) {
      expect(matchKnownFailure({ ...sample, ...change })).toBeNull()
    }
  })

  it('recognizes the released launcher self-lock, not generic access denied', () => {
    expect(matchKnownFailure(base)?.id).toBe('windows-launcher-self-lock')
    expect(matchKnownFailure({ ...base, logs: { update: lockedLog.replaceAll('hermes.exe', 'other.exe') } })).toBeNull()
    expect(matchKnownFailure({ ...base, logs: { update: lockedLog.replace('(os error 5)', '(os error 32)') } })).toBeNull()
  })

  it.each([
    { platform: 'linux' }, { phase: 'install' }, { commit: 'v2026.3.12' },
    { commit: 'f'.repeat(40) }, { installMethod: 'desktop-installer@latest' },
    { updateMethod: 'installer-script' }, { error: 'E2E ASSERTION FAILED: update marker cleaned up' },
    { logs: {} },
  ])('rejects a different case or missing evidence: %j', change => {
    expect(matchKnownFailure({ ...base, ...change })).toBeNull()
  })

  it('matches manual-only app updates only for the three proven July script cases', () => {
    const sample = {
      ...base, commit: '7c1a029553d87c43ecff8a3821336bc95872213b',
      updateMethod: 'hermes-desktop-app-update',
      error: 'E2E ASSERTION FAILED: app driven via captured hermes desktop spec; update completed',
      logs: { desktop: '[hermes] [updates] no staged updater; surfacing manual `hermes update` for CLI install at C:/install\n[hermes] [updates] manual: hermes update\n' },
    }

    expect(matchKnownFailure(sample)?.id).toBe('windows-july-manual-app-update')
    expect(matchKnownFailure({ ...sample, installMethod: 'desktop-installer@latest' })).toBeNull()
    expect(matchKnownFailure({ ...sample, error: 'onboarding timed out' })).toBeNull()
    expect(matchKnownFailure({ ...sample, logs: { desktop: '[updates] manual: hermes update' } })).toBeNull()
  })

  it('CLI writes a receipt and exits zero only on a confirmed match', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'known-install-'))

    try {
      mkdirSync(path.join(root, 'logs'))
      writeFileSync(path.join(root, 'shas.json'), '\uFEFF' + JSON.stringify({ old: base.commit, current: 'f'.repeat(40), old_ref: 'v2026.3.12' }))
      writeFileSync(path.join(root, 'logs/update.log'), lockedLog)
      const args = [classifier, root, base.installMethod, base.updateMethod, base.error]
      expect(spawnSync(process.execPath, args).status).toBe(0)
      expect(JSON.parse(readFileSync(path.join(root, 'known-failure.json'), 'utf8')).id).toBe('windows-launcher-self-lock')
      writeFileSync(path.join(root, 'logs/update.log'), 'an unrelated failure')
      expect(spawnSync(process.execPath, args).status).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

it('renders known receipts as footnotes, without suppressing a red job', async () => {
  const modulePath = new URL('../scripts/sandbox/generate-e2e-matrix.mjs', import.meta.url).href
  const { renderMarkdownResults, legId } = await import(/* @vite-ignore */ modulePath)
  const name = 'windows: installer-script -> hermes-update (v2026.3.12 -> HEAD)'
  const rule = rules.find((item: { id: string }) => item.id === 'windows-launcher-self-lock')
  const artifacts = new Map([[`install-e2e-known-${rule.id}--${legId(name)}`, 42]])
  const known = renderMarkdownResults([{ name: name + ' / e2e', conclusion: 'success' }], [], artifacts)
  expect(known).toContain('0 passed, 0 failed, 1 known failures')
  expect(known).toContain('known [^1]')
  expect(known).toContain(`[^1]: **${rule.title}.**`)
  const failed = renderMarkdownResults([{ name: name + ' / e2e', conclusion: 'failure' }], [], artifacts)
  expect(failed).toContain('0 passed, 1 failed, 0 known failures')
  expect(failed).not.toContain('known [^1]')
  const passed = renderMarkdownResults([{ name: name + ' / e2e', conclusion: 'success' }])
  expect(passed).toContain('1 passed, 0 failed, 0 known failures')
})
