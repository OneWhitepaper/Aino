import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import yaml from 'js-yaml'
import { afterEach, expect, test } from 'vitest'
import {
  assertArchitectureRejection,
  createArchitectureFeed,
  startArchitectureFeed,
} from '../tests/install/e2e-assets/mac-update-architecture-check.mjs'

const directories = []
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})
function scratch() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-architecture-'))
  directories.push(directory)
  return directory
}

const candidate = {
  url: 'https://cdn.petoi.cn/releases/tag/v0.1.6/AinoBundled-0.1.6-mac-arm64.zip',
  sha512: Buffer.alloc(64, 7).toString('base64'),
  size: '1200000000',
}
const feedPath = '/releases/darwin/stable/stable-mac.yml'
const zipPath = '/releases/tag/v0.1.6/AinoBundled-0.1.6-mac-arm64.zip'

test('advertises the real arm64 artifact metadata through the shared legacy feed path', () => {
  const feed = createArchitectureFeed(candidate)
  expect(feed.sourceUrl).toBe(candidate.url)
  expect(feed.feedPath).toBe(feedPath)
  expect(yaml.load(feed.text)).toMatchObject({
    version: '0.1.6',
    files: [{ url: zipPath, sha512: candidate.sha512, size: 1200000000 }],
    path: zipPath,
    sha512: candidate.sha512,
  })
})

test.each([
  { url: 'https://cdn.petoi.cn/releases/tag/v0.1.5/AinoBundled-0.1.5-mac-arm64.zip' },
  { url: 'https://cdn.petoi.cn/releases/tag/v0.1.6/AinoBundled-0.1.6-mac-x64.zip' },
  { url: 'https://cdn.petoi.cn/releases/tag/v0.1.6/update.zip' },
  { url: 'http://cdn.petoi.cn/releases/tag/v0.1.6/AinoBundled-0.1.6-mac-arm64.zip' },
  { url: `${candidate.url}?token=secret` },
  { sha512: 'not-a-sha512' },
  { size: '0' },
  { size: '1.2' },
  { size: '9007199254740992' },
])('rejects metadata that cannot represent the intended arm64-only release: %j', invalid => {
  expect(() => createArchitectureFeed({ ...candidate, ...invalid })).toThrow()
})

test('serves only feed metadata and records even rejected ZIP requests without serving package bytes', async () => {
  const log = path.join(scratch(), 'requests.jsonl')
  const server = await startArchitectureFeed(createArchitectureFeed(candidate), log)
  try {
    const response = await fetch(`${server.url}${feedPath}?noCache=123`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(yaml.load(await response.text()).version).toBe('0.1.6')
    const zip = await fetch(`${server.url}${zipPath}`)
    expect(zip.status).toBe(404)
    expect(await zip.text()).not.toContain('PK')
    await fetch(`${server.url}${zipPath}`, { method: 'HEAD' })
    expect(server.requests.map(({ method, path: requestPath }) => [method, requestPath])).toEqual([
      ['GET', feedPath], ['GET', zipPath], ['HEAD', zipPath],
    ])
    expect(fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line).method)).toEqual(['GET', 'GET', 'HEAD'])
  } finally {
    await server.close()
  }
})

// These fixtures test receipt admission, never emulate the native file selector.
function evidence() {
  const installed = {
    bundleVersion: '0.1.5', bundleIdentifier: 'com.ablankpaper.aino-bundled', teamIdentifier: '7H3BA9HTRK',
    lipoArchs: ['x86_64'], signatureHash: 'a'.repeat(40),
    stamp: { commit: '22a472fcbca8775f56c0f89374027b8e4c68ab5b', tag: 'v0.1.5', payload: 'bundled', updateMechanism: 'electron-updater' },
  }
  return {
    runtime: { platform: 'darwin', arch: 'x64', version: '0.1.5', packaged: true },
    before: structuredClone(installed), after: structuredClone(installed),
    check: { supported: true, mechanism: 'electron-updater', currentVersion: '0.1.5', latestTag: 'v0.1.6', updateAvailable: true },
    apply: { ok: false, error: 'apply-failed', message: 'No files provided' },
    checkFeedRequests: 1, applyFeedRequests: 1,
    requests: [{ method: 'GET', path: feedPath }, { method: 'GET', path: feedPath }],
  }
}

test('accepts only an advertised update rejected before any package request with the signed old app intact', () => {
  expect(assertArchitectureRejection(evidence())).toEqual({ zipGetCount: 0, zipRequestCount: 0 })
})

test.each([
  ['check failed', value => { value.check.error = 'check-failed' }],
  ['no update was offered', value => { value.check.updateAvailable = false }],
  ['wrong advertised version', value => { value.check.latestTag = 'v0.1.5' }],
  ['wrong mechanism', value => { value.check.mechanism = 'external' }],
  ['successful apply', value => { value.apply = { ok: true, handedOff: true } }],
  ['unrelated failure', value => { value.apply.message = 'ECONNREFUSED' }],
  ['missing apply result', value => { delete value.apply }],
  ['unobserved check', value => { value.checkFeedRequests = 0 }],
  ['apply did not recheck', value => { value.applyFeedRequests = 0 }],
  ['ZIP GET', value => { value.requests.push({ method: 'GET', path: zipPath }) }],
  ['ZIP HEAD', value => { value.requests.push({ method: 'HEAD', path: zipPath }) }],
  ['wrong running architecture', value => { value.runtime.arch = 'arm64' }],
  ['wrong running version', value => { value.runtime.version = '0.1.6' }],
  ['unpackaged app', value => { value.runtime.packaged = false }],
  ['changed signed bytes', value => { value.after.signatureHash = 'b'.repeat(40) }],
  ['changed installed version', value => { value.after.bundleVersion = '0.1.6' }],
  ['wrong signing team', value => { value.after.teamIdentifier = 'OTHER12345' }],
  ['wrong bundle identifier', value => { value.after.bundleIdentifier = 'com.other.app' }],
  ['wrong baseline commit', value => { value.before.stamp.commit = 'b'.repeat(40) }],
  ['missing post-run verification', value => { delete value.after }],
])('cannot report a passing negative acceptance for %s', (_name, mutate) => {
  const value = evidence()
  mutate(value)
  expect(() => assertArchitectureRejection(value)).toThrow()
})

test('the native entry point fails outside manual Intel CI before creating run files', () => {
  const root = scratch()
  const out = path.join(root, 'output')
  const checkout = path.join(root, 'source with spaces')
  fs.mkdirSync(out)
  fs.symlinkSync(fileURLToPath(new URL('..', import.meta.url)), checkout, 'junction')
  const entry = pathToFileURL(path.join(checkout, 'tests/install/e2e-assets/mac-update-architecture-check.mjs'))
  const result = spawnSync(process.execPath, [
    '--preserve-symlinks-main', fileURLToPath(entry),
    '--out', out, '--arm64-url', candidate.url, '--arm64-sha512', candidate.sha512, '--arm64-size', candidate.size,
  ], { env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_EVENT_NAME: '' }, encoding: 'utf8', timeout: 30_000 })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('manual Intel macOS CI')
  expect(fs.readdirSync(out)).toEqual([])
})
