import assert from 'node:assert/strict'

import { test } from 'vitest'

import { assertRemoteInstallUpdateClear, classifySshReuseProof, connect } from './remote-lifecycle'
import { connectDeps, SPAWN_NONCE } from './remote-lifecycle-fixtures'

test('SSH reuse proof rejects a backend whose runtime was replaced', () => {
  assert.equal(
    classifySshReuseProof(
      { ok: true, sshOwnerNonce: SPAWN_NONCE, protocolVersion: 1, runtimeIntact: false },
      SPAWN_NONCE
    ),
    'authenticated-stale'
  )
})

test('SSH reuse proof remains compatible when runtime state is absent', () => {
  assert.equal(
    classifySshReuseProof({ ok: true, sshOwnerNonce: SPAWN_NONCE, protocolVersion: 1 }, SPAWN_NONCE),
    'authenticated-ok'
  )
})

test('POSIX relaunch gate refuses live and uncertain install markers without executing Hermes', async () => {
  for (const observation of ['LIVE:4242', 'UNCERTAIN']) {
    const calls: string[] = []

    const ssh = {
      async exec(command) {
        calls.push(command)

        if (command === 'uname -s; uname -m') {
          return 'Linux\nx86_64\n'
        }

        if (command.includes('HERMES_HOME')) {
          return '/home/alice/.hermes\n'
        }

        if (command.includes('.hermes-update-in-progress')) {
          return observation
        }

        throw new Error(`unexpected command after update gate: ${command}`)
      }
    }

    await assert.rejects(
      () => connect(connectDeps(ssh)),
      (error: any) => error.kind === 'update-in-progress'
    )
    assert.equal(
      calls.some(command => /\[ -x |--version|lock\.json|serve --help|setsid/.test(command)),
      false
    )
  }
})

test('POSIX relaunch gate permits absent/dead markers and normalizes named-profile homes install-wide', async () => {
  const commands: string[] = []

  const ssh = {
    async exec(command) {
      commands.push(command)

      return 'CLEAR'
    }
  }

  await assertRemoteInstallUpdateClear(ssh, '/home/alice/.hermes/profiles/research')
  assert.ok(commands[0].endsWith(" '/home/alice/.hermes/.hermes-update-in-progress'"), commands[0].slice(-80))
})

test('POSIX relaunch gate rechecks after token upload immediately before process creation', async () => {
  const calls: string[] = []
  let markerChecks = 0

  const ssh = {
    async exec(command) {
      calls.push(command)

      if (command === 'uname -s; uname -m') {
        return 'Linux\nx86_64\n'
      }

      if (command.includes('HERMES_HOME')) {
        return '/home/alice/.hermes\n'
      }

      if (command.includes('.hermes-update-in-progress')) {
        markerChecks += 1

        return markerChecks >= 3 ? 'LIVE:4242' : 'CLEAR'
      }

      if (/\[ -x /.test(command)) {
        return 'OK'
      }

      if (command.includes('serve --help')) {
        return 'YES\n'
      }

      if (command.includes('python3 -c')) {
        return ''
      }

      if (command.includes('lock.json')) {
        return ''
      }

      return ''
    }
  }

  await assert.rejects(
    () => connect(connectDeps(ssh)),
    (error: any) => error.kind === 'update-in-progress'
  )
  assert.equal(markerChecks, 3)
  assert.equal(
    calls.some(command => /setsid|nohup/.test(command)),
    false
  )
})
