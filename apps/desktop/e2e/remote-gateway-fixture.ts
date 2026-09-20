import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'

import { buildAppEnv, type Sandbox, writeEnvFile, writeMockProviderConfig } from './fixtures'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const REPO_ROOT = path.resolve(DESKTOP_ROOT, '..', '..')

export const REMOTE_LABEL = 'Homelab'
export const REMOTE_ID = 'homelab'
export const REMOTE_TOKEN = 'e2e-fleet-homelab-token'

export interface RemoteGateway {
  url: string
  home: string
  close: () => Promise<void>
}

function findHermesBinary(): string {
  const venv = path.join(REPO_ROOT, '.venv', 'bin', 'hermes')

  if (fs.existsSync(venv)) {
    return venv
  }

  const result = spawnSync('which', ['hermes'], { encoding: 'utf8' })

  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim()
  }

  throw new Error('hermes binary not found: create the repo venv (uv sync) or put hermes on PATH')
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo
      server.close(() => resolve(port))
    })
  })
}

/** Seed `<home>/profiles/<name>/` so the backend's /api/profiles lists it. */
export function seedProfiles(home: string, names: string[]): void {
  for (const name of names) {
    const dir = path.join(home, 'profiles', name)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'config.yaml'), '', 'utf8')
  }
}

/**
 * Spawn a second, fully real `hermes serve` as the remote gateway. Its
 * session token is pinned through HERMES_DASHBOARD_SESSION_TOKEN so the
 * registry entry can carry a plaintext token envelope.
 */
export async function startRemoteGateway(
  sandbox: Sandbox,
  mockUrl: string,
  profiles: string[],
  extraConfig?: string
): Promise<RemoteGateway> {
  const root = sandbox.root
  const home = path.join(root, 'homelab-home')
  fs.mkdirSync(home, { recursive: true })
  writeMockProviderConfig(home, mockUrl, undefined, extraConfig)
  writeEnvFile(home)
  seedProfiles(home, profiles)

  const port = await freePort()
  const url = `http://127.0.0.1:${port}`

  const child: ChildProcess = spawn(
    findHermesBinary(),
    ['serve', '--host', '127.0.0.1', '--port', String(port), '--skip-build'],
    {
      cwd: REPO_ROOT,
      detached: true,
      env: {
        ...buildAppEnv(sandbox),
        HERMES_HOME: home,
        HERMES_DASHBOARD_SESSION_TOKEN: REMOTE_TOKEN
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  let log = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    log += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    log += chunk.toString()
  })

  const deadline = Date.now() + 90_000

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`remote hermes serve exited early (${child.exitCode}):\n${log}`)
    }

    try {
      const response = await fetch(`${url}/api/status`, {
        headers: { 'X-Hermes-Session-Token': REMOTE_TOKEN }
      })

      if (response.ok) {
        break
      }
    } catch {
      // not up yet
    }

    await new Promise(resolve => setTimeout(resolve, 500))
  }

  if (Date.now() >= deadline) {
    throw new Error(`remote hermes serve never became ready:\n${log}`)
  }

  return {
    url,
    home,
    close: async () => {
      if (child.pid && child.exitCode === null) {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch {
          child.kill('SIGTERM')
        }
      }

      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
}

export function writeConnectionsRegistry(sandbox: Sandbox, remoteUrl: string): void {
  fs.writeFileSync(
    path.join(sandbox.userDataDir, 'connections.json'),
    JSON.stringify(
      {
        version: 2,
        primary: 'local',
        launchMode: 'primary',
        lastUsed: 'local',
        connections: [
          { id: 'local', kind: 'local', label: 'This device' },
          {
            id: REMOTE_ID,
            kind: 'remote',
            label: REMOTE_LABEL,
            url: remoteUrl,
            authMode: 'token',
            token: { encoding: 'plain', value: REMOTE_TOKEN }
          }
        ]
      },
      null,
      2
    ),
    { encoding: 'utf8', mode: 0o600 }
  )
}
