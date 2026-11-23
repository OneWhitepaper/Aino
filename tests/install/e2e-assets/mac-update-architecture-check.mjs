#!/usr/bin/env node
// CI-only negative acceptance: the unchanged signed Intel release must reject
// an arm64-only update through its own preload and native updater.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { downloadArtifact } from './bundle-inputs.mjs'
import { buildMacFeedText } from './mac-bundled-feed.mjs'
import { stampAssertions } from './mac-bundled-manifest.cjs'
import { observeProcessClose, recordProcessOutput } from './process-close.cjs'
import { isolatedElectronArgs, smokeEnvironment } from './smoke-env.mjs'
import { pickAppWindow } from './update-ui.cjs'

const OLD = Object.freeze({
  url: 'https://github.com/OneWhitepaper/Aino/releases/download/rc.2-v0.1.5/AinoBundled-0.1.5-mac-x64.zip',
  size: 1041870880,
  sha256: '23ca9eb06c7a11e3eb0d4d9f54e44bd0f87a55ae9397db901297495316da54b7',
  version: '0.1.5', tag: 'v0.1.5', commit: '22a472fcbca8775f56c0f89374027b8e4c68ab5b',
  identity: 'com.ablankpaper.aino-bundled', teamId: '7H3BA9HTRK',
})
const FEED_PATH = '/releases/darwin/stable/stable-mac.yml'
const ZIP_PATH = '/releases/tag/v0.1.6/AinoBundled-0.1.6-mac-arm64.zip'

export function createArchitectureFeed({ url, sha512, size }) {
  const source = new URL(url)
  assert.ok(source.protocol === 'https:' && !source.username && !source.password && !source.search && !source.hash,
    'The candidate URL must use HTTPS without credentials, query or fragment')
  assert.equal(source.pathname, ZIP_PATH, 'Expected the real v0.1.6 arm64 ZIP path')
  assert.match(sha512, /^[A-Za-z0-9+/]{86}==$/, 'Expected a base64 SHA-512')
  assert.match(size, /^[0-9]+$/, 'Expected a positive integer package size')
  const bytes = Number(size)
  assert.ok(Number.isSafeInteger(bytes) && bytes > 0, 'Expected a positive safe integer package size')
  return {
    sourceUrl: source.href, feedPath: FEED_PATH,
    // Keep the release's path and metadata, but resolve all package requests
    // against loopback so an incorrect selection is observable without a download.
    text: buildMacFeedText({ version: '0.1.6', tag: 'v0.1.6', zipName: path.basename(ZIP_PATH),
      sha512, size: bytes, releaseDate: '2026-11-23T00:00:00.000Z' }),
  }
}

