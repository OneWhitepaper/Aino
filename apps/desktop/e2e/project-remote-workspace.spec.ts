import { writeEnvFile, writeMockProviderConfig } from '../../../tests-js/scripts/mock-provider-config'
import { execFileSync } from 'node:child_process'
import type * as DiagnosticsChannel from 'node:diagnostics_channel'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import type { ClientRequest } from 'node:http'
import * as path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { startMockServer } from '../../../tests-js/scripts/mock-server'

import {
  buildAppEnv,
  createSandbox,
  launchDesktop,
  type MockBackendFixture,
  type Sandbox,
  waitForAppReady,

  } from './fixtures'
import {
  REMOTE_ID,
  REMOTE_LABEL,
  type RemoteGateway,
  startRemoteGateway,
  writeConnectionsRegistry
} from './remote-gateway-fixture'
import { type ElectronApplication, expect, type Page, test } from './test'

const CONFIG = 'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true'
let sandbox: Sandbox
let remote: RemoteGateway
let app: ElectronApplication
let page: Page
let mock: Awaited<ReturnType<typeof startMockServer>>
let localFolder: string
let remoteFolder: string
const rendererErrors: string[] = []

interface WorktreeRequest {
  method: string
  path: string
  status: number | undefined
}

interface RequestObservation {
  worktreeRequests: WorktreeRequest[]
}

function repository(folder: string, marker: string) {
  mkdirSync(folder, { recursive: true })
  writeFileSync(path.join(folder, 'README.md'), `${marker}\n`)
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', folder])
  execFileSync('git', ['-C', folder, 'add', 'README.md'])
  execFileSync('git', [
    '-C',
    folder,
    '-c',
    'user.name=Aino Test',
    '-c',
    'user.email=aino-test@example.com',
    'commit',
    '--quiet',
    '-m',
    'Fixture'
  ])
}

function messagesAt(home: string, text: string) {
  const file = path.join(home, 'state.db')

  if (!existsSync(file)) {
    return []
  }

  const db = new DatabaseSync(file, { readOnly: true })

  try {
    return db
      .prepare(
        "SELECT DISTINCT s.id, s.cwd FROM sessions s JOIN messages m ON m.session_id = s.id WHERE m.role = 'user' AND instr(m.content, ?) > 0"
      )
      .all(text) as Array<{ id: string; cwd: string }>
  } finally {
    db.close()
  }
}

async function ready() {
  await waitForAppReady({ app, page } as MockBackendFixture, 120_000)
}

async function signIn(identifier: string) {
  await page.getByRole('textbox', { name: 'Email or phone', exact: true }).fill(identifier)
  await page.getByRole('checkbox', { name: 'Agree to the user agreement and privacy policy', exact: true }).check()
  await page.getByRole('button', { name: 'Send code', exact: true }).click()
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('1234')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

async function changeSource(id: string, label: string) {
  await page.keyboard.press('ControlOrMeta+Comma')
  const settings = page.locator('[data-settings-workspace]')
  const advanced = settings.getByRole('button', { name: 'Advanced workspaces', exact: true })

  if ((await advanced.getAttribute('aria-expanded')) !== 'true') {
    await advanced.click()
  }

  await settings
    .locator('[data-slot="profile-rail"]:visible')
    .getByRole('button', { name: `default · ${label}`, exact: true })
    .click()
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const desktop = (
            window as unknown as {
              hermesDesktop: { connections: { list(): Promise<{ lastUsed?: string }> } }
            }
          ).hermesDesktop

          return (await desktop.connections.list()).lastUsed
        }),
      {
        timeout: 60_000
      }
    )
    .toBe(id)

  // Each gateway owns its account state; this second backend starts empty.
  if (id === REMOTE_ID) {
    await signIn('remote-project@example.com')
  }

  await ready()
}

async function send(text: string, home: string) {
  const composer = page.locator('[data-chat-surface]:visible [contenteditable="true"]').last()
  await composer.fill(text)
  await composer.press('Enter')
  await expect.poll(() => messagesAt(home, text), { timeout: 60_000 }).toHaveLength(1)
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)

  return messagesAt(home, text)[0]!
}

