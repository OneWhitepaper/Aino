import assert from 'node:assert/strict'

import { test } from 'vitest'

import { locateHermes } from './remote-lifecycle'
import { fakeSsh } from './remote-lifecycle-fixtures'

test('locateHermes prefers the explicit profile path when executable', async () => {
  const ssh = fakeSsh([[/\[ -x .*\/opt\/hermes/, 'OK']])
  assert.equal(await locateHermes(ssh, '/opt/hermes'), '/opt/hermes')
})

test('locateHermes throws (no silent fallback) when an EXPLICIT path is not executable', async () => {
  // command -v WOULD find a different install, but an explicit path must not
  // silently fall back to it — that is the "connected to the wrong hermes" bug.
  const ssh = fakeSsh([
    [/command -v hermes/, '/home/u/.local/bin/hermes\n'],
    [/\[ -x .*\.local\/bin\/hermes/, 'OK']
  ])

  await assert.rejects(
    () => locateHermes(ssh, '/bad/path/hermes'),
    (err: any) => {
      assert.equal(err.kind, 'hermes-not-found')
      assert.match(err.message, /\/bad\/path\/hermes/)

      return true
    }
  )
})

test('locateHermes falls back to the login-shell command -v probe', async () => {
  const ssh = fakeSsh([
    [/command -v hermes/, '/home/u/.local/bin/hermes\n'],
    [/\[ -x .*\.local\/bin\/hermes/, 'OK']
  ])

  assert.equal(await locateHermes(ssh, ''), '/home/u/.local/bin/hermes')
})

test('locateHermes preserves an installer wrapper instead of resolving its interpreter', async () => {
  // install.sh venv mode writes: exec "$HERMES_BIN" "$HERMES_ENTRYPOINT" "$@",
  // where $HERMES_BIN is the venv python. The old canonicalization returned
  // that interpreter, so `<python> --version` printed "Python x.y.z" and
  // `<python> serve --help` failed outright (#74411). The wrapper itself is
  // executable and forwards args correctly — return it untouched.
  const ssh = fakeSsh([
    [/command -v hermes/, '/home/u/.local/bin/hermes\n'],
    [/\[ -x .*\.local\/bin\/hermes/, 'OK'],
    // If the removed python3 wrapper-parser were ever reintroduced, this rule
    // would reward it with an interpreter path and the assertions below fail.
    [/python3 -c/, '/home/u/.hermes/hermes-agent/venv/bin/python\n']
  ])

  assert.equal(await locateHermes(ssh, ''), '/home/u/.local/bin/hermes')
  assert.ok(
    !ssh.calls.some(cmd => cmd.includes('python3 -c')),
    'locateHermes must not shell out to a python3 parser to rewrite the launcher'
  )
})

test('locateHermes returns an explicit remoteHermesPath unchanged', async () => {
  // The override half of #74411: an explicit remoteHermesPath pointing at a
  // wrapper was also canonicalized to its interpreter, so overriding to
  // ~/.local/bin/hermes changed nothing for affected users.
  const ssh = fakeSsh([
    [/\[ -x .*\.local\/bin\/hermes/, 'OK'],
    [/python3 -c/, '/home/u/.hermes/hermes-agent/venv/bin/python\n']
  ])

  assert.equal(await locateHermes(ssh, '~/.local/bin/hermes'), '~/.local/bin/hermes')
  assert.ok(!ssh.calls.some(cmd => cmd.includes('python3 -c')), 'an explicit remoteHermesPath must never be rewritten')
})

test('locateHermes falls back to ~/.local/bin/hermes when the login-shell probe misses', async () => {
  // ~/.local/bin is the non-root installer's command location (scripts/install.sh).
  const ssh = fakeSsh([
    [/command -v hermes/, ''],
    [/\[ -x .*\.local\/bin\/hermes/, 'OK']
  ])

  assert.equal(await locateHermes(ssh, ''), '~/.local/bin/hermes')
})

test('locateHermes tries the conventional venv path last', async () => {
  const ssh = fakeSsh([[/\[ -x .*venv\/bin\/hermes/, 'OK']])
  assert.equal(await locateHermes(ssh, ''), '~/.hermes/hermes-agent/venv/bin/hermes')
})

test('locateHermes throws a hermes-not-found error with an install hint', async () => {
  const ssh = fakeSsh([]) // nothing is executable
  await assert.rejects(
    () => locateHermes(ssh, ''),
    (err: any) => {
      assert.equal(err.kind, 'hermes-not-found')
      assert.match(err.message, /install/i)

      return true
    }
  )
})

test('locateHermes uses a login shell for the command -v probe', async () => {
  const ssh = fakeSsh([
    [/command -v hermes/, '/x/hermes'],
    [/\[ -x/, 'OK']
  ])

  await locateHermes(ssh, '')
  assert.ok(
    ssh.calls.some(c => /bash -lc/.test(c)),
    'must probe in a login shell (PATH pitfall)'
  )
})
