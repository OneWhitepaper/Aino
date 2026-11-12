import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { within } from '../../tests/install/e2e-assets/smoke-env.mjs'

import type { ChatIdentity } from './desktop-chat-smoke.ts'

export interface UpgradeGatewayProbe {
  root: string
  home: string
  commit: string
  connection: { baseUrl: string; mode?: string }
  identity: ChatIdentity
}

/** Observe only the backend selected by the authenticated NEW workspace. */
export function bundledUpgradeHealth(options: UpgradeGatewayProbe): unknown {
  const { root, home, commit, connection, identity } = options

  if (!identity.hermesHome || fs.realpathSync(identity.hermesHome) !== fs.realpathSync(home)) {
    throw new Error('Authenticated update workspace resolved another account home')
  }

  const base = new URL(connection.baseUrl)

  if (connection.mode !== 'local' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || !base.port) {
    throw new Error('Authenticated update workspace did not select a local gateway')
  }

  const stamp = z.object({ payload: z.literal('bundled'), commit: z.literal(commit), runtime: z.object({
    storePython: z.string(), repoDir: z.string(), sitePackages: z.string()
  }) }).parse(JSON.parse(fs.readFileSync(path.join(root, '..', 'install-stamp.json'), 'utf8')))

  const python = path.join(root, stamp.runtime.storePython)
  const imports = [stamp.runtime.repoDir, stamp.runtime.sitePackages].map(relative => path.join(root, relative))

  if (![python, ...imports].every(candidate => within(root, candidate))) {
    throw new Error('Bundled gateway observer escapes the verified installation')
  }

  const output = execFileSync(python, ['-B', path.resolve(import.meta.dirname,
    '../../tests/install/e2e-assets/bundled-gateway-health.py'), home, commit, base.origin], {
    cwd: root, encoding: 'utf8', timeout: 110_000,
    env: { ...process.env, NO_PROXY: '127.0.0.1,localhost,::1', no_proxy: '127.0.0.1,localhost,::1',
      PYTHONPATH: imports.join(path.delimiter) },
  })

  return JSON.parse(output) as unknown
}
