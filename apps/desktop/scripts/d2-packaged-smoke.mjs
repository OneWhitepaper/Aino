/**
 * D2's one-shot local packaged-app smoke.
 *
 * This intentionally does not build or publish. The caller supplies a new
 * electron-builder --dir output under a mktemp directory. The wrapper only
 * applies macOS' network sandbox before exec'ing the real packaged binary;
 * app.isPackaged and all production origin guards therefore remain intact.
 */
/* global document, window */
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { _electron } from '@playwright/test'
import { isMain } from './utils.mjs'

const APP_NAME = 'Aino'
const FATAL_BOOT_LOG = /(?:uncaught exception|unhandled rejection|render process gone|did-fail-load|no queryclient set|something broke in the interface)/i
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const PERSONAL_CREDENTIAL_PATHS = ['.aws', '.config', '.gnupg', '.hermes', '.local/share/keyrings', '.local/share/python_keyring', '.ssh']
const DEFAULT_COMMAND_TIMEOUT_MS = 20_000
const PROBE_TIMEOUT_MS = 5_000
const ARCHIVE_TIMEOUT_MS = 120_000
const SIGNING_ASSESSMENT_TIMEOUT_MS = 30_000
let processEvidence = null

function errorEvidence(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack ?? null }
  }

  return { name: typeof error, message: String(error), stack: null }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

// Playwright can surface an Electron helper crash after its launch promise has
// escaped the normal try/finally. Preserve the failure but leave its evidence
// on disk before Node applies its normal nonzero uncaught-exception exit.
process.on('uncaughtExceptionMonitor', (error, origin) => {
  if (!processEvidence) return

  writeJson(path.join(processEvidence.evidenceRoot, 'uncaught-exception.json'), {
    observedAt: new Date().toISOString(),
    origin,
    error: errorEvidence(error),
  })
})

process.once('exit', code => {
  if (!processEvidence) return

  writeJson(path.join(processEvidence.evidenceRoot, 'process-exit.json'), {
    finishedAt: new Date().toISOString(),
    code,
  })
})

function fail(message) {
  throw new Error(message)
}

function readOption(name) {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? '' : process.argv[index + 1]

  if (!value || value.startsWith('--')) {
    fail(`Missing required ${name} value`)
  }

  return path.resolve(value)
}

