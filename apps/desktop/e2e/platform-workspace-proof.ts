import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import type { ConsoleMessage } from '@playwright/test'

import { type Sandbox, waitForAppReady } from './fixtures'
import { activeAccountSandbox, fixtureHomes } from './platform-account-home'
import {
  fixtureEnvironment,
  type launchGuardedDesktop,
  type NativeState,
  type startRealPlatformAPI
} from './platform-real-api'
import { expect, type Page } from './test'

interface WorkspaceWindow {
  hermesDesktop: {
    openWindow(options?: { connectionId: string; profile: string }): Promise<unknown>
    platformAccount: { status(): Promise<{ phase: string; account: { id: string } | null }> }
    platformBilling: { summary(input: { expected_user_id: string }): Promise<{ balance: string }> }
  }
}

interface GatewayIdentity {
  pid: number
  home: string
  startTime: number
}

interface BackendClaimModule {
  processStartMarker(pid: number, timeoutMs?: number): Promise<string>
}

const BACKEND_CLAIM_MODULE_PATH = '../electron/backend-claim.ts'
const MARKER_ENV_KEYS = ['TZ', 'LANG', 'LC_ALL'] as const
const REPO_ROOT = path.resolve(import.meta.dirname, '../../..')

const GATEWAY_IDENTITY_SCRIPT = `import json, pathlib, sys
from gateway.status import get_process_start_time, get_running_pid_identity_strict, read_runtime_status
home = pathlib.Path(sys.argv[1]).resolve()
identity = get_running_pid_identity_strict(home / 'gateway.pid')
record = read_runtime_status(home / 'gateway_state.json')
if identity is None:
    print('null')
    sys.exit(0)
if not isinstance(record, dict):
    raise RuntimeError('sandbox gateway has no runtime status')
pid, _ = identity
start = get_process_start_time(pid)
if (record.get('pid') != pid or record.get('start_time') != start
        or pathlib.Path(record.get('hermes_home', '')).resolve() != home):
    raise RuntimeError('sandbox gateway status does not match the live owner')
print(json.dumps({'pid': pid, 'startTime': start, 'home': str(home)}))
`

let backendClaimModule: Promise<BackendClaimModule> | null = null

export const PLATFORM_WORKSPACE = 'fixture-workspace'

export function seedPlatformWorkspace(sandbox: Sandbox) {
  const home = path.join(sandbox.hermesHome, 'profiles', PLATFORM_WORKSPACE)
  fs.mkdirSync(home, { recursive: true, mode: 0o700 })
  fs.writeFileSync(
    path.join(home, 'config.yaml'),
    'display:\n  language: en\nauxiliary:\n  title_generation:\n    enabled: false\n',
    { mode: 0o600 }
  )
  fs.writeFileSync(path.join(home, '.env'), '', { mode: 0o600 })
}

async function selectWorkspace(page: Page, profile: string) {
  // Aino keeps profile selection in its existing composer command rather
  // than restoring the upstream workspace rail on Manage Bots.
  const composer = page.locator('[data-slot="composer-root"] [contenteditable="true"]').first()
  const notice = page.getByText(`New chats will use bot ${profile}.`, { exact: true }).first()
  const consoleLines: string[] = []
  const capture = (message: ConsoleMessage) => consoleLines.push(`${message.type()}: ${message.text()}`)
  const captureError = (error: Error) => consoleLines.push(`pageerror: ${error.message}`)
  page.on('console', capture)
  page.on('pageerror', captureError)

  try {
    await composer.fill(`/profile ${profile}`)
    await expect(composer).toHaveText(`/profile ${profile}`)
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
    await composer.press('Enter')
    await expect(notice).toBeVisible({ timeout: 60_000 })
  } catch (error) {
    await page.getByRole('button', { name: 'Notifications and status', exact: true }).click()
    console.log('WORKSPACE_NOTIFICATION_STATE: ' + (await page.locator('body').innerText()))
    console.log('WORKSPACE_COMMAND_CONSOLE: ' + JSON.stringify(consoleLines))
    throw error
  } finally {
    page.off('console', capture)
    page.off('pageerror', captureError)
  }
}

function assertProfileTurnStorage(sandbox: Sandbox, billingSessionId: string, prompt: string, response: string) {
  const output = execFileSync(
    gatewayPython(),
    [
      '-c',
      `import json, sys
from tests.fixtures.legacy_desktop.storage_proof import assert_profile_turn_storage
assert_profile_turn_storage(*sys.argv[1:])
print(json.dumps({'verified': True}))
`,
      sandbox.hermesHome,
      PLATFORM_WORKSPACE,
      billingSessionId,
      prompt,
      response
    ],
    { cwd: REPO_ROOT, env: gatewayEnvironment(sandbox), encoding: 'utf8', timeout: 30_000 }
  )

  // /api/profiles/active is a host-registry collection, not proof of a
  // multiplexed session's owner. Inspect the actual turn's two durable stores.
  expect(JSON.parse(output)).toEqual({ verified: true })
}

