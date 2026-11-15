import { spawnSync } from 'node:child_process'
import { randomUUID, X509Certificate } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { startHttpsEdge } from '../../../apps/desktop/e2e/update/github-edge.ts'
import { resolveDesktopHermesHome } from '../../../apps/desktop/electron/data-paths.mjs'
import { applyBundleEnvironment } from '../../../apps/desktop/scripts/bundle-env.mjs'
import { bundledUpgradeHealth } from '../../../tests-js/scripts/bundled-upgrade-probe.ts'
import { type ChatIdentity, readChatIdentity, runDesktopChatSmoke, waitForChatReady } from '../../../tests-js/scripts/desktop-chat-smoke.ts'
import { assertBackendOrigin, localBackendProcess, readBundledBundleEnv, readInstallationCommit, reusedDesktopBuildCommit } from '../../../tests-js/scripts/desktop-smoke-process.ts'
import { desktopToolMarker } from '../../../tests-js/scripts/desktop-tool-smoke.ts'
import { _electron, type ElectronApplication, type Page, z } from '../../../tests-js/scripts/e2e-driver-deps.ts'
import { validateMockUrl, writeEnvFile, writeMockProviderConfig } from '../../../tests-js/scripts/mock-provider-config.ts'
import { type MockServer, startMockServer } from '../../../tests-js/scripts/mock-server.ts'
import { signInPlatformFixture, startPlatformServer } from '../../../tests-js/scripts/platform-account-fixture.ts'

import { isolatedElectronArgs, type SmokeEnvironment, smokeEnvironment, within } from './smoke-env.mjs'
import { sourceRuntimeSettleCommand } from './source-runtime-settle.mjs'
import { type FixtureAccount, fixtureAccountForHome } from './windows-user-state.mjs'

const require = createRequire(import.meta.url)
const { observeProcessClose }: { observeProcessClose: (child: ReturnType<ElectronApplication['process']>) => (timeoutMs?: number) => Promise<void> } = require('./process-close.cjs')
const { pickAppWindow }: { pickAppWindow: (app: ElectronApplication, log: (message: string) => void) => Promise<Page> } = require('./update-ui.cjs')
const { prepareWindowForInput }: { prepareWindowForInput: (app: ElectronApplication, page: Page) => Promise<void> } = require('./window-input.cjs')

const absolutePath = z.string().refine(path.isAbsolute, 'Expected an absolute path')
const optionsSchema = z.object({
  exe: absolutePath, root: absolutePath, origin: z.enum(['source', 'bundled']),
  home: absolutePath, 'user-data': absolutePath, out: absolutePath,
  phase: z.enum(['old', 'new', 'installed']), 'expect-commit': z.string().regex(/^[0-9a-f]{40}$/),
  'launch-spec': absolutePath.optional(), 'mock-url': z.string().optional(),
  'platform-account': z.boolean().optional(), 'tool-smoke': z.boolean().optional(), appimage: absolutePath.optional(),
  'native-handoff': z.boolean().optional(),
  'keep-signed-in': z.boolean().optional(),
  'require-existing-account': z.boolean().optional(),
})
type SmokeOptions = z.infer<typeof optionsSchema>

const launchSpecSchema = z.object({
  argv: z.array(z.string()).min(1), cwd: absolutePath,
  // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- This is the existing launch-capture wire field.
  env: z.record(z.string(), z.string()), matchedShape: z.enum(['source', 'packaged']),
})

interface Launch {
  chromiumSandbox: true
  executablePath: string
  args: string[]
  cwd: string
  env: SmokeEnvironment
}

interface RunningDesktop {
  sandboxDisabled: boolean
  appimage?: string
  appdir?: string
  pid: number
  executable: string
  resources: string
  userData: string
  home: string
}

interface ElectronProcess extends NodeJS.Process {
  resourcesPath: string
}

export { smokeEnvironment }

/** The bundled app resolves its Hermes home the same way electron/data-paths.ts does:
 * an explicit HERMES_HOME wins, but a bundle-env clear (HERMES_HOME=null) empties it before
 * this runs, and the HERMES_DESKTOP_USER_DATA_DIR branch then resolves <userData>/hermes-home.
 * Seed both so the driver works against baked-clear bundles and plain source launches. */
export function candidateSmokeHermesHomes(home: string, userData: string): string[] {
  const fallback = path.join(userData, 'hermes-home')
  return home === fallback ? [home] : [home, fallback]
}

/** The home the app will resolve for a bundled artifact whose env defaults/clears
 * are known from its stamp. Replays the bundle banner over the launch env, then
 * runs the same resolver the app runs, so the driver can seed the home before
 * boot instead of pinning HERMES_HOME and hoping the artifact honors it. */
export function predictSmokeHermesHome(
  launchEnv: NodeJS.ProcessEnv,
  bundleEnv: Record<string, string | null>,
  platform: NodeJS.Platform = process.platform,
  home: string = platform === 'linux' ? launchEnv.HOME || os.homedir() : os.homedir(),
): string {
  const effective = applyBundleEnvironment(launchEnv, bundleEnv)
  return resolveDesktopHermesHome({ home, env: effective, platform, directoryExists: (): boolean => false, readWindowsHome: (): null => null })
}

