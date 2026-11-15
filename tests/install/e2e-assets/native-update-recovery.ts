// Recovery checkpoints reuse the installed-account smoke and real update clicks.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { runDesktopChatSmoke } from '../../../tests-js/scripts/desktop-chat-smoke.ts'
import { readInstallationCommit } from '../../../tests-js/scripts/desktop-smoke-process.ts'
import { _electron, type ElectronApplication, expect, type Page, z } from '../../../tests-js/scripts/e2e-driver-deps.ts'

import { runInstalledDesktopSmoke } from './desktop-smoke.ts'

const require = createRequire(import.meta.url)
const { openAbout, waitForUpdate } = require('./update-ui.cjs')
const { prepareWindowForInput } = require('./window-input.cjs')

/** The fault affects the actual HTTP fixture, never the app's update bridge. */
export async function withUnavailableDescriptor<T>(descriptor: string, observe: () => Promise<T>): Promise<T> {
  const held = `${descriptor}.recovery-held`
  fs.renameSync(descriptor, held)
  try { return await observe() } finally { fs.renameSync(held, descriptor) }
}

interface PreparationProof {
  beforePid: number
  afterPid: number
  error: string
  pendingRelaunch: boolean
  chat: { status: string; turnComplete: boolean }
}

export function assertPreparationRecovery(proof: PreparationProof): void {
  if (proof.beforePid !== proof.afterPid) { throw new Error('Recovery must keep the same OLD process') }
  if (!proof.error.includes('App Installer descriptor download failed: HTTP 404')) { throw new Error('Native descriptor HTTP 404 was not observed') }
  if (proof.pendingRelaunch !== false) { throw new Error('Failed preparation registered a pending relaunch') }
  if (proof.chat.status !== 'passed' || !proof.chat.turnComplete) { throw new Error('Recovery requires another completed chat') }
}

const absolutePath = z.string().refine(path.isAbsolute, 'Expected an absolute disposable path')
const recoveryOptions = z.object({
  scenario: z.enum(['preparation-failure', 'manual-old-reopen']), exe: absolutePath, root: absolutePath,
  home: absolutePath, 'user-data': absolutePath, out: absolutePath, 'expect-commit': z.string().regex(/^[0-9a-f]{40}$/),
  'mock-url': z.string(), descriptor: absolutePath.optional(),
})
type RecoveryOptions = z.infer<typeof recoveryOptions>

async function preparationFailure(app: ElectronApplication, page: Page, options: RecoveryOptions) {
  const beforePid = await app.evaluate(() => process.pid)
  const ready = path.join(options.out, 'preparation-chat-ready.json')
  fs.writeFileSync(`${ready}.tmp`, JSON.stringify({ pid: beforePid, exe: options.exe }) + '\n')
  fs.renameSync(`${ready}.tmp`, ready)
  await expect.poll(() => fs.existsSync(path.join(options.out, 'preparation-feed-ready')), { timeout: 120_000 }).toBe(true)
  const log = (message: string): void => { console.log(`[native-recovery] ${message}`) }
  const shot = (target: Page, name: string) => target.screenshot({ path: path.join(options.out, `${name}.png`) })
  await openAbout(page, { prepare: () => prepareWindowForInput(app, page), log, shot })
  const update = await waitForUpdate(page, { log, shot })
  const error = await withUnavailableDescriptor(options.descriptor!, async () => {
    await update.click()
    const message = page.getByText(/App Installer descriptor download failed: HTTP 404/).first()
    await message.waitFor({ state: 'visible', timeout: 60_000 })
    await shot(page, 'preparation-failed')
    return await message.innerText()
  })
  await page.getByRole('button', { name: /^(?:Not now|暂不)$/, exact: true }).click()
  // Settings can cover the composer after its error dialog closes.
  await page.getByRole('button', { name: /^(?:Close settings|关闭设置)$/, exact: true }).click()
  const chat = await runDesktopChatSmoke(page, { phase: 'old', outDir: path.join(options.out, 'after-failure'),
    mockUrl: options['mock-url'], expectCommit: options['expect-commit'], provenanceCommit: readInstallationCommit(options.root, 'bundled') })
  const proof = { beforePid, afterPid: await app.evaluate(() => process.pid), error, chat,
    pendingRelaunch: fs.existsSync(path.join(options['user-data'], 'pending-update-relaunch.json')) }
  assertPreparationRecovery(proof)
  return proof
}

export async function runNativeRecovery(options: RecoveryOptions, smoke: typeof runInstalledDesktopSmoke = runInstalledDesktopSmoke): Promise<void> {
  const receipt = path.join(options.out, 'recovery.json')
  fs.mkdirSync(options.out, { recursive: true })
  try {
    if (options.scenario === 'preparation-failure' && !options.descriptor) { throw new Error('Preparation recovery requires its local descriptor') }
    await smoke({ ...options, origin: 'bundled', phase: 'old', 'platform-account': true,
      'require-existing-account': true, 'keep-signed-in': true },
      launch => _electron.launch(launch), options.scenario === 'preparation-failure' ?
        (app, page) => preparationFailure(app, page, options) : undefined)
    const chat = JSON.parse(fs.readFileSync(path.join(options.out, 'desktop-chat-old.json'), 'utf8'))
    fs.writeFileSync(receipt, JSON.stringify({ status: 'passed', scenario: options.scenario,
      automaticRecovery: false, manualReopen: options.scenario === 'manual-old-reopen',
      expectedCommit: options['expect-commit'], running: chat.running, preservation: chat.preservation,
      checkpoint: chat.checkpoint, account: chat.account, chatReceipt: 'desktop-chat-old.json' }, null, 2) + '\n')
  } catch (error) {
    fs.writeFileSync(receipt, JSON.stringify({ status: 'failed', scenario: options.scenario, error: String(error) }, null, 2) + '\n')
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'win32') { throw new Error('Disposable Windows Actions runner required') }
  const { values } = parseArgs({ options: Object.fromEntries(
    ['scenario', 'exe', 'root', 'home', 'user-data', 'out', 'expect-commit', 'mock-url', 'descriptor'].map(key => [key, { type: 'string' as const }])) })
  try { await runNativeRecovery(recoveryOptions.parse(values)) } catch (error) { console.error(String(error)); process.exitCode = 1 }
}
