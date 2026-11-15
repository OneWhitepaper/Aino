// windows-bundled-helpers — unit tests for the pure helpers of the
// Windows packaged-app E2E arm. Pure manifest validation plus real descriptor
// CLI calls through the release Python module; no Windows installation needed.
//
//   node --test tests/install/e2e-assets/windows-bundled-helpers.test.mjs
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { admitCandidateCommit, byteRange } from './windows-bundled-helpers.mjs'

test('reused packages require an explicit private hosted source without rewriting the harness SHA', () => {
  const source = 'a'.repeat(40)
  const env = { GITHUB_ACTIONS: 'true', GITHUB_SHA: 'b'.repeat(40), GITHUB_EVENT_NAME: 'workflow_dispatch',
    RUNNER_ENVIRONMENT: 'github-hosted', AINO_PRIVATE_CANDIDATE: 'true', AINO_PRIVATE_REUSE_SOURCE_COMMIT: source }
  assert.doesNotThrow(() => admitCandidateCommit(source, env))
  assert.equal(env.GITHUB_SHA, 'b'.repeat(40))
  for (const changed of [{ AINO_PRIVATE_REUSE_SOURCE_COMMIT: '' }, { RUNNER_ENVIRONMENT: 'self-hosted' },
    { GITHUB_EVENT_NAME: 'push' }, { AINO_PRIVATE_CANDIDATE: '' }, { GITHUB_ACTIONS: '' }]) {
    assert.throws(() => admitCandidateCommit(source, { ...env, ...changed }))
  }
  assert.doesNotThrow(() => admitCandidateCommit(source, { GITHUB_ACTIONS: 'true', GITHUB_SHA: source }))
})

test('native acceptance descriptor CLI uses explicit publisher and a stable subscription across upgrades', () => {
  const feed = fs.mkdtempSync(path.join(os.tmpdir(), 'wbh-descriptor-'))
  try {
    for (const version of ['1.2.3.0', '1.2.4.31']) {
      execFileSync(process.execPath, [fileURLToPath(new URL('./windows-bundled-helpers.mjs', import.meta.url)),
        'descriptor', '--feed', feed, '--base-url', 'http://127.0.0.1:9',
        '--identity', 'Fixture.App', '--publisher', 'CN=Fixture & "Team"',
        '--version', version, '--bundle', `${version}.msixbundle`, '--descriptor-filename', 'update.appinstaller',
      ])
      const xml = fs.readFileSync(path.join(feed, 'update.appinstaller'), 'utf8')
      assert.match(xml, /Publisher="CN=Fixture &amp; &quot;Team&quot;"/)
      assert.match(xml, /Uri="http:\/\/127.0.0.1:9\/update.appinstaller"/)
      assert.ok(xml.includes(`Uri="http://127.0.0.1:9/${version}.msixbundle"`))
      assert.equal((xml.match(new RegExp(`Version="${version.replaceAll('.', '\\.')}"`, 'g')) || []).length, 2)
      assert.match(xml, /HoursBetweenUpdateChecks="12"/)
    }
  } finally { fs.rmSync(feed, { recursive: true, force: true }) }
})

test('the feed honours byte ranges, which App Installer requires (0x80D05011 without them)', () => {
  assert.equal(byteRange(undefined, 1000), null)
  assert.deepEqual(byteRange('bytes=0-99', 1000), { start: 0, end: 99 })
  assert.deepEqual(byteRange('bytes=900-', 1000), { start: 900, end: 999 })
  assert.deepEqual(byteRange('bytes=-100', 1000), { start: 900, end: 999 })
  assert.deepEqual(byteRange('bytes=990-5000', 1000), { start: 990, end: 999 })
  assert.equal(byteRange('bytes=1000-', 1000), 'unsatisfiable')
  assert.equal(byteRange('bytes=0-1,5-9', 1000), null)
})

test('local candidate admission pins same-source packages without weakening released upgrade manifests', async () => {
  const { validateBundledManifest } = await import('./windows-bundled-helpers.mjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wbh-candidate-'))
  const commit = 'a'.repeat(40)
  const publisher = 'CN=Aino Private Acceptance'
  try {
    const side = (slot, version, tag) => {
      const file = path.join(root, `${slot}.msixbundle`)
      fs.writeFileSync(file, slot)
      return { tag, version, commit, identity: 'Aino.Candidate', publisher, applicationId: 'Aino',
        artifact: { url: `http://127.0.0.1:9/${slot}.msixbundle`, path: file,
          sha256: slot === 'old' ? '1'.repeat(64) : '2'.repeat(64) } }
    }
    const manifest = { schema: 1, platform: 'windows', arch: 'x64',
      old: side('old', '1.0.0.0', 'v0.1.6'), new: side('new', '1.0.1.0', 'v0.1.7') }
    assert.equal(validateBundledManifest(manifest, { expectedPublisher: publisher }).ok, false)
    assert.equal(validateBundledManifest(manifest, { expectedPublisher: publisher, candidateCommit: commit }).ok, true)
    assert.equal(validateBundledManifest(manifest, { expectedPublisher: publisher, candidateCommit: 'b'.repeat(40) }).ok, false)
    const changed = structuredClone(manifest)
    changed.old.commit = 'c'.repeat(40)
    assert.equal(validateBundledManifest(changed, { expectedPublisher: publisher, candidateCommit: commit }).ok, false)
    changed.old.commit = commit
    changed.old.tag = changed.new.tag
    assert.equal(validateBundledManifest(changed, { expectedPublisher: publisher, candidateCommit: commit }).ok, false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