/** Fresh installs require an empty home. Only an upgrade may reuse the exact
 * isolated home supplied by its caller; never seed another existing profile. */
function assertSmokeHermesHome(home: string, options: SmokeOptions): void {
  const ownUpgrade = options.phase === 'new' && path.resolve(home) === path.resolve(options.home)

  if (ownUpgrade || !fs.existsSync(home)) {
    return
  }
  const entries = fs.readdirSync(home)
  if (entries.length > 0) {
    throw new Error(`Predicted Hermes home ${home} is not empty (${entries.length} entries); refusing to seed an existing profile`)
  }
}

export function resolveSmokeLaunch(options: SmokeOptions): Launch {
  const spec = options['launch-spec'] ? launchSpecSchema.parse(JSON.parse(fs.readFileSync(options['launch-spec'], 'utf8').replace(/^\uFEFF/, ''))) : null
  const env = smokeEnvironment({ ...process.env, ...spec?.env }, options.home, options['user-data'])
  let args: string[] = []
  let cwd = env.HOME!
  if (spec) {
    if (options.origin !== 'source') {
      throw new Error('A captured source launch specification cannot select a bundled backend')
    }
    if (!within(options.root, spec.cwd)) {
      throw new Error('Source launch cwd is outside the expected installation')
    }
    cwd = spec.cwd
    // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- This is the existing launch-capture wire field.
    if (spec.matchedShape === 'source') {
      const index = spec.argv.indexOf('electron')
      if (index < 0 || !spec.argv.includes('.')) {
        throw new Error('Unsupported captured source launch shape')
      }
      args = [spec.cwd, ...spec.argv.slice(index + 1).filter((arg: string): boolean => arg !== '.')]
    } else {
      if (fs.realpathSync(spec.argv[0]) !== fs.realpathSync(options.exe)) {
        throw new Error('Launch spec executable differs from --exe')
      }
      args = spec.argv.slice(1)
    }
    const editableRoot = spec.env.HERMES_PYTHON_SRC_ROOT
    if (editableRoot) {
      if (!path.isAbsolute(editableRoot) || fs.realpathSync(editableRoot) !== fs.realpathSync(options.root)) {
        throw new Error('Captured HERMES_PYTHON_SRC_ROOT differs from the expected source installation')
      }
      env.HERMES_PYTHON_SRC_ROOT = editableRoot
    }
    // Retain the product-selected source interpreter, not the driver's activated Python.
    for (const key of ['HERMES_DESKTOP_PYTHON', 'HERMES_DESKTOP_HERMES', 'HERMES_DESKTOP_HERMES_ROOT']) {
      const value = spec.env[key]
      if (value) {
        if (!path.isAbsolute(value) || (key !== 'HERMES_DESKTOP_PYTHON' && !within(options.root, value))) {
          throw new Error(`Captured ${key} escapes the expected source installation`)
        }
        fs.accessSync(value)
        env[key] = value
      }
    }
  }
  if (args.some((arg: string): boolean => /^--(?:no-sandbox|disable-setuid-sandbox)(?:=|$)/.test(arg))) {
    throw new Error('Desktop smoke requires Chromium sandboxing')
  }
  if (options['native-handoff']) { args = isolatedElectronArgs([...args, '--force-renderer-accessibility'], options['user-data']) }
  return { chromiumSandbox: true, executablePath: smokeExecutable(options), args, cwd, env }
}

function smokeExecutable(options: SmokeOptions): string {
  if (options.appimage && (process.platform !== 'linux' || options.origin !== 'bundled')) {
    throw new Error('AppImage launch requires a bundled Linux installation')
  }
  return options.appimage ?? options.exe
}

function runningOptions(options: SmokeOptions, running: RunningDesktop): SmokeOptions {
  return options.appimage ? { ...options, root: path.join(running.resources, 'agent-payload'), exe: running.executable } : options
}

/** Select local through the persisted connection contract before any baked remote default can dial. */
function selectLocal(userData: string): void {
  const v1Path = path.join(userData, 'connection.json')
  const document = z.object({}).passthrough()
  const v1 = fs.existsSync(v1Path) ? document.parse(JSON.parse(fs.readFileSync(v1Path, 'utf8'))) : {}
  fs.writeFileSync(v1Path, JSON.stringify({ ...v1, mode: 'local' }), { mode: 0o600 })
  const v2Path = path.join(userData, 'connections.json')
  if (fs.existsSync(v2Path)) {
    const v2 = document.parse(JSON.parse(fs.readFileSync(v2Path, 'utf8')))
    fs.writeFileSync(v2Path, JSON.stringify({ ...v2, primary: 'local', launchMode: 'primary', lastUsed: 'local' }), { mode: 0o600 })
  }
}

