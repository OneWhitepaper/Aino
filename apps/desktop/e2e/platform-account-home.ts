import * as fs from 'node:fs'
import * as path from 'node:path'

import { resolveDesktopHermesHome } from '../electron/data-paths.mjs'

import type { Sandbox } from './fixtures'
import type { launchGuardedDesktop } from './platform-real-api'
import { expect } from './test'

type Launch = Awaited<ReturnType<typeof launchGuardedDesktop>>

interface AccountHomeWindow {
  hermesDesktop: {
    getVersion(): Promise<{ hermesHome: string }>
    platformAccount: { status(): Promise<{ account: { id: string } | null; revision: number }> }
    platformModels: { owner(revision: number): Promise<{ platform_origin: string; user_id: string }> }
  }
}

export async function activeAccountSandbox(sandbox: Sandbox, launched: Launch): Promise<Sandbox> {
  const current = await launched.page.evaluate(async () => {
    const desktop = (window as unknown as AccountHomeWindow).hermesDesktop
    const snapshot = await desktop.platformAccount.status()

    return { userId: snapshot.account?.id, owner: await desktop.platformModels.owner(snapshot.revision),
      version: await desktop.getVersion() }
  })

  expect(current.userId).toBeTruthy()
  expect(current.owner.user_id).toBe(current.userId)

  const home = resolveDesktopHermesHome({ home: sandbox.root, accountWorkspace: {
    userData: sandbox.userDataDir, origin: current.owner.platform_origin, userId: current.userId!
  } })

  expect(current.version.hermesHome).toBe(home)

  return { ...sandbox, hermesHome: home }
}

export function fixtureHomes(sandbox: Pick<Sandbox, 'hermesHome' | 'userDataDir'>): string[] {
  const roots = [sandbox.hermesHome]
  const accounts = path.join(sandbox.userDataDir, 'account-workspaces')

  for (const entry of fs.existsSync(accounts) ? fs.readdirSync(accounts, { withFileTypes: true }) : []) {
    if (entry.isDirectory()) { roots.push(path.join(accounts, entry.name, 'home')) }
  }

  return [...new Set(roots.flatMap(home => {
    const profiles = path.join(home, 'profiles')

    return [home, ...(fs.existsSync(profiles) ? fs.readdirSync(profiles, { withFileTypes: true }) : [])
      .filter(entry => entry.isDirectory()).map(entry => path.join(profiles, entry.name))]
  }))]
}

export function fixtureOwnershipFiles(userData: string): string[] {
  const files = [path.join(userData, 'backend-ownership.json')]
  const accounts = path.join(userData, 'account-workspaces')

  for (const entry of fs.existsSync(accounts) ? fs.readdirSync(accounts, { withFileTypes: true }) : []) {
    if (entry.isDirectory()) { files.push(path.join(accounts, entry.name, 'desktop', 'backend-ownership.json')) }
  }

  return files.filter(file => fs.existsSync(file))
}

export function fixtureAccountTemplate(sandbox: Sandbox): string {
  return path.join(sandbox.root, 'account-template')
}

/** Fresh, local metadata uses the runtime's supported disk-cache seams. */
export function seedFixtureMetadata(home: string): void {
  const cache = path.join(home, 'cache')
  fs.mkdirSync(cache, { recursive: true, mode: 0o700 })
  fs.copyFileSync(path.resolve(import.meta.dirname, '../../../website/static/api/model-catalog.json'), path.join(cache, 'model_catalog.json'))
  fs.writeFileSync(path.join(home, 'models_dev_cache.json'), JSON.stringify({ aino: { id: 'aino', name: 'Aino fixture',
    models: { 'fixture-tool-model': { id: 'fixture-tool-model', tool_call: true,
      limit: { context: 64000, output: 8192 }, modalities: { input: ['text'], output: ['text'] } } } } }), { mode: 0o600 })
  // This fixture installs no marketplace plugins; in-tree capabilities remain available.
  fs.writeFileSync(path.join(cache, 'plugin-catalog.json'), JSON.stringify({ entries: [], removed: [] }), { mode: 0o600 })
  const profiles = path.join(home, 'profiles')

  for (const entry of fs.existsSync(profiles) ? fs.readdirSync(profiles, { withFileTypes: true }) : []) {
    if (entry.isDirectory()) { seedFixtureMetadata(path.join(profiles, entry.name)) }
  }
}

/** Fixture-owned config only: no history or inherited user data is migrated. */
export function accountTemplateBootstrap(env: Record<string, string>): string {
  if (!env.AINO_E2E_ACCOUNT_TEMPLATE) { return '' }

  return `
const templateFs = require('node:fs'), templatePath = require('node:path');
function seedFixtureAccountHomes() {
  const accounts = templatePath.join(${JSON.stringify(env.HERMES_DESKTOP_USER_DATA_DIR)}, 'account-workspaces');
  function seed(source, destination) {
    templateFs.mkdirSync(destination, { recursive: true, mode: 0o700 });
    for (const entry of templateFs.readdirSync(source, { withFileTypes: true })) {
      const from = templatePath.join(source, entry.name), to = templatePath.join(destination, entry.name);
      if (entry.isDirectory()) seed(from, to);
      else if (entry.isFile() && !templateFs.existsSync(to)) templateFs.copyFileSync(from, to, templateFs.constants.COPYFILE_EXCL);
    }
  }
  if (!templateFs.existsSync(accounts)) return;
  for (const entry of templateFs.readdirSync(accounts, { withFileTypes: true })) {
    if (entry.isDirectory()) seed(${JSON.stringify(env.AINO_E2E_ACCOUNT_TEMPLATE)}, templatePath.join(accounts, entry.name, 'home'));
  }
}
require('electron').app.on('browser-window-created', seedFixtureAccountHomes);
`
}
