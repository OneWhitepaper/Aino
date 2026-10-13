import { fingerprintToken, LOCKFILE_SCHEMA_VERSION, PROTOCOL_VERSION, spawnLogPath } from './remote-lifecycle'
export const OWNERSHIP_ID = '0123456789abcdef0123456789abcdef'
export const SPAWN_NONCE = '0123456789abcdef'

export function ownedLock(over: any = {}) {
  return {
    schemaVersion: LOCKFILE_SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    ownershipId: OWNERSHIP_ID,
    spawnNonce: SPAWN_NONCE,
    pid: 333,
    port: 40000,
    profile: '',
    hermesPath: '~/.local/bin/hermes',
    hermesHome: '~/.hermes',
    logPath: spawnLogPath(OWNERSHIP_ID, SPAWN_NONCE),
    tokenFingerprint: fingerprintToken('stored-token'),
    startedAt: '2026-07-14T00:00:00.000Z',
    creationTime: 'linux:123456',
    ...over
  }
}

export function fakeSsh(rules: any[] = []) {
  const calls: string[] = []

  return {
    calls,
    async exec(cmd) {
      calls.push(cmd)

      // Existing lifecycle fixtures predate the install-wide relaunch gate.
      // Their default remote has no update marker; focused marker tests below
      // use explicit SSH doubles to exercise live/uncertain transitions.
      const mutexWrapped = /setsid|nohup/.test(cmd) // spawn payloads run under the relaunch probe's marker gate

      if (cmd.includes('.hermes-update-in-progress') && !mutexWrapped) {
        return 'CLEAR'
      }

      const applicableRules = rules.filter(([matcher]) => {
        if (mutexWrapped && matcher instanceof RegExp && /kill -0/.test(matcher.source)) {
          return false
        }

        return !(mutexWrapped && matcher instanceof RegExp && /python3 -c/.test(matcher.source))
      })

      if (
        (cmd.includes('print("TERMINATED")') && !cmd.includes('pidfd_open') && !mutexWrapped) ||
        cmd.includes('printf TERMINATED')
      ) {
        return 'TERMINATED'
      }

      for (const [matcher, resp] of applicableRules) {
        const hit = typeof matcher === 'function' ? matcher(cmd) : matcher.test(cmd)

        if (hit) {
          const out = typeof resp === 'function' ? resp(cmd) : resp

          if (out instanceof Error) {
            throw out
          }

          return out
        }
      }

      return ''
    }
  }
}

export function connectDeps(ssh, over: any = {}) {
  return {
    ssh,
    ownershipId: OWNERSHIP_ID,
    profile: '',
    forward: async () => {},
    cancelForward: async () => {},
    pickLocalPort: async () => 50001,
    waitForHermes: async () => {},
    probeReuseProof: async () => 'authenticated-ok',
    adoptServedToken: async (_baseUrl, spawn) => spawn || 'served-token',
    rememberLog: () => {},
    readyTimeoutMs: 2000,
    ...over
  }
}