test.beforeAll(async () => {
  test.setTimeout(180_000)
  sandbox = createSandbox('project-remote')
  const root = realpathSync(sandbox.root)
  localFolder = path.join(root, 'local-projects', 'shared-project')
  remoteFolder = path.join(root, 'homelab-home', 'projects', 'shared-project')
  repository(localFolder, 'Only the local checkout')
  repository(remoteFolder, 'Only the remote checkout')
  mock = await startMockServer()
  writeMockProviderConfig(sandbox.hermesHome, mock.url, undefined, CONFIG)
  writeEnvFile(sandbox.hermesHome)
  remote = await startRemoteGateway(sandbox, mock.url, [], `${CONFIG}\nterminal:\n  cwd: ${path.dirname(remoteFolder)}`)
  writeConnectionsRegistry(sandbox, remote.url)
  ;({ app, page } = await launchDesktop(buildAppEnv(sandbox)))
  // REST travels through Electron's Node HTTP client, outside page tracing.
  // Observe actual responses without replacing transport or exposing headers.
  await app.evaluate((_, remoteUrl) => {
    const { subscribe } = process.getBuiltinModule('diagnostics_channel') as typeof DiagnosticsChannel

    const worktreeRequests: WorktreeRequest[] = []

    ;(globalThis as unknown as RequestObservation).worktreeRequests = worktreeRequests
    subscribe('http.client.request.start', message => {
      const { request } = message as { request: ClientRequest }
      const pathname = request.path.split('?')[0]!

      if (request.getHeader('host') === new URL(remoteUrl).host && pathname === '/api/git/worktree/add') {
        request.once('response', response => {
          worktreeRequests.push({ method: request.method, path: pathname, status: response.statusCode })
        })
      }
    })
  }, remote.url)
  page.on('pageerror', error => rendererErrors.push(error.message))
  await signIn('project-remote@example.com')
  await ready()
})

test.afterAll(async () => {
  await app?.close()
  await remote?.close()
  await mock?.close()
  sandbox?.cleanup()
})

test('routes project selection and worktree creation to the owning gateway across source switches', async () => {
  test.setTimeout(180_000)

  const openFolder = page
    .locator('[data-aino-sidebar]')
    .getByRole('button', { name: 'Open folder as project…', exact: true })

  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, localFolder)
  await openFolder.click()
  await expect(
    page.locator('[data-chat-surface]:visible').last().getByRole('button', { name: 'shared-project', exact: true })
  ).toBeVisible()
  const localChat = await send('Local source project conversation', sandbox.hermesHome)
  expect(localChat.cwd).toBe(localFolder)
  await changeSource(REMOTE_ID, REMOTE_LABEL)
  await openFolder.click()
  const picker = page.getByRole('dialog', { name: 'Choose remote folder', exact: true })
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: 'shared-project', exact: true }).click()
  await picker.getByRole('button', { name: 'Select folder', exact: true }).click()
  const surface = page.locator('[data-chat-surface]:visible').last()
  const mode = surface.getByRole('button', { name: 'Work location', exact: true })
  await expect(mode).toHaveText('Project directory')
  await surface.locator('[contenteditable="true"]').fill('Remote source project conversation')
  await mode.click()
  await page.getByRole('menuitem', { name: 'Create worktree…', exact: true }).click()
  const worktree = page.getByRole('dialog', { name: 'New worktree', exact: true })
  await worktree.getByPlaceholder('e.g. my-feature').fill('remote-work-proof')
  await worktree.getByRole('button', { name: 'New worktree', exact: true }).click()
  await expect(worktree).toHaveCount(0)
  await expect(mode).toHaveText('Worktree')
  await expect(surface.locator('[contenteditable="true"]')).toHaveText('Remote source project conversation')
  const remoteChat = await send('Remote source project conversation', remote.home)
  expect(remoteChat.cwd).not.toBe(localFolder)
  expect(execFileSync('git', ['-C', remoteChat.cwd, 'branch', '--show-current'], { encoding: 'utf8' }).trim()).toBe(
    'remote-work-proof'
  )
  expect(
    execFileSync('git', ['-C', localFolder, 'branch', '--list', 'remote-work-proof'], { encoding: 'utf8' }).trim()
  ).toBe('')
  expect(messagesAt(sandbox.hermesHome, 'Remote source project conversation')).toEqual([])
  expect(messagesAt(remote.home, 'Local source project conversation')).toEqual([])
  expect(await app.evaluate(() => (globalThis as unknown as RequestObservation).worktreeRequests)).toContainEqual({
    method: 'POST',
    path: '/api/git/worktree/add',
    status: 200
  })
  await page.getByRole('button', { name: 'Session summary', exact: true }).click()
  await expect(page.locator('[data-slot="summary-pane"]').getByText('remote-work-proof', { exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('remote-worktree-summary.png') })
  await changeSource('local', 'This device')
  await expect(
    page.locator('[data-chat-surface]:visible').last().getByRole('button', { name: 'Select project', exact: true })
  ).toBeVisible()
  await expect(page.locator('[data-slot="summary-pane"]').getByText('remote-work-proof', { exact: true })).toHaveCount(
    0
  )
  await openFolder.click()
  await expect(page.getByRole('dialog', { name: 'Choose remote folder', exact: true })).toHaveCount(0)
  await expect(
    page.locator('[data-chat-surface]:visible').last().getByRole('button', { name: 'shared-project', exact: true })
  ).toBeVisible()
  const returned = await send('Returned local project conversation', sandbox.hermesHome)
  expect(returned.cwd).toBe(localFolder)
  expect(messagesAt(remote.home, 'Returned local project conversation')).toEqual([])
  expect(rendererErrors).toEqual([])
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('local-project-after-remote.png') })
})