function isWithin(root, child) {
  const relative = path.relative(root, child)

  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function assertD2Workspace(artifactRoot, evidenceRoot) {
  const root = path.dirname(artifactRoot)
  const tempRoots = new Set([
    fs.realpathSync(commandText('/usr/bin/getconf', ['DARWIN_USER_TEMP_DIR'], 'Resolve DARWIN_USER_TEMP_DIR')),
    fs.realpathSync('/private/tmp'),
  ])

  if (!tempRoots.has(fs.realpathSync(path.dirname(root))) || !path.basename(root).startsWith('aino-d2-packaged-')) {
    fail('Artifact root must be directly inside DARWIN_USER_TEMP_DIR or /private/tmp with the aino-d2-packaged- prefix')
  }

  if (!isWithin(root, evidenceRoot)) {
    fail('Evidence root must be inside the same D2 mktemp directory')
  }

  if (artifactRoot.includes(`${path.sep}release${path.sep}`) || artifactRoot.startsWith('/Applications/')) {
    fail('D2 accepts only its fresh mktemp artifact, never release/ or an installed application')
  }
}

function commandResult(command, args, { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, cwd } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGTERM' })

  return {
    command: [command, ...args],
    timeoutMs,
    exitCode: result.status,
    signal: result.signal,
    timedOut: result.error?.code === 'ETIMEDOUT',
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message ?? null,
  }
}

function commandText(command, args, label, options) {
  const result = commandResult(command, args, options)

  if (result.exitCode !== 0) {
    fail(`${label} failed: ${result.stderr.trim() || result.stdout.trim() || result.error || 'unknown error'}`)
  }

  return result.stdout.trim()
}

function quotedPolicyPath(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function sandboxPolicy(personalHome = os.homedir()) {
  const deniedReads = [
    ...PERSONAL_CREDENTIAL_PATHS.map(relative => path.join(personalHome, relative)),
    path.join(personalHome, 'Library', 'Keychains'),
  ].map(directory => `(deny file-read* (subpath "${quotedPolicyPath(directory)}"))`)

  return [
    '(version 1)',
    '(allow default)',
    '(deny network-outbound)',
    // Playwright's Electron inspector transport is loopback-only. No other
    // outbound destination is allowed for the package smoke.
    '(allow network-outbound (remote ip "localhost:*"))',
    '(deny process-exec (literal "/usr/bin/security"))',
    ...deniedReads,
  ].join(' ')
}

function assertMarker(result, marker, label) {
  if (result.exitCode !== 0 || result.stdout.trim() !== marker) {
    fail(`${label} failed: ${result.stderr.trim() || result.stdout.trim() || result.error || 'unexpected result'}`)
  }
}

function proveWorkspaceGuard() {
  const tempRoot = fs.realpathSync(commandText('/usr/bin/getconf', ['DARWIN_USER_TEMP_DIR'], 'Resolve DARWIN_USER_TEMP_DIR'))
  const acceptedRoot = fs.mkdtempSync(path.join(tempRoot, 'aino-d2-packaged-'))
  const rejectedRoot = fs.mkdtempSync(path.join(tempRoot, 'aino-not-d2-packaged-'))

  try {
    const acceptedArtifact = path.join(acceptedRoot, 'artifact')
    const acceptedEvidence = path.join(acceptedRoot, 'evidence')
    fs.mkdirSync(acceptedArtifact)
    fs.mkdirSync(acceptedEvidence)
    assertD2Workspace(acceptedArtifact, acceptedEvidence)

    let rejected = false
    try {
      assertD2Workspace(path.join(rejectedRoot, 'artifact'), path.join(rejectedRoot, 'evidence'))
    } catch {
      rejected = true
    }
    if (!rejected) {
      fail('workspace guard accepted a non-D2 temporary prefix')
    }

    return { acceptedPrefix: true, rejectedPrefix: true }
  } finally {
    fs.rmSync(acceptedRoot, { recursive: true, force: true })
    fs.rmSync(rejectedRoot, { recursive: true, force: true })
  }
}

export async function proveSandboxGuards(policy) {
  const server = await new Promise((resolve, reject) => {
    const value = net.createServer(socket => socket.destroy())
    value.once('error', reject)
    value.listen(0, '127.0.0.1', () => resolve(value))
  })

  try {
    const port = server.address().port
    const loopback = commandResult('/usr/bin/sandbox-exec', [
      '-p', policy, process.execPath, '-e',
      `require('node:net').connect({host:'localhost',port:${port}}).once('connect',()=>{process.stdout.write('loopback-ok');process.exit(0)}).once('error',error=>{process.stderr.write(error.code||String(error));process.exit(10)})`,
    ], { timeoutMs: PROBE_TIMEOUT_MS })
    assertMarker(loopback, 'loopback-ok', 'sandbox loopback allowance proof')

    const outbound = commandResult('/usr/bin/sandbox-exec', [
      '-p', policy, process.execPath, '-e',
      "require('node:net').connect({host:'198.51.100.7',port:443}).once('connect',()=>process.exit(20)).once('error',error=>{if(error.code==='EPERM'||error.code==='EACCES'){process.stdout.write('network-denied');process.exit(0)}process.stderr.write(error.code||String(error));process.exit(21)});setTimeout(()=>process.exit(22),1000)",
    ], { timeoutMs: PROBE_TIMEOUT_MS })
    assertMarker(outbound, 'network-denied', 'sandbox nonloopback denial proof')

    const security = commandResult('/usr/bin/sandbox-exec', ['-p', policy, '/usr/bin/security', 'list-keychains'], { timeoutMs: PROBE_TIMEOUT_MS })
    if (security.exitCode === 0) {
      fail('sandbox allowed /usr/bin/security to execute')
    }

    const personalKeychain = commandResult('/usr/bin/sandbox-exec', [
      '-p', policy, process.execPath, '-e',
      "try{require('node:fs').readdirSync(process.argv[1]);process.exit(20)}catch(error){if(error.code==='EPERM'||error.code==='EACCES'){process.stdout.write('personal-read-denied');process.exit(0)}process.stderr.write(error.code||String(error));process.exit(21)}",
      path.join(os.homedir(), 'Library', 'Keychains'),
    ], { timeoutMs: PROBE_TIMEOUT_MS })
    assertMarker(personalKeychain, 'personal-read-denied', 'sandbox personal Keychains read denial proof')

    return {
      loopback: { exitCode: loopback.exitCode, marker: loopback.stdout.trim() },
      nonloopback: { exitCode: outbound.exitCode, marker: outbound.stdout.trim() },
      securityExec: { exitCode: security.exitCode, denied: true },
      personalKeychainsRead: { exitCode: personalKeychain.exitCode, marker: personalKeychain.stdout.trim() },
    }
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

function requireSuccess(command, args, label, options) {
  const result = commandResult(command, args, options)

  if (result.exitCode !== 0) {
    fail(`${label} failed: ${result.stderr.trim() || result.stdout.trim() || result.error || 'unknown error'}`)
  }

  return result
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256')
  const file = fs.readFileSync(filePath)

  hash.update(file)
  return hash.digest('hex')
}

function readPlistValue(plist, key) {
  return requireSuccess('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], `Read ${key}`, { timeoutMs: PROBE_TIMEOUT_MS }).stdout.trim()
}

function nativeDependencyArchitectures(appPath) {
  const unpacked = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked')

  if (!fs.existsSync(unpacked)) {
    return []
  }

  const nodes = []
  const pending = [unpacked]

  while (pending.length > 0) {
    const next = pending.pop()
    for (const entry of fs.readdirSync(next, { withFileTypes: true })) {
      const fullPath = path.join(next, entry.name)
      if (entry.isDirectory()) {
        pending.push(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.node')) {
        const result = commandResult('/usr/bin/lipo', ['-archs', fullPath])
        nodes.push({ path: path.relative(appPath, fullPath), ...result })
      }
    }
  }

  return nodes
}

function installStampRelation(appPath) {
  const workspaceStamp = path.join(REPO_ROOT, 'apps', 'desktop', 'build', 'install-stamp.json')
  const packagedStamp = path.join(appPath, 'Contents', 'Resources', 'install-stamp.json')

  if (!fs.existsSync(workspaceStamp) || !fs.existsSync(packagedStamp)) {
    fail(`Missing install stamp required for D2 consistency: workspace=${workspaceStamp} packaged=${packagedStamp}`)
  }

  const workspace = fs.readFileSync(workspaceStamp, 'utf8')
  const packaged = fs.readFileSync(packagedStamp, 'utf8')

  return {
    workspacePath: workspaceStamp,
    packagedPath: packagedStamp,
    workspaceSha256: sha256(workspaceStamp),
    packagedSha256: sha256(packagedStamp),
    matchesWorkspaceBuild: workspace === packaged,
  }
}

function bundleMetadata(appPath, evidenceRoot) {
  const contents = path.join(appPath, 'Contents')
  const plist = path.join(contents, 'Info.plist')
  const binary = path.join(contents, 'MacOS', APP_NAME)
  const bundleArchive = path.join(evidenceRoot, `${APP_NAME}.app.bundle.zip`)

  requireSuccess('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, bundleArchive], 'Archive package evidence', { timeoutMs: ARCHIVE_TIMEOUT_MS })

  const frameworks = fs.existsSync(path.join(contents, 'Frameworks'))
    ? fs.readdirSync(path.join(contents, 'Frameworks')).filter(name => name.endsWith('.framework'))
    : []
  const helpers = fs.existsSync(path.join(contents, 'Frameworks'))
    ? fs.readdirSync(path.join(contents, 'Frameworks')).filter(name => name.includes('Helper') && name.endsWith('.app'))
    : []

  const installStamp = installStampRelation(appPath)

  if (!installStamp.matchesWorkspaceBuild) {
    fail('Packaged install stamp differs from the workspace build stamp')
  }

  return {
    appPath,
    binary,
    bundleArchive,
    bundleArchiveSha256: sha256(bundleArchive),
    bundleArchiveBytes: fs.statSync(bundleArchive).size,
    appBytes: Number(commandText('/usr/bin/du', ['-sk', appPath], 'Measure packaged app').split(/\s+/)[0]) * 1024,
    bundleIdentifier: readPlistValue(plist, 'CFBundleIdentifier'),
    bundleName: readPlistValue(plist, 'CFBundleName'),
    bundleVersion: readPlistValue(plist, 'CFBundleShortVersionString'),
    executable: readPlistValue(plist, 'CFBundleExecutable'),
    binaryArchitecture: commandResult('/usr/bin/lipo', ['-archs', binary]),
    binaryFileType: commandResult('/usr/bin/file', [binary]),
    frameworks,
    helpers,
    nativeDependencies: nativeDependencyArchitectures(appPath),
    installStamp,
    codeSignVerify: commandResult('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { timeoutMs: SIGNING_ASSESSMENT_TIMEOUT_MS }),
    gatekeeperAssess: commandResult('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath], { timeoutMs: SIGNING_ASSESSMENT_TIMEOUT_MS }),
  }
}

function writeSandboxWrapper(wrapperPath, binaryPath, stdoutPath, stderrPath) {
  const escapedBinary = binaryPath.replace(/'/g, "'\\\"'\\\"'")
  const escapedStdout = stdoutPath.replace(/'/g, "'\\\"'\\\"'")
  const escapedStderr = stderrPath.replace(/'/g, "'\\\"'\\\"'")
  const escapedPolicy = sandboxPolicy().replace(/'/g, "'\\\"'\\\"'")
  // Playwright reads Electron's debugger URLs from stderr. Mirror both streams
  // to evidence rather than redirecting either stream away from Playwright.
  const script = `#!/bin/zsh\nexec /usr/bin/sandbox-exec -p '${escapedPolicy}' '${escapedBinary}' "$@" > >(/usr/bin/tee -a '${escapedStdout}' >&1) 2> >(/usr/bin/tee -a '${escapedStderr}' >&2)\n`

  fs.writeFileSync(wrapperPath, script, { encoding: 'utf8', mode: 0o700 })
}

function appEnvironment(sandboxRoot) {
  const home = path.join(sandboxRoot, 'home')
  const hermesHome = path.join(sandboxRoot, 'hermes-home')
  const userData = path.join(sandboxRoot, 'user-data')
  const tempDir = path.join(sandboxRoot, 'tmp')

  for (const directory of [home, hermesHome, userData, tempDir]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  }

  // This would redirect an unpackaged development app. The actual packaged
  // process must retain production mode despite the file and the dev-only flag.
  fs.writeFileSync(
    path.join(userData, 'platform-development.json'),
    JSON.stringify({ enabled: true, origin: 'http://127.0.0.1:9' }),
    'utf8',
  )

  return {
    HOME: home,
    HERMES_HOME: hermesHome,
    HERMES_DESKTOP_USER_DATA_DIR: userData,
    HERMES_DESKTOP_APP_NAME: `AinoD2Smoke-${process.pid}`,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    TMPDIR: tempDir,
  }
}

async function launchSmoke({ appPath, binaryPath, sandboxRoot, evidenceRoot, testOnlyDisableChromiumSandbox }) {
  const env = appEnvironment(sandboxRoot)
  const wrapperPath = path.join(sandboxRoot, 'sandboxed-aino.sh')
  const appStdoutPath = path.join(evidenceRoot, 'packaged-app.stdout.log')
  const appStderrPath = path.join(evidenceRoot, 'packaged-app.stderr.log')
  const pageErrors = []
  const consoleErrors = []
  let app
  let page

  fs.writeFileSync(appStdoutPath, '', { encoding: 'utf8', mode: 0o600 })
  fs.writeFileSync(appStderrPath, '', { encoding: 'utf8', mode: 0o600 })
  writeSandboxWrapper(wrapperPath, binaryPath, appStdoutPath, appStderrPath)
  const sandboxGuards = await proveSandboxGuards(sandboxPolicy())

  try {
    app = await _electron.launch({
      executablePath: wrapperPath,
      // The app is still the real Aino binary after the wrapper execs it. This
      // deliberately supplies the dev-only switch to prove packaged rejection.
      args: [
        '--aino-legacy-account-development',
        ...(testOnlyDisableChromiumSandbox ? ['--no-sandbox'] : []),
      ],
      env,
      timeout: 45_000,
    })

    page = await app.firstWindow()
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text())
      }
    })

    await page.waitForSelector('#root', { state: 'attached', timeout: 45_000 })
    await page.waitForFunction(
      () => (document.getElementById('root')?.textContent ?? '').trim().length > 0,
      undefined,
      { timeout: 45_000 },
    )

    const [title, bridge, mainProcess] = await Promise.all([
      page.title(),
      page.evaluate(async () => {
        const desktop = window.hermesDesktop
        const snapshot = await desktop.platformAccount.status()

        return { accountAdapter: desktop.accountAdapter, snapshot }
      }),
      app.evaluate(({ app: electronApp, BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find(candidate => !candidate.isDestroyed())

        return {
          appPath: electronApp.getAppPath(),
          executablePath: process.execPath,
          isPackaged: electronApp.isPackaged,
          windowBounds: window?.getBounds() ?? null,
          windowTitle: window?.getTitle() ?? null,
        }
      }),
    ])

    if (!title.includes(APP_NAME)) {
      fail(`Expected packaged window title to contain ${APP_NAME}, received ${JSON.stringify(title)}`)
    }
    if (!mainProcess.isPackaged || mainProcess.executablePath !== binaryPath) {
      fail(`Expected actual packaged ${APP_NAME} executable, received ${JSON.stringify(mainProcess)}`)
    }
    if (mainProcess.appPath !== path.join(appPath, 'Contents', 'Resources', 'app.asar')) {
      fail(`Expected packaged app.asar entry, received ${JSON.stringify(mainProcess.appPath)}`)
    }
    if (!mainProcess.windowBounds || mainProcess.windowBounds.width <= 0 || mainProcess.windowBounds.height <= 0) {
      fail(`Packaged main window has invalid native bounds: ${JSON.stringify(mainProcess.windowBounds)}`)
    }
    if (!mainProcess.windowTitle?.includes(APP_NAME)) {
      fail(`Native main window title does not contain ${APP_NAME}: ${JSON.stringify(mainProcess.windowTitle)}`)
    }
    if (bridge.accountAdapter !== 'platform') {
      fail(`Packaged app accepted fixed-code development adapter: ${bridge.accountAdapter}`)
    }
    if (bridge.snapshot.mode !== 'production') {
      fail(`Packaged app accepted platform-development.json: mode=${bridge.snapshot.mode}`)
    }
    if (pageErrors.length > 0) {
      fail(`Renderer emitted page errors: ${pageErrors.join(' | ')}`)
    }

    await page.screenshot({ path: path.join(evidenceRoot, 'actual-packaged-window.png'), animations: 'disabled', caret: 'hide' })

    return {
      title,
      bridge,
      mainProcess,
      pageErrors,
      consoleErrors,
      sandboxGuards,
      appStdoutPath,
      appStderrPath,
      screenshotPath: path.join(evidenceRoot, 'actual-packaged-window.png'),
    }
  } catch (error) {
    const failureScreenshotPath = path.join(evidenceRoot, 'failed-packaged-window.png')
    let failureScreenshotError = null

    if (page) {
      try {
        await page.screenshot({ path: failureScreenshotPath, animations: 'disabled', caret: 'hide', timeout: PROBE_TIMEOUT_MS })
      } catch (screenshotError) {
        failureScreenshotError = screenshotError instanceof Error ? screenshotError.message : String(screenshotError)
      }
    }

    const launchError = error instanceof Error ? error : new Error(String(error))
    launchError.d2Evidence = {
      failureScreenshotPath: fs.existsSync(failureScreenshotPath) ? failureScreenshotPath : null,
      failureScreenshotError,
      pageErrors,
      consoleErrors,
      sandboxGuards,
      appStdoutPath,
      appStderrPath,
    }
    throw launchError
  } finally {
    await app?.close().catch(() => undefined)
  }
}

function desktopLogEvidence(sandboxRoot) {
  const desktopLogPath = path.join(sandboxRoot, 'hermes-home', 'logs', 'desktop.log')

  if (!fs.existsSync(desktopLogPath)) {
    return { path: desktopLogPath, exists: false, bytes: 0, fatalSignature: false }
  }

  try {
    const text = fs.readFileSync(desktopLogPath, 'utf8')

    return {
      path: desktopLogPath,
      exists: true,
      bytes: Buffer.byteLength(text),
      fatalSignature: FATAL_BOOT_LOG.test(text),
    }
  } catch (error) {
    return {
      path: desktopLogPath,
      exists: true,
      bytes: null,
      fatalSignature: false,
      readError: error instanceof Error ? error.message : String(error),
    }
  }
}

async function main() {
  const appPath = fs.realpathSync(readOption('--app'))
  const artifactRoot = fs.realpathSync(readOption('--artifact-root'))
  const evidenceRoot = readOption('--evidence')
  const binaryPath = path.join(appPath, 'Contents', 'MacOS', APP_NAME)
  const smokeSandboxRoot = path.join(evidenceRoot, 'sandbox')
  const testOnlyDisableChromiumSandbox = process.argv.includes('--test-only-disable-chromium-sandbox')

  assertD2Workspace(artifactRoot, evidenceRoot)
  fs.mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 })
  processEvidence = { evidenceRoot }

  if (!isWithin(artifactRoot, appPath) || path.basename(appPath) !== `${APP_NAME}.app`) {
    fail(`Expected ${APP_NAME}.app inside the explicit artifact root`)
  }
  if (!fs.existsSync(binaryPath)) {
    fail(`Missing packaged executable: ${binaryPath}`)
  }

  const result = {
    startedAt: new Date().toISOString(),
    status: 'failed',
    appPath,
    artifactRoot,
    evidenceRoot,
    source: {
      sha: commandText('/usr/bin/git', ['rev-parse', 'HEAD'], 'Resolve source SHA', { cwd: REPO_ROOT }),
      dirtyPaths: commandText('/usr/bin/git', ['status', '--short'], 'List source dirty paths', { cwd: REPO_ROOT })
        .split('\n')
        .filter(Boolean),
    },
    policy: {
      network: 'sandbox-exec denies all outbound networking except localhost for Playwright inspector transport; a prelaunch controlled nonloopback connect must fail with EPERM/EACCES',
      chromiumSandbox: testOnlyDisableChromiumSandbox
        ? 'disabled with --no-sandbox only for this outer-sandboxed D2 smoke; this is not a production Chromium sandbox acceptance result'
        : 'enabled',
      appEnvironmentKeys: ['HOME', 'HERMES_HOME', 'HERMES_DESKTOP_USER_DATA_DIR', 'HERMES_DESKTOP_APP_NAME', 'LANG', 'LC_ALL', 'PATH', 'TMPDIR'],
      bootFake: false,
      devServer: false,
      signing: 'not requested',
      notarization: 'not requested',
      publication: 'not requested',
    },
  }

  // The checkpoint makes source, policy, and bundle metadata available even
  // when an abrupt Playwright crash bypasses the ordinary error path.
  writeJson(path.join(evidenceRoot, 'result.json'), result)

  try {
    result.metadata = bundleMetadata(appPath, evidenceRoot)
    writeJson(path.join(evidenceRoot, 'result.json'), result)
    result.launch = await launchSmoke({
      appPath,
      binaryPath,
      sandboxRoot: smokeSandboxRoot,
      evidenceRoot,
      testOnlyDisableChromiumSandbox,
    })

    result.desktopLog = desktopLogEvidence(smokeSandboxRoot)
    if (result.desktopLog.fatalSignature) {
      fail('desktop.log contains a fatal renderer/bootstrap signature')
    }

    result.status = 'passed'
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    if (error instanceof Error && error.d2Evidence) {
      result.launchFailureEvidence = error.d2Evidence
    }
  } finally {
    result.desktopLog ??= desktopLogEvidence(smokeSandboxRoot)
    if (result.status === 'passed' && result.desktopLog.fatalSignature) {
      result.status = 'failed'
      result.error = 'desktop.log contains a fatal renderer/bootstrap signature after app close'
    }
    result.finishedAt = new Date().toISOString()
    fs.writeFileSync(path.join(evidenceRoot, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  }

  if (result.status !== 'passed') {
    process.exitCode = 1
  }
}

async function runCli() {
  if (process.argv.includes('--self-test-sandbox')) {
    const result = { workspace: proveWorkspaceGuard(), sandbox: await proveSandboxGuards(sandboxPolicy()) }
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } else {
    await main()
  }
}

if (isMain(import.meta.url)) runCli().catch(error => { console.error(error); process.exitCode = 1 })