export async function startArchitectureFeed(feed, logFile) {
  const requests = []
  fs.writeFileSync(logFile, '', { flag: 'wx' })
  // This negative fixture serves metadata only. A ZIP GET fails the acceptance
  // even though the server deliberately has no installable bytes to return.
  const server = http.createServer((request, response) => {
    const entry = { at: new Date().toISOString(), method: request.method,
      path: new URL(request.url, 'http://127.0.0.1').pathname, userAgent: request.headers['user-agent'] || '' }
    requests.push(entry)
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n')
    const isFeed = entry.method === 'GET' && entry.path === feed.feedPath
    response.writeHead(isFeed ? 200 : 404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    response.end(isFeed ? feed.text : 'No package bytes are served by this negative fixture.\n')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return { url: `http://127.0.0.1:${server.address().port}`, requests,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
}

export function assertArchitectureRejection(evidence) {
  const { runtime, before, after, check, apply, requests } = evidence
  assert.equal(runtime.platform, 'darwin')
  assert.equal(runtime.arch, 'x64')
  assert.equal(runtime.version, OLD.version)
  assert.equal(runtime.packaged, true)
  assert.equal(check.error, undefined, 'The update check must succeed')
  assert.equal(check.supported, true)
  assert.equal(check.mechanism, 'electron-updater')
  assert.equal(check.currentVersion, OLD.version)
  assert.equal(check.latestTag, 'v0.1.6')
  assert.equal(check.updateAvailable, true, 'The old client must actually offer v0.1.6')
  assert.equal(apply.ok, false, 'Applying the wrong architecture must fail')
  assert.equal(apply.error, 'apply-failed')
  assert.match(apply.message, /\bNo files provided\b/, 'Only the native no-candidate error qualifies')
  assert.ok(evidence.checkFeedRequests >= 1, 'Check must fetch the loopback feed')
  assert.ok(evidence.applyFeedRequests >= 1, 'Apply must recheck the loopback feed')
  assert.ok(requests.filter(entry => entry.method === 'GET' && entry.path === FEED_PATH).length >= 2)
  const zipRequests = requests.filter(entry => entry.path.toLowerCase().endsWith('.zip'))
  assert.equal(zipRequests.length, 0, 'The native updater attempted to request a ZIP')
  for (const installed of [before, after]) {
    assert.equal(installed.bundleVersion, OLD.version)
    assert.equal(installed.bundleIdentifier, OLD.identity)
    assert.equal(installed.teamIdentifier, OLD.teamId)
    assert.deepEqual(installed.lipoArchs, ['x86_64'])
    assert.deepEqual(stampAssertions(installed.stamp, OLD), [])
    assert.match(installed.signatureHash, /^[0-9a-f]{40}$/)
  }
  assert.equal(after.signatureHash, before.signatureHash, 'The signed app changed')
  assert.deepEqual(after.stamp, before.stamp, 'The installed stamp changed')
  return { zipGetCount: 0, zipRequestCount: zipRequests.length }
}

function nativeIntelHost() {
  assert.ok(process.platform === 'darwin' && process.arch === 'x64' && process.env.GITHUB_ACTIONS === 'true'
    && process.env.GITHUB_EVENT_NAME === 'workflow_dispatch', 'This acceptance requires manual Intel macOS CI')
  const machine = execFileSync('/usr/bin/uname', ['-m'], { encoding: 'utf8' }).trim()
  const cpu = execFileSync('/usr/sbin/sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8' }).trim()
  const uname = execFileSync('/usr/bin/uname', ['-a'], { encoding: 'utf8' }).trim()
  assert.equal(machine, 'x86_64', 'An Apple Silicon/Rosetta run cannot certify Intel')
  assert.match(cpu, /Intel/i, 'A physical Intel CPU is required')
  // The released updater uses this exact uname heuristic in addition to Rosetta detection.
  assert.ok(!uname.includes('ARM'), 'The released updater would classify this host as ARM')
  assert.ok(process.env.RUNNER_TEMP && path.isAbsolute(process.env.RUNNER_TEMP), 'RUNNER_TEMP is required')
  return { platform: process.platform, arch: process.arch, machine, cpu, uname }
}

function writeJson(filename, value) {
  fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n')
}

function verifyOldApp(app, out, stage) {
  const result = execFileSync(process.execPath, [path.join(import.meta.dirname, 'mac-bundled-verify.mjs'),
    'verify-app', '--app', app, '--expect-version', OLD.version, '--expect-commit', OLD.commit,
    '--expect-tag', OLD.tag, '--expect-identity', OLD.identity, '--expect-team', OLD.teamId, '--expect-arch', 'x64',
  ], { encoding: 'utf8', timeout: 180_000 })
  const receipt = JSON.parse(result)
  const signature = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', app], { encoding: 'utf8', timeout: 60_000 })
  fs.writeFileSync(path.join(out, `${stage}-codesign.txt`), `${signature.stdout || ''}\n${signature.stderr || ''}`)
  assert.equal(signature.status, 0, 'Could not inspect the signed app')
  receipt.signatureHash = /^CDHash=([0-9a-f]{40})$/m.exec(signature.stderr)?.[1]
  assert.ok(receipt.signatureHash, 'Missing native code signature hash')
  writeJson(path.join(out, `${stage}.json`), receipt)
  return receipt
}

async function bounded(operation, label) {
  let timer
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), 120_000)
    })])
  } finally {
    clearTimeout(timer)
  }
}