function gatewayEnvironment(sandbox: Sandbox): Record<string, string> {
  return {
    ...fixtureEnvironment(),
    HOME: sandbox.root,
    HERMES_HOME: sandbox.hermesHome,
    PYTHONPATH: path.join(sandbox.root, 'python-network-guard')
  }
}

function gatewayPython(): string {
  return process.env.HERMES_DESKTOP_PYTHON || path.join(REPO_ROOT, '.venv', 'bin', 'python')
}

export function inspectGatewayIdentity(sandbox: Sandbox): GatewayIdentity | null {
  const output = execFileSync(gatewayPython(), ['-c', GATEWAY_IDENTITY_SCRIPT, sandbox.hermesHome], {
    cwd: REPO_ROOT,
    env: gatewayEnvironment(sandbox),
    encoding: 'utf8',
    timeout: 30_000
  })

  const identity = JSON.parse(output) as GatewayIdentity | null

  if (identity === null) {
    return null
  }

  expect(identity.pid).toBeGreaterThan(0)
  expect(identity.startTime).toBeGreaterThan(0)
  expect(identity.home).toBe(fs.realpathSync(sandbox.hermesHome))

  return identity
}

function readGatewayIdentity(sandbox: Sandbox): GatewayIdentity {
  const identity = inspectGatewayIdentity(sandbox)

  expect(identity, 'sandbox gateway is running').not.toBeNull()

  return identity!
}

export function stopFixtureGateway(sandbox: Sandbox): void {
  for (const home of fixtureHomes(sandbox)) {
    stopHomeGateway({ ...sandbox, hermesHome: home })
  }
}

function stopHomeGateway(sandbox: Sandbox): void {
  if (!fs.existsSync(path.join(sandbox.hermesHome, 'gateway.pid'))) {
    return
  }

  if (inspectGatewayIdentity(sandbox) === null) {
    return
  }

  execFileSync(gatewayPython(), ['-m', 'hermes_cli.main', 'gateway', 'stop', '--yes'], {
    cwd: REPO_ROOT,
    env: gatewayEnvironment(sandbox),
    encoding: 'utf8',
    timeout: 90_000
  })
}