interface BackendWindow extends Window {
  hermesDesktop?: {
    getConnection: () => Promise<{ baseUrl: string; mode?: string; logs: string[] }>
  }
}

async function backendConnection(page: Page): Promise<{ baseUrl: string; mode?: string; logs: string[] }> {
  return z.object({ baseUrl: z.string(), mode: z.string().optional(), logs: z.array(z.string()) }).parse(
    await page.evaluate(async (): Promise<{ baseUrl: string; mode?: string; logs: string[] }> => {
      // SAFETY: the desktop preload owns this bridge; its result is validated at the boundary.
      const bridge = (window as BackendWindow).hermesDesktop
      if (!bridge) { throw new Error('Desktop connection bridge is unavailable') }
      const { baseUrl, mode, logs } = await bridge.getConnection()
      return { baseUrl, mode, logs }
    }),
  )
}

function redact(text: string): string {
  return text.replace(/([?&](?:token|ticket|key)=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/((?:authorization|api[_ -]?key|token|secret|password)\s*[:=]\s*)(?:Bearer\s+)?[^\s,"']+/gi, '$1[redacted]')
}

function smokeErrorStack(error: unknown): string {
  return redact(error instanceof Error ? error.stack ?? String(error) : String(error))
}

function observerPayloadRoot(options: SmokeOptions): string | undefined {
  return options.origin === 'bundled' ? options.root : undefined
}

function observeUpgradeGateway(options: SmokeOptions, identity: ChatIdentity,
  connection: { baseUrl: string; mode?: string }, predictedHome: string | undefined): unknown {
  if (options.phase !== 'new' || options.origin !== 'bundled' || !options['platform-account']) { return undefined }
  const health = bundledUpgradeHealth({ root: options.root, home: predictedHome ?? options.home, commit: options['expect-commit'], identity, connection })
  fs.writeFileSync(path.join(options.out, 'backend-health.json'), JSON.stringify(health, null, 2) + '\n')

  return health
}

function captureBackendLogs(homes: readonly string[], outDir: string, phase: string): void {
  for (const home of homes) {
    for (const name of ['desktop.log', 'errors.log', 'agent.log']) {
      const filename = path.join(home, 'logs', name)
      if (fs.existsSync(filename)) {
        const suffix = homes.length > 1 && home !== homes[0] ? `-${path.basename(path.dirname(home))}` : ''
        fs.writeFileSync(path.join(outDir, `desktop-${phase}-${name}${suffix}`), redact(fs.readFileSync(filename, 'utf8')))
      }
    }
  }
}

/**
 * A source update can be current under the CI driver's inherited environment
 * but still owe a dependency/product refresh in the clean app environment.
 * If Electron owns that first clean startup, its backend replaces the running
 * bundle and Electron intentionally relaunches; Playwright then reports the
 * expected renderer teardown as "Target crashed/closed". Settle the source
 * runtime before Electron starts, using the exact environment it will inherit.
 */
export function settleSourceDesktopRuntime(options: SmokeOptions, launch: Launch): void {
  if (options.origin !== 'source' || (options.phase !== 'old' && options.phase !== 'new')) { return }

  const invocation = sourceRuntimeSettleCommand(options.root, launch.env)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.root, env: launch.env, encoding: 'utf8', timeout: 20 * 60_000,
    maxBuffer: 16 * 1024 * 1024, windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  })

  const transcript = [result.stdout, result.stderr].filter(Boolean).join('')
  fs.writeFileSync(path.join(options.out, `desktop-source-settle-${options.phase}.log`), redact(transcript))
  if (result.error) { throw result.error }

  if (result.status !== 0) {
    throw new Error(`Source runtime settle failed: exit=${result.status}, signal=${result.signal}`)
  }
}

async function gracefulClose(app: ElectronApplication): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([app.close(), new Promise<never>((_resolve, reject): void => {
      timer = setTimeout((): void => reject(new Error('Desktop did not close gracefully')), 20_000)
    })])
  } finally {
    clearTimeout(timer)
  }
}

export function assertAppImageIdentity(running: Pick<RunningDesktop, 'appimage' | 'appdir' | 'executable' | 'resources'>, options: Pick<SmokeOptions, 'appimage' | 'exe' | 'root'>): void {
  if (!options.appimage || !running.appimage || fs.realpathSync(running.appimage) !== fs.realpathSync(options.appimage)
      || !running.appdir || !within(running.appdir, running.executable)
      || !within(running.appdir, running.resources) || path.basename(running.executable) !== path.basename(options.exe)) {
    throw new Error('Running AppImage does not match the selected artifact and executable')
  }
  const extractedStamp = fs.readFileSync(path.join(options.root, '..', 'install-stamp.json'))
  const mountedStamp = fs.readFileSync(path.join(running.resources, 'install-stamp.json'))
  if (!extractedStamp.equals(mountedStamp)) { throw new Error('Mounted AppImage stamp differs from the extracted artifact') }
}