async function runArchitectureCheck(values) {
  const host = nativeIntelHost()
  const candidate = createArchitectureFeed({ url: values['arm64-url'], sha512: values['arm64-sha512'], size: values['arm64-size'] })
  const out = path.resolve(values.out)
  fs.mkdirSync(out, { recursive: true })
  const work = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'mac-update-architecture-'))
  const evidence = { schema: 1, status: 'failed', startedAt: new Date().toISOString(),
    driverCommit: process.env.GITHUB_SHA, baseline: OLD, candidate, host, work, errors: [] }
  const recordError = error => evidence.errors.push(error.stack || String(error))
  let app, server, appPath, waitForClose
  try {
    writeJson(path.join(out, 'evidence.json'), evidence)
    const archive = path.join(work, 'old-x64.zip')
    await downloadArtifact(OLD, archive)
    evidence.download = { url: OLD.url, sha256: OLD.sha256, verified: true }
    const extracted = path.join(work, 'installed')
    fs.mkdirSync(extracted)
    execFileSync('/usr/bin/ditto', ['-x', '-k', archive, extracted], { timeout: 180_000 })
    const bundles = fs.readdirSync(extracted, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name.endsWith('.app'))
    assert.equal(bundles.length, 1, 'Expected exactly one unchanged release app')
    appPath = path.join(extracted, bundles[0].name)
    evidence.before = verifyOldApp(appPath, out, 'old-before')
    server = await startArchitectureFeed(candidate, path.join(out, 'feed-requests.jsonl'))
    fs.writeFileSync(path.join(out, 'stable-mac.yml'), candidate.text)
    const env = smokeEnvironment(process.env, path.join(work, 'hermes-home'), path.join(work, 'user-data'))
    env.HERMES_RUNTIME_DIR = path.join(work, 'runtime')
    for (const folder of [env.HOME, env.HERMES_HOME, env.HERMES_DESKTOP_USER_DATA_DIR, env.HERMES_RUNTIME_DIR]) fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(env.HERMES_HOME, 'config.yaml'),
      `language: en\nupdates:\n  desktop_feed_base_url: ${server.url}\n`, { flag: 'wx', mode: 0o600 })
    evidence.sandbox = { home: env.HOME, hermesHome: env.HERMES_HOME, userData: env.HERMES_DESKTOP_USER_DATA_DIR }
    const { _electron } = createRequire(new URL('../../../tests-js/package.json', import.meta.url))('@playwright/test')
    app = await _electron.launch({ executablePath: evidence.before.executablePath, cwd: path.dirname(evidence.before.executablePath),
      args: isolatedElectronArgs([], env.HERMES_DESKTOP_USER_DATA_DIR), env, chromiumSandbox: true, timeout: 120_000 })
    const child = app.process()
    fs.writeFileSync(path.join(out, 'old-app-output.log'), '')
    recordProcessOutput(child, path.join(out, 'old-app-output.log'))
    waitForClose = observeProcessClose(child)
    evidence.runtime = await app.evaluate(({ app: native }) => ({
      pid: process.pid, platform: process.platform, arch: process.arch, version: native.getVersion(), packaged: native.isPackaged,
      executable: native.getPath('exe'), home: process.env.HOME, hermesHome: process.env.HERMES_HOME, userData: native.getPath('userData'),
    }))
    assert.equal(evidence.runtime.home, env.HOME)
    assert.equal(evidence.runtime.hermesHome, env.HERMES_HOME)
    assert.equal(evidence.runtime.userData, env.HERMES_DESKTOP_USER_DATA_DIR)
    assert.equal(fs.realpathSync(evidence.runtime.executable), fs.realpathSync(evidence.before.executablePath))
    const page = await pickAppWindow(app, message => console.log(`[architecture-check] ${message}`))
    await page.waitForFunction(() => globalThis.hermesDesktop?.updates?.check && globalThis.hermesDesktop?.updates?.apply,
      undefined, { timeout: 120_000 })
    evidence.check = await bounded(page.evaluate(() => globalThis.hermesDesktop.updates.check({ force: true })), 'updates.check')
    const feedGets = () => server.requests.filter(entry => entry.method === 'GET' && entry.path === FEED_PATH).length
    evidence.checkFeedRequests = feedGets()
    assert.equal(evidence.check.updateAvailable, true, 'The native check did not offer the candidate')
    assert.equal(evidence.check.latestTag, 'v0.1.6')
    evidence.apply = await bounded(page.evaluate(() => globalThis.hermesDesktop.updates.apply()), 'updates.apply')
    evidence.applyFeedRequests = feedGets() - evidence.checkFeedRequests
    evidence.afterApplyRuntime = await app.evaluate(({ app: native }) => ({ pid: process.pid, version: native.getVersion() }))
    assert.equal(evidence.afterApplyRuntime.pid, evidence.runtime.pid, 'The old process was replaced')
    assert.equal(evidence.afterApplyRuntime.version, OLD.version)
  } catch (error) {
    recordError(error)
  } finally {
    if (app) {
      try { await bounded(app.close(), 'Closing the isolated old app'); await waitForClose(30_000) } catch (error) { recordError(error) }
    }
    if (evidence.before) {
      try { evidence.after = verifyOldApp(appPath, out, 'old-after') } catch (error) { recordError(error) }
    }
    if (server) {
      try { await server.close() } catch (error) { recordError(error) }
      evidence.requests = server.requests
    }
    if (evidence.errors.length === 0) {
      try { evidence.verdict = assertArchitectureRejection(evidence); evidence.status = 'passed' } catch (error) { recordError(error) }
    }
    evidence.finishedAt = new Date().toISOString()
    writeJson(path.join(out, 'evidence.json'), evidence)
  }
  assert.equal(evidence.status, 'passed', evidence.errors.join('\n'))
  console.log(`Intel architecture rejection passed; evidence: ${path.join(out, 'evidence.json')}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    out: { type: 'string' }, 'arm64-url': { type: 'string' }, 'arm64-sha512': { type: 'string' }, 'arm64-size': { type: 'string' },
  } })
  await runArchitectureCheck(values)
}