export async function processStartMarkerWithEnvironment(pid: number, environment: Record<string, string>) {
  backendClaimModule ??= import(BACKEND_CLAIM_MODULE_PATH) as Promise<BackendClaimModule>
  const { processStartMarker } = await backendClaimModule
  const previous = Object.fromEntries(MARKER_ENV_KEYS.map(key => [key, process.env[key]]))

  try {
    for (const key of MARKER_ENV_KEYS) {
      if (Object.hasOwn(environment, key)) {
        process.env[key] = environment[key]
      } else {
        delete process.env[key]
      }
    }

    return await processStartMarker(pid, 30_000)
  } finally {
    for (const key of MARKER_ENV_KEYS) {
      if (previous[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = previous[key]
      }
    }
  }
}

function guardPids(home: string): number[] {
  return fs
    .readFileSync(path.join(home, 'python-network-guard-active'), 'utf8')
    .trim()
    .split('\n')
    .map(Number)
    .filter(pid => Number.isInteger(pid) && pid > 0)
}

export async function verifyPlatformWorkspace(
  launched: Awaited<ReturnType<typeof launchGuardedDesktop>>,
  api: Awaited<ReturnType<typeof startRealPlatformAPI>>,
  sandbox: Sandbox,
  accountID: string,
  screenshotPath: string
) {
  sandbox = await activeAccountSandbox(sandbox, launched)
  const { page } = launched
  const before = await api.control<NativeState>('state')
  const gatewayOwner = readGatewayIdentity(sandbox)

  expect(guardPids(sandbox.hermesHome)).toContain(gatewayOwner.pid)

  await selectWorkspace(page, PLATFORM_WORKSPACE)

  const current = await page.evaluate(async id => {
    const desktop = (window as unknown as WorkspaceWindow).hermesDesktop

    return {
      account: await desktop.platformAccount.status(),
      wallet: await desktop.platformBilling.summary({ expected_user_id: id })
    }
  }, accountID)

  expect(current.account.phase).toBe('signed_in')
  expect(current.account.account?.id).toBe(accountID)
  expect(current.wallet.balance).toBe(before.balance)

  const profileHome = path.join(sandbox.hermesHome, 'profiles', PLATFORM_WORKSPACE)
  const workspaceOwner = readGatewayIdentity(sandbox)

  expect(workspaceOwner).toEqual(gatewayOwner)
  expect(guardPids(sandbox.hermesHome)).toContain(workspaceOwner.pid)
  expect(fs.existsSync(path.join(profileHome, 'gateway.pid'))).toBe(false)
  expect(fs.readFileSync(path.join(profileHome, 'config.yaml'), 'utf8')).not.toContain('api_key')

  await page.locator('[data-tour="model-pill"]').first().click()
  await page.getByRole('menuitem', { name: /fixture-tool-model/ }).click()
  const composer = page.locator('[contenteditable="true"]').first()
  const prompt = `Read ${api.info.fixture_path} from the isolated workspace and verify it.`
  await composer.click()
  await composer.pressSequentially(prompt)
  await page.keyboard.press('Enter')
  await expect
    .poll(async () => (await api.control<NativeState>('state')).tool_results, { timeout: 60_000 })
    .toBe(before.tool_results + 1)
  await expect.poll(async () => (await api.control<NativeState>('state')).usage_calls).toBe(before.usage_calls + 2)
  await expect(page.getByText(`Verified ${api.info.fixture_content}`, { exact: false }).first()).toBeVisible()
  await expect(composer.locator('xpath=ancestor::form').getByRole('button', { name: 'Stop', exact: true })).toHaveCount(
    0
  )
  const after = await api.control<NativeState>('state')

  const sessionIds = [
    ...new Set(after.usage_ledger.slice(before.usage_ledger.length).map(row => row.desktop_session_id))
  ]

  expect(sessionIds).toHaveLength(1)
  assertProfileTurnStorage(sandbox, sessionIds[0], prompt, `Verified ${api.info.fixture_content}`)
  await page.screenshot({ path: screenshotPath })

  await selectWorkspace(page, 'default')
  await page.evaluate(() =>
    (window as unknown as WorkspaceWindow).hermesDesktop.openWindow({ connectionId: 'local', profile: 'default' })
  )
  await expect.poll(() => launched.app.windows().length).toBe(2)
  const peer = launched.app.windows().find(candidate => candidate !== page)!
  await waitForAppReady({ app: launched.app, page: peer } as never, 60_000)

  const peerAccount = await peer.evaluate(() =>
    (window as unknown as WorkspaceWindow).hermesDesktop.platformAccount.status()
  )

  expect(peerAccount.phase).toBe('signed_in')
  expect(peerAccount.account?.id).toBe(accountID)

  const peerWallet = await peer.evaluate(
    id => (window as unknown as WorkspaceWindow).hermesDesktop.platformBilling.summary({ expected_user_id: id }),
    accountID
  )

  expect(peerWallet.balance).toBe(after.balance)

  const peerAudit = await api.control<{ leaked: boolean }>(
    'audit',
    JSON.stringify(
      await peer.evaluate(async () => ({
        account: await (window as unknown as WorkspaceWindow).hermesDesktop.platformAccount.status(),
        localStorage: { ...localStorage },
        body: document.body.innerText
      }))
    )
  )

  expect(peerAudit.leaked).toBe(false)
  // Keep both observers alive through the final transport/secret audit. The
  // fixture closes all windows together after auditing via app.close().
  const mainWindow = await launched.app.browserWindow(page)
  await mainWindow.evaluate(window => window.hide())
  expect(await mainWindow.evaluate(window => window.isVisible())).toBe(false)
  await mainWindow.evaluate(window => window.show())
  expect(await mainWindow.evaluate(window => window.isVisible())).toBe(true)

  const mainAfterShow = await page.evaluate(async id => {
    const desktop = (window as unknown as WorkspaceWindow).hermesDesktop

    return {
      account: await desktop.platformAccount.status(),
      wallet: await desktop.platformBilling.summary({ expected_user_id: id })
    }
  }, accountID)

  expect(mainAfterShow.account.phase).toBe('signed_in')
  expect(mainAfterShow.account.account?.id).toBe(accountID)
  expect(mainAfterShow.wallet.balance).toBe(after.balance)

  return {
    profile: PLATFORM_WORKSPACE,
    account_id: accountID,
    canonical_owner_verified: true,
    profile_scope_verified: true,
    peer_account_matches: true,
    peer_wallet_matches: true,
    peerAudit,
    hide_show_preserves_account: true,
    hide_show_preserves_wallet: true,
    before,
    after
  }
}
