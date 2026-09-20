import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { startMockServer, MOCK_REPLY } from '../../../tests-js/scripts/mock-server'
import {
  buildAppEnv,
  createSandbox,
  launchDesktop,
  waitForAppReady,
  writeEnvFile,
  writeMockProviderConfig,
  type MockBackendFixture,
  type Sandbox
} from './fixtures'
import { startRemoteGateway, writeConnectionsRegistry, type RemoteGateway } from './remote-gateway-fixture'
import { expect, test, type ElectronApplication, type Page } from './test'

const root = path.resolve(import.meta.dirname, '../../..')
const config =
  'conversations:\n  enabled: true\ndesktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true\ncompression:\n  enabled: false'
let sandbox: Sandbox
let remote: RemoteGateway
let app: ElectronApplication
let page: Page
let mock: Awaited<ReturnType<typeof startMockServer>>
const errors: string[] = []

function python(home: string, script: string, args: string[] = []) {
  return execFileSync(path.join(root, '.venv/bin/python'), ['-c', script, ...args], {
    cwd: root,
    env: buildAppEnv(sandbox, { HOME: sandbox.root, HERMES_HOME: home }),
    encoding: 'utf8'
  })
}
function seed(home: string, label: string) {
  const profile = path.join(home, 'profiles/writer')
  fs.mkdirSync(profile, { recursive: true })
  writeMockProviderConfig(profile, mock.url, '  language: en', config)
  writeEnvFile(profile)
  python(
    home,
    `
import hashlib, sys
from pathlib import Path
from hermes_state import SessionDB
from gateway.hosted_rooms import default_db_path, local_authority_gateway_id
from gateway.hosted_room_conversation_store import ConversationStore
from gateway.hosted_room_conversation_types import ParticipantRef
home, label = Path(sys.argv[1]), sys.argv[2]
with SessionDB(home / 'profiles/writer/state.db') as db:
    db.create_session('same-legacy-id', source='desktop')
    db.set_session_title('same-legacy-id', label + ' legacy')
    db.append_message('same-legacy-id', 'user', label + ' public question')
    db.append_message('same-legacy-id', 'assistant', label + ' public answer', reasoning='PRIVATE REASONING')
    db.append_messages_batch('same-legacy-id', [{'role':'user', 'content':'PRIVATE HIDDEN INSTRUCTION', 'display_kind':'hidden'}])
authority = local_authority_gateway_id()
general = ParticipantRef('participant:' + hashlib.sha256(f'{authority}\\0default'.encode()).hexdigest(), authority, 'default', 'Aino', True)
ConversationStore(default_db_path()).create('same-public-id', label + ' public conversation', general, None, owner_key='legacy-local')
`,
    [home, label]
  )
}

test.beforeAll(async () => {
  test.setTimeout(180_000)
  sandbox = createSandbox('conversation-history-migration')
  mock = await startMockServer()
  writeMockProviderConfig(sandbox.hermesHome, mock.url, '  language: en', config)
  writeEnvFile(sandbox.hermesHome)
  seed(sandbox.hermesHome, 'Local')
  remote = await startRemoteGateway(sandbox, mock.url, [], config)
  seed(remote.home, 'Remote')
  writeConnectionsRegistry(sandbox, remote.url)
  ;({ app, page } = await launchDesktop(buildAppEnv(sandbox, { HOME: sandbox.root })))
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('+8613800138000')
  await page.getByRole('checkbox', { name: 'Agree to the user agreement and privacy policy', exact: true }).check()
  await page.getByRole('button', { name: 'Send code', exact: true }).click()
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('1234')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await waitForAppReady({ app, page } as MockBackendFixture, 120_000)
})
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const logs = path.join(sandbox.hermesHome, 'logs')
    for (const name of ['desktop.log', 'gui.log', 'errors.log']) {
      const file = path.join(logs, name)
      if (fs.existsSync(file)) await testInfo.attach(name, { path: file, contentType: 'text/plain' })
    }
  }
})
test.afterAll(async () => {
  await app?.close()
  await remote?.close()
  await mock?.close()
  sandbox?.cleanup()
})

test('all-source history retains source twins and an explicit adoption redirects only its own old link', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const sidebar = page.locator('[data-aino-sidebar]')
  await expect(sidebar.getByText('Local public conversation', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(sidebar.getByText('Remote public conversation', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(sidebar.getByText('Local legacy', { exact: true })).toBeVisible()
  await expect(sidebar.getByText('Remote legacy', { exact: true })).toBeVisible()

  for (const [label, connection] of [
    ['Local', 'local'],
    ['Remote', 'homelab']
  ]) {
    await sidebar.getByText(`${label} public conversation`, { exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`same-public-id\\?.*connection=${connection}`))
    await expect(page.locator('main[data-conversation-id="same-public-id"]')).toBeVisible()
  }
  // The exact legacy source remains independently readable before adoption.
  await sidebar.getByText('Local legacy', { exact: true }).click()
  await expect(page.locator('[data-chat-surface]:visible').last()).toContainText('Local public answer')
  await expect(page.locator('[data-chat-surface]:visible').last()).not.toContainText('Remote public answer')
  const oldLocalRoute = page.url()
  // Leave the old source before adopting; migration must create a fresh private runtime.
  await sidebar.getByText('Local public conversation', { exact: true }).click()
  await sidebar.getByText('Local legacy', { exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Continue as conversation', exact: true }).click()
  await expect(page).toHaveURL(/#\/conversations\/[a-f0-9-]+\?.*connection=local/)
  const adoptedRoute = page.url()
  const surface = page.locator('main[data-conversation-id]')
  await expect(surface).toContainText('Local public question')
  await expect(surface).toContainText('Local public answer')
  await expect(surface).not.toContainText('PRIVATE')
  await surface.getByRole('textbox', { name: 'Message', exact: true }).fill('Continue the adopted conversation')
  await surface.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(surface.locator('article').filter({ hasText: MOCK_REPLY })).toHaveCount(1, { timeout: 60_000 })
  await expect(sidebar.getByText('Remote legacy', { exact: true })).toBeVisible()
  await page.goto(oldLocalRoute)
  await expect(page).toHaveURL(adoptedRoute)
  await expect(surface).toContainText('Local public answer')
  // Both migration receipts and their source fence are part of a real recovery set.
  const snapshot = path.join(sandbox.root, 'migrated-snapshot')
  python(
    sandbox.hermesHome,
    `
from pathlib import Path
import sys
from hermes_cli.conversation_backup import create_conversation_snapshot, verify_conversation_snapshot
manifest = create_conversation_snapshot(Path(sys.argv[1]), Path(sys.argv[2]))
assert verify_conversation_snapshot(Path(sys.argv[2])) == manifest
`,
    [sandbox.hermesHome, snapshot]
  )
  const db = new DatabaseSync(path.join(snapshot, 'profiles/writer/state.db'), { readOnly: true })
  try {
    expect(db.prepare('SELECT status FROM session_conversation_migrations').all()).toEqual([{ status: 'complete' }])
  } finally {
    db.close()
  }
  await page.screenshot({ path: testInfo.outputPath('owned-history-adoption.png') })
  expect(errors).toEqual([])
})