export async function verifyRunningDesktop(app: ElectronApplication, options: SmokeOptions, launch: Launch, predictedHome?: string): Promise<RunningDesktop> {
  const running = await app.evaluate(({ app: electronApp }): RunningDesktop => {
    // SAFETY: this callback runs in Electron main, whose process includes resourcesPath.
    const runtime = process as ElectronProcess
    return { pid: runtime.pid, executable: runtime.execPath, resources: runtime.resourcesPath, userData: electronApp.getPath('userData'), home: electronApp.getPath('home'),
      appimage: runtime.env.APPIMAGE, appdir: runtime.env.APPDIR,
      sandboxDisabled: electronApp.commandLine.hasSwitch('no-sandbox') || electronApp.commandLine.hasSwitch('disable-setuid-sandbox') }
  })
  if (running.sandboxDisabled) { throw new Error('Running desktop disabled the Chromium sandbox') }
  // Chromium resolves DIR_HOME from the HOME env only on Linux; macOS
  // (NSHomeDirectory) and Windows (CSIDL_PROFILE) ignore it, so the home
  // equality is a contract only there. On those platforms the isolation proof
  // is the userData pin plus the seeded Hermes home the backend booted from.
  // Preservation only means anything when Electron actually opened the supplied
  // profile. A predicted backend home cannot waive the Chromium profile check.
  const homeHonored = !predictedHome && process.platform === 'linux'
      ? fs.realpathSync(running.home) === fs.realpathSync(launch.env.HOME!)
      : true
  if (fs.realpathSync(running.userData) !== fs.realpathSync(options['user-data']) || !homeHonored) {
    throw new Error('Desktop did not honor the isolated home and userData directories')
  }
  if (options.appimage) {
    assertAppImageIdentity(running, options)
    return running
  }
  if (fs.realpathSync(running.executable) !== fs.realpathSync(options.exe)) {
    throw new Error('Running Electron executable differs from --exe')
  }
  if (options.origin === 'bundled' && fs.realpathSync(path.join(running.resources, 'agent-payload')) !== fs.realpathSync(options.root)) {
    throw new Error('Running Electron resources differ from the expected payload root')
  }
  return running
}

function assertResolvedIdentity(identity: ChatIdentity, options: SmokeOptions, predictedHome: string | undefined): void {
  if (options.origin === 'source' && fs.realpathSync(identity.hermesRoot) !== fs.realpathSync(options.root)) {
    throw new Error('Desktop resolved a different source installation')
  }
  // A bundled artifact that bakes its own env resolves its home itself; the
  // app must report the home the driver predicted and seeded, not some other
  // (possibly real, pre-existing) profile.
  if (predictedHome) {
    if (!identity.hermesHome || fs.realpathSync(identity.hermesHome) !== fs.realpathSync(predictedHome)) {
      throw new Error(`Desktop resolved Hermes home ${identity.hermesHome ?? '(unreported)'} instead of the predicted ${predictedHome}`)
    }
  }
}

export type LaunchElectron = (launch: Parameters<typeof _electron.launch>[0]) => Promise<ElectronApplication>

interface NativeUpdateHandoff {
  out: string
  pid: number
  exe: string
  oldSha: string
  userData: string
  hermesHome: string
  env: NodeJS.ProcessEnv
  waitForProcessClose: (timeoutMs?: number) => Promise<void>
}

function writeHandoffReceipt(out: string, name: string, value: unknown): void {
  const file = path.join(out, name)
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(`${file}.tmp`, file)
}

