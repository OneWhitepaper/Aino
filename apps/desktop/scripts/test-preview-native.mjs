import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(process.argv[2] || mkdtempSync(join(tmpdir(), 'aino-browser-native-results-')))
mkdirSync(output, { recursive: true })
const fixtures = [
  'preview-agent-native.test.mjs',
  'preview-native-retention.test.mjs',
  'preview-page-zoom-native.test.mjs',
  'preview-browser-interactions-native.test.mjs',
  'preview-guest-prompt-native.test.mjs',
  'preview-webview-prompt-native.test.mjs',
  'preview-approval-native.test.mjs'
]
const executable = require('electron')
const results = []
const selection = process.argv[3]
if (selection && !fixtures.includes(selection)) throw new Error('Unknown native browser fixture: ' + selection)

async function run(fixture) {
  const started = Date.now()
  const runtime = mkdtempSync(join(tmpdir(), 'aino-browser-native-runtime-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  let log = ''
  let result
  let timer
  try {
    const child = spawn(executable, [join(root, 'electron', fixture), join(output, fixture.replace('.test.mjs', '')), runtime], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const append = chunk => {
      log += chunk.toString()
      process.stdout.write(chunk)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    timer = setTimeout(() => child.kill(), 180_000)
    result = await new Promise(resolveResult => {
      let spawnError
      child.once('error', error => { spawnError = error.message })
      child.once('close', (exit, signal) => resolveResult({ exit, signal, ...(spawnError ? { error: spawnError } : {}) }))
    })
  } catch (error) {
    result = { exit: null, error: error.message }
  } finally {
    clearTimeout(timer)
    // Windows can retain Chromium file handles briefly after the main process exits.
    // Deletion before 'close' is unsafe even when every BrowserWindow was destroyed.
    try {
      await rm(runtime, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    } catch (error) {
      result = { ...result, cleanup_error: error.message }
    }
  }
  writeFileSync(join(output, fixture + '.log'), log)
  return { fixture, ...result, elapsed_ms: Date.now() - started, passed: result.exit === 0 && !result.cleanup_error }
}

for (const fixture of selection ? [selection] : fixtures) results.push(await run(fixture))
const receipt = {
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  electron: require('electron/package.json').version,
  passed: results.every(result => result.passed),
  results
}
writeFileSync(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify({ ...receipt, evidence: output }, null, 2))
process.exitCode = receipt.passed ? 0 : 1