/** OLD owns the fixture until the harness has observed the OS-owned NEW relaunch. */
export async function holdNativeUpdate(handoff: NativeUpdateHandoff): Promise<void> {
  const { out, waitForProcessClose, env, ...identity } = handoff
  const whitelist = ['HERMES_HOME', 'HERMES_DESKTOP_USER_DATA_DIR', 'HERMES_DESKTOP_SKIP_QUIT_CONFIRM',
    'NODE_USE_ENV_PROXY', 'NODE_EXTRA_CA_CERTS', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY']
  writeHandoffReceipt(out, 'native-relaunch-environment.json', Object.fromEntries(
    whitelist.flatMap(key => env[key] ? [[key, env[key]]] : [])))
  writeHandoffReceipt(out, 'old-chat-ready.json', identity)
  await waitForProcessClose(15 * 60_000)
  writeHandoffReceipt(out, 'old-process-closed.json', { ...identity, closed: true })
  const release = path.join(out, 'native-update-complete')
  await new Promise<void>((resolve, reject) => {
    const finish = (): void => {
      clearTimeout(timer)
      watcher.close()
      resolve()
    }
    const watcher = fs.watch(out, () => { if (fs.existsSync(release)) { finish() } })
    const timer = setTimeout(() => {
      watcher.close()
      reject(new Error('Native NEW verification did not release the OLD account fixture'))
    }, 20 * 60_000)
    watcher.on('error', error => { clearTimeout(timer); watcher.close(); reject(error) })
    if (fs.existsSync(release)) { finish() }
  })
}

export async function prepareAccountFixture(enabled: boolean | undefined, out: string, env: SmokeEnvironment,
  login: { keepSignedIn?: boolean; allowExisting?: boolean; requireExisting?: boolean } = {}) {
  if (!enabled) { return undefined }
  const account = await startPlatformServer()
  try {
    const edge = await startHttpsEdge(out, { host: 'api.agentera.com.cn', handler: account.handler, tunnelOthers: false })
    Object.assign(env, edge.env, { NODE_USE_ENV_PROXY: '1', NODE_EXTRA_CA_CERTS: edge.caBundle })
    const proof = () => {
      const authenticatedProfileRequests = account.requests.filter(request => request.authenticatedProfile).length
      const freshAuthenticationRequests = account.requests.filter(request => request.method === 'POST'
        && request.path.startsWith('/api/v1/auth/') && request.path.split('?')[0] !== '/api/v1/auth/refresh').length
      return {
        mode: 'synthetic-account-real-native-bridge',
        requests: account.requests.map(({ method, path: route }) => ({ method, path: route })),
        authenticatedProfileRequests,
        freshAuthenticationRequests,
        existingSessionRequired: !!login.requireExisting,
        authenticationPreservedWithoutLogin: !!login.requireExisting && authenticatedProfileRequests > 0 && freshAuthenticationRequests === 0,
        proxyHits: edge.apiHits, proxyConnects: edge.connects, blockedConnects: edge.deniedConnects,
        certificates: ['ca.pem', 'leaf.pem'].map(name => {
          const certificate = new X509Certificate(fs.readFileSync(path.join(out, 'edge-ca', name)))
          return { name, subject: certificate.subject, issuer: certificate.issuer,
            fingerprint: certificate.fingerprint256, validFrom: certificate.validFrom, validTo: certificate.validTo }
        }),
        boundary: 'Local account fixture and custom mock inference; no production SMS, platform model lease or billing verification.'
      }
    }
    return {
      signIn: (app: ElectronApplication, page: Page) => signInPlatformFixture(app, page, login),
      proof,
      assertPreserved: () => {
        if (login.requireExisting && !proof().authenticationPreservedWithoutLogin) {
          throw new Error('Retained account did not authenticate without a new login')
        }
      },
      close: async () => {
        try { await edge.close() } finally {
          await account.close()
          fs.rmSync(path.join(out, 'edge-ca'), { recursive: true, force: true })
        }
      }
    }
  } catch (error) { await account.close(); throw error }
}

function seedSmokeProviders(options: SmokeOptions, predictedHome: string | undefined, mockUrl: string) {
  for (const home of new Set([...candidateSmokeHermesHomes(options.home, options['user-data']), ...(predictedHome ? [predictedHome] : [])])) {
    writeMockProviderConfig(home, mockUrl, options['platform-account'] ? '  language: en' : undefined)
    writeEnvFile(home, 'e2e-mock-key', mockUrl)
  }
}

function preservedSmokeAccount(options: SmokeOptions): FixtureAccount | null {
  if (!options['platform-account']) { return null }
  const home = resolveDesktopHermesHome({ home: options.home, accountWorkspace: {
    userData: options['user-data'], origin: 'https://api.agentera.com.cn', userId: '17'
  } })
  return fixtureAccountForHome({ root: options['user-data'], home })
}

export function seedSmokeAccount(options: SmokeOptions, predictedHome: string | undefined, mockUrl: string): string | undefined {
  if (!options['platform-account']) { return predictedHome }
  const preserved = preservedSmokeAccount(options)
  if (preserved) {
    if (preserved.baseUrl !== `${mockUrl}/v1`) { throw new Error('Preserved account mock endpoint differs from this journey') }
    return preserved.home
  }
  // Seed fixture config directly into this known account; shared history is never adopted.
  const accountHome = resolveDesktopHermesHome({ home: options.home, accountWorkspace: {
    userData: options['user-data'], origin: 'https://api.agentera.com.cn', userId: '17'
  } })
  assertSmokeHermesHome(accountHome, { ...options, home: accountHome })
  writeMockProviderConfig(accountHome, mockUrl, '  language: en')
  writeEnvFile(accountHome, 'e2e-mock-key', mockUrl)

  return accountHome
}

/** Read through the authenticated app's normal local API, including the Bot's own profile. */
export async function readPreservedAccountHistory(page: Page, account: FixtureAccount) {
  const scopes = [{ profile: 'default', sessionId: account.sessionIds[0] },
    { profile: account.profile, sessionId: account.sessionIds[1] }]
  const replies = await page.evaluate(async items => {
    const bridge = (window as unknown as { hermesDesktop: {
      api: (request: { path: string; profile: string; connectionId: string; method: string; timeoutMs: number }) => Promise<unknown>
    } }).hermesDesktop
    const rows = []
    for (const item of items) {
      const request = { profile: item.profile, connectionId: 'local', method: 'GET', timeoutMs: 60_000 }
      const config = await bridge.api({ ...request, path: '/api/config?include_defaults=false' })
      const history = await bridge.api({ ...request, path: `/api/sessions/${encodeURIComponent(item.sessionId)}/messages` })
      rows.push({ ...item, config, history })
    }
    return rows
  }, scopes)
  const schema = z.object({ profile: z.string(), sessionId: z.string(),
    config: z.object({ model: z.object({ default: z.string(), provider: z.string(), base_url: z.string() }) }),
    history: z.object({ session_id: z.string(), messages: z.array(z.object({ role: z.string(), content: z.string() })) }),
  })
  const sessions = z.array(schema).parse(replies).map(row => {
    const model = row.config.model
    if (model.default !== account.model || model.provider !== 'custom' || model.base_url !== account.baseUrl) {
      throw new Error(`Preserved ${row.profile} model configuration differs in the active account`)
    }
    const expected = [
      { role: 'user', content: `${account.displayName}：请保留我的历史记录。` },
      { role: 'assistant', content: `${account.displayName}：历史回答和模型设置应在升级后保留。` },
    ]
    if (row.history.session_id !== row.sessionId || expected.some(message => !row.history.messages.some(
      actual => actual.role === message.role && actual.content === message.content))) {
      throw new Error(`Preserved ${row.profile} historical messages are missing from the active account`)
    }
    return { profile: row.profile, sessionId: row.sessionId, model, messages: expected }
  })
  return { home: account.home, origin: account.origin, userId: account.userId, sessions }
}

export async function prepareSmokeWindow(
  app: ElectronApplication,
  account: Pick<NonNullable<Awaited<ReturnType<typeof prepareAccountFixture>>>, 'signIn'> | undefined,
  log: (message: string) => void
): Promise<Page> {
  let page = await pickAppWindow(app, log)
  page.on('pageerror', (error: Error): void => { log(error.message) })
  if (account) {
    // Native login retires this renderer; workspace-only IPC belongs to its replacement.
    page = await account.signIn(app, page)
    page.on('pageerror', (error: Error): void => { log(error.message) })
  }
  await prepareWindowForInput(app, page)

  return page
}

function assertNativeHandoffOptions(options: SmokeOptions): void {
  if (options['native-handoff'] && (options.phase !== 'old' || options.origin !== 'bundled' || !options['platform-account'])) {
    throw new Error('Native handoff requires OLD bundled platform-account smoke')
  }
}

async function prepareAccountLaunch(options: SmokeOptions, launch: Launch) {
  const preserved = preservedSmokeAccount(options)
  const account = await prepareAccountFixture(options['platform-account'], options.out, launch.env, {
    keepSignedIn: options['native-handoff'] || options['keep-signed-in'], allowExisting: !!preserved,
    requireExisting: options['require-existing-account'],
  })
  try {
    const bundleEnv = options.origin === 'bundled' ? readBundledBundleEnv(options.root) : undefined
    const predictedHome = bundleEnv ? predictSmokeHermesHome(launch.env, bundleEnv) : undefined
    // Check before the driver creates its sandbox folders inside this home.
    if (predictedHome && !(preserved && options.phase !== 'installed')) { assertSmokeHermesHome(predictedHome, options) }
    return { account, preserved, predictedHome }
  } catch (error) {
    await account?.close()
    throw error
  }
}

function observeNativeClose(options: SmokeOptions, app: ElectronApplication) {
  return options['native-handoff'] ? observeProcessClose(app.process()) : undefined
}

async function observePreservedHistory(options: SmokeOptions, page: Page, preserved: FixtureAccount | null) {
  if (!preserved) { return undefined }
  const proof = await readPreservedAccountHistory(page, preserved)
  fs.writeFileSync(path.join(options.out, `desktop-preserved-account-${options.phase}.json`), JSON.stringify(proof, null, 2) + '\n')
  return proof
}

interface SmokeCompletion {
  result: unknown
  running: RunningDesktop
  identity: ChatIdentity
  env: SmokeEnvironment
  waitForProcessClose: ReturnType<typeof observeNativeClose>
  account: Awaited<ReturnType<typeof prepareAccountFixture>>
}

async function completeSmokeWindow(options: SmokeOptions, app: ElectronApplication, completion: SmokeCompletion): Promise<void> {
  const receiptPath = path.join(options.out, `desktop-chat-${options.phase}.json`)
  const { result, running, identity, env, waitForProcessClose, account } = completion
  if (waitForProcessClose) {
    fs.writeFileSync(receiptPath, `${JSON.stringify(result, null, 2)}\n`)
    await holdNativeUpdate({ out: options.out, pid: running.pid, exe: running.executable, oldSha: options['expect-commit'],
      userData: running.userData, hermesHome: identity.hermesHome!, env, waitForProcessClose })
    account?.assertPreserved()
    fs.writeFileSync(path.join(options.out, 'native-account-lifetime.json'), JSON.stringify(account?.proof(), null, 2) + '\n')
    return
  }
  await gracefulClose(app)
  fs.writeFileSync(receiptPath, `${JSON.stringify(result, null, 2)}\n`)
}

// `launchApp` is a parameter so a test can substitute a failing launcher and
// exercise the seeding that happens before the launch without touching Playwright.
export async function runInstalledDesktopSmoke(options: SmokeOptions, launchApp: LaunchElectron = (launch) => _electron.launch(launch),
  checkpoint?: (app: ElectronApplication, page: Page) => Promise<unknown>): Promise<void> {
  assertNativeHandoffOptions(options)
  const out = options.out
  fs.mkdirSync(out, { recursive: true })
  const receiptPath = path.join(out, `desktop-chat-${options.phase}.json`)
  let mock: MockServer | undefined
  let app: ElectronApplication | undefined
  let page: Page | undefined
  let predictedHome: string | undefined
  let account: Awaited<ReturnType<typeof prepareAccountFixture>>
  const consoleLines: string[] = []
  try {
    fs.accessSync(options.exe, fs.constants.X_OK)
    fs.accessSync(options.root)
    const launch: Launch = resolveSmokeLaunch(options)
    const prepared = await prepareAccountLaunch(options, launch)
    account = prepared.account
    predictedHome = prepared.predictedHome

    fs.mkdirSync(options.home, { recursive: true })
    fs.mkdirSync(options['user-data'], { recursive: true })
    fs.mkdirSync(launch.env.HOME!, { recursive: true })
    // Electron resolves shell folders before app 'ready': Windows SHGetFolderPath
    // fails (and applyDesktopIdentity crashes the process) when the roaming/local
    // AppData dirs named by the sandboxed USERPROFILE/APPDATA do not exist. The
    // XDG dirs serve the same role for Linux/Chromium.
    for (const dir of [launch.env.APPDATA, launch.env.LOCALAPPDATA, launch.env.XDG_CONFIG_HOME,
      launch.env.XDG_DATA_HOME, launch.env.XDG_CACHE_HOME]) {
      fs.mkdirSync(dir, { recursive: true })
    }
    settleSourceDesktopRuntime(options, launch)
    selectLocal(options['user-data'])
    if (!options['mock-url']) { mock = await startMockServer() }
    const mockUrl = validateMockUrl(options['mock-url'] ?? mock!.url)
    // A bundle-env HERMES_HOME clear (see candidateSmokeHermesHomes) can make the
    // app resolve a different home than --home, so every candidate gets the mock
    // provider config and .env. When the artifact's stamp carries its baked
    // bundle env, predict the home the app will actually resolve and seed that
    // too, refusing to seed a non-empty one.
    seedSmokeProviders(options, predictedHome, mockUrl)
    predictedHome = seedSmokeAccount(options, predictedHome, mockUrl)
    app = await launchApp({ ...launch, timeout: 120_000 })
    const waitForProcessClose = observeNativeClose(options, app)
    app.process().stdout?.on('data', (chunk: Buffer): void => { consoleLines.push(redact(chunk.toString())) })
    app.process().stderr?.on('data', (chunk: Buffer): void => { consoleLines.push(redact(chunk.toString())) })

    page = await prepareSmokeWindow(app, account, (message: string): void => { consoleLines.push(redact(message)) })
    await waitForChatReady(page)
    const running = await verifyRunningDesktop(app, options, launch, predictedHome)
    options = runningOptions(options, running)
    const connection = await backendConnection(page)
    const base = new URL(connection.baseUrl)
    if (connection.mode !== 'local' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
      throw new Error('Required local backend was replaced by a remote connection')
    }
    const identity = await readChatIdentity(page)
    assertResolvedIdentity(identity, options, predictedHome)
    const preservation = await observePreservedHistory(options, page, prepared.preserved)
    // The ordinary host-attach path may reuse the updater's relaunched app's
    // backend, and `hermes gateway ensure` attaches to (or starts, detached) the
    // canonical gateway. Observe the ledger and gateway_state.json the app's home
    // resolves to (its machine root), not an arbitrary listener, and retain the
    // OS listener + installed-tree proof below.
    fs.writeFileSync(path.join(out, `desktop-backend-${options.phase}.log`), connection.logs.map(redact).join('\n'))
    const backend = localBackendProcess(Number(base.port), running.pid, predictedHome ?? options.home,
      observerPayloadRoot(options))
    fs.writeFileSync(path.join(out, `desktop-backend-${options.phase}.json`), JSON.stringify({
      userData: running.userData, hermesHome: identity.hermesHome, expectedCommit: options['expect-commit'],
      actualCodeSha: backend.codeSha ?? null, backend: { ...backend, command: redact(backend.command) },
    }, null, 2) + '\n')
    // `identity.hermesRoot` was asserted against options.root above. For a listener that
    // descends from this app process, on a platform that cannot read the backend's own
    // environment, those two facts are the available evidence; a ledger-attached host
    // backend is not tied to the app by ancestry and must prove its tree itself; a canonical
    // gateway whose cwd is unreadable must report the installed commit.
    const provenanceCommit = readInstallationCommit(options.root, options.origin)
    assertBackendOrigin(backend, options.root, options.origin, { appReportedRoot: identity.hermesRoot, installedCommit: provenanceCommit })
    if (provenanceCommit !== options['expect-commit']) { throw new Error('Installed commit differs from --expect-commit') }
    const gatewayHealth = observeUpgradeGateway(options, identity, connection, predictedHome)
    // Trace only chat actions. Connection probes can return credential-bearing logs.
    await app.context().tracing.start({ screenshots: true, snapshots: false, sources: false })
    const reusedBuildCommit = reusedDesktopBuildCommit(options.root, options.origin, provenanceCommit)
    const chat = await runDesktopChatSmoke(page, { mockUrl, phase: options.phase, outDir: out, expectCommit: options['expect-commit'], provenanceCommit, reusedBuildCommit })
    const checkpointProof = await checkpoint?.(app, page)
    let tool
    if (options['tool-smoke']) {
      const marker = desktopToolMarker(identity, options.home, predictedHome)
      const content = `Native tool verified ${options['expect-commit']} ${randomUUID()}`
      const toolChat = await runDesktopChatSmoke(page, { mockUrl, phase: options.phase,
        outDir: path.join(out, 'tool'), expectCommit: options['expect-commit'], provenanceCommit, reusedBuildCommit,
        prompt: `E2E_CALL(write_file)[${JSON.stringify({ path: marker, content })}]`, expectedReply: 'E2E_CALL_RESULT:' })
      if (fs.readFileSync(marker, 'utf8') !== content) { throw new Error('Native write_file did not produce the requested marker') }
      tool = { status: 'passed', name: 'write_file', marker, content, chat: toolChat }
    }
    fs.writeFileSync(receiptPath, `${JSON.stringify({ ...chat, status: 'closing' }, null, 2)}\n`)
    account?.assertPreserved()
    const result = { ...chat, tool, gatewayHealth, preservation, checkpoint: checkpointProof, account: account?.proof(), origin: options.origin, root: options.root, executable: options.exe, running, predictedHome,
      localModeConfigured: true, backend: { ...backend, command: redact(backend.command) }, launchKind: options.phase === 'new' ? 'post-update-launch' : 'installed-launch' }
    await app.context().tracing.stop({ path: path.join(out, `desktop-chat-${options.phase}.zip`) })
    await completeSmokeWindow(options, app, { result, running, identity, env: launch.env, waitForProcessClose, account })
    app = undefined
  } catch (error) {
    if (page) { await page.screenshot({ path: path.join(out, `desktop-chat-${options.phase}-failed.png`) }).catch((): void => {}) }
    if (app) { await app.context().tracing.stop({ path: path.join(out, `desktop-chat-${options.phase}-failed.zip`) }).catch((): void => {}) }
    fs.writeFileSync(receiptPath, `${JSON.stringify({ status: 'failed', phase: options.phase, origin: options.origin, root: options.root,
      executable: options.exe, expectedCommit: options['expect-commit'], error: redact(String(error)),
      stack: smokeErrorStack(error),
      account: account?.proof() }, null, 2)}\n`)
    throw error
  } finally {
    fs.writeFileSync(path.join(out, `desktop-app-${options.phase}.log`), consoleLines.join('\n'))
    try {
      captureBackendLogs([...new Set([...candidateSmokeHermesHomes(options.home, options['user-data']), ...(predictedHome ? [predictedHome] : [])])], out, options.phase)
    } finally {
      if (app) { await gracefulClose(app).catch((error: Error): void => { console.error(redact(error.message)) }) }
      if (mock) { await mock.close() }
      await account?.close()
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: {
    exe: { type: 'string' }, root: { type: 'string' }, origin: { type: 'string' }, home: { type: 'string' },
    'user-data': { type: 'string' }, out: { type: 'string' }, phase: { type: 'string' },
    'expect-commit': { type: 'string' }, 'launch-spec': { type: 'string' }, 'mock-url': { type: 'string' },
    'platform-account': { type: 'boolean' }, 'tool-smoke': { type: 'boolean' }, appimage: { type: 'string' },
    'native-handoff': { type: 'boolean' },
    'keep-signed-in': { type: 'boolean' },
    'require-existing-account': { type: 'boolean' },
  } })

  // When the app exits before printing its debugger line, Playwright's Electron.launch rejects
  // the awaited watcher and leaves its sibling stderr watchers' rejections unhandled. Without a
  // listener Node dies on those first, so the catch below never writes the failed receipt or the
  // launch call log (the app's exit code and stderr). Still fail the run.
  process.on('unhandledRejection', (reason: unknown): void => {
    console.error(`unhandled rejection: ${redact(String(reason))}`)
    process.exitCode = 1
  })

  try {
    await runInstalledDesktopSmoke(optionsSchema.parse(values))
  } catch (error) {
    console.error(redact(String(error)))
    process.exitCode = 1
  }
}
