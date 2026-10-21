import assert from 'node:assert/strict'
import { test } from 'vitest'
import { requireMsixPublisher } from '../../../scripts/msix-shared.mjs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { builderNodeOptions, runElectronBuilder } from './run-electron-builder.mjs'
import fs from 'node:fs'
import os from 'node:os'
import { publishPackagingInputs } from './prepared-packaging.mjs'
import { recordNativeInputs } from './prepared-native-deps.mjs'
import { createRequire } from 'node:module'
const builderEntry = createRequire(import.meta.url).resolve('electron-builder')
const { configureBuildCommand, createYargs, normalizeOptions } = await import(new URL('./builder.js', 'file://' + builderEntry).href)

test('validate-only admits real prepared inputs without launching tools and rejects unsafe arguments', async () => {
  const source = path.resolve(import.meta.dirname, '../../..')
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-validation-'))
  try {
    const electron = path.join(out, 'electron.zip')
    fs.writeFileSync(electron, 'fixture archive')
    const toolsets = { sevenZip: path.join(out, 'sevenZip'), icons: path.join(out, 'icons') }
    for (const dir of Object.values(toolsets)) fs.mkdirSync(dir)
    fs.writeFileSync(path.join(toolsets.icons, 'icon-tool.js'), 'console.log(require("node:path").basename(__filename))')
    const manifest = await publishPackagingInputs({ source, out, target: `${process.platform}-${process.arch}`, formats: ['dir'], electron, toolsets })
    const nativeDeps = path.join(out, 'native')
    fs.mkdirSync(path.join(nativeDeps, 'node-pty'), { recursive: true })
    fs.writeFileSync(path.join(nativeDeps, 'node-pty/package.json'), '{}')
    recordNativeInputs({ source, out: nativeDeps, platform: process.platform, arch: process.arch })
    const args = ['--validate-only', '--prepared', manifest, '--native-deps', nativeDeps, '--dir']
    const options = { spawn: () => { throw new Error('validation must not launch tools') } }
    assert.equal(runElectronBuilder(args, options), 0)
    for (const flag of [[], ['--publish=never'], ['--publish', 'never'], ['-p', 'never']]) {
      let forwarded
      assert.equal(runElectronBuilder([...args.filter(arg => arg !== '--validate-only'), ...flag], {
        spawn: (_node, argv) => { forwarded = argv; return { status: 0 } }
      }), 0)
      const cli = forwarded.slice(forwarded.findIndex(arg => arg.endsWith('cli.js')) + 1)
      const parsed = await configureBuildCommand(createYargs()).parse(cli)
      assert.equal(normalizeOptions(parsed).publish, 'never')
      const iconDirectory = forwarded.find(arg => arg.startsWith('-c.toolsets.icons.url=file://')).split('file://')[1]
      const icon = spawnSync(process.execPath, [path.join(iconDirectory, 'icon-tool.js')], { encoding: 'utf8' })
      assert.equal(icon.status, 0, icon.stderr)
      assert.equal(icon.stdout.trim(), 'icon-tool.js')
      assert.equal(fs.existsSync(path.join(toolsets.icons, 'package.json')), false, 'immutable tool cache must stay unchanged')
    }
    assert.throws(() => runElectronBuilder([...args, '-c.npmRebuild=true'], options), /not admitted/)
    assert.throws(() => runElectronBuilder(['--validate-only'], options), /--prepared/)
    const cli = spawnSync(process.execPath, [path.join(import.meta.dirname, 'run-electron-builder.mjs'), ...args], { encoding: 'utf8' })
    assert.equal(cli.status, 0, cli.stderr)
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
})

test('source multiarch prepares isolated native and packaging inputs before each strict invocation', () => {
  const calls = []
  const spawn = (_node, args) => { calls.push(args); return { status: 0 } }
  assert.equal(runElectronBuilder(['--mac', '--x64', '--arm64', '--dir'], { spawn }), 0)
  for (const arch of ['x64', 'arm64']) {
    const native = calls.find(args => args[0].endsWith('stage-native-deps.mjs') && args.includes(arch))
    assert.ok(native)
    assert.equal(native[native.indexOf('--platform') + 1], 'darwin')
    const prepare = calls.find(args => args[0].endsWith('prepare-packaging-tools.mjs') && args.includes(`darwin-${arch}`))
    assert.ok(prepare)
    const strict = calls.find(args => args[0].endsWith('run-electron-builder.mjs') && args.includes(`--${arch}`))
    assert.ok(strict)
    assert.equal(strict[strict.indexOf('--prepared') + 1], path.join(prepare[prepare.indexOf('--out') + 1], 'prepared.json'))
    assert.equal(strict[strict.indexOf('--native-deps') + 1], native[native.indexOf('--out') + 1])
    assert.equal(strict.filter(arg => ['--x64', '--arm64'].includes(arg)).length, 1)
  }
  assert.equal(calls.length, 6)
  assert.notEqual(calls[0][calls[0].indexOf('--out') + 1], calls[3][calls[3].indexOf('--out') + 1])
  calls.length = 0
  assert.equal(runElectronBuilder(['--dir'], { spawn }), 0)
  assert.equal(calls.filter(args => args[0].endsWith('prepare-packaging-tools.mjs')).length, 1)
  assert.equal(calls.filter(args => args[0].endsWith('run-electron-builder.mjs')).length, 1)
  assert.throws(() => runElectronBuilder(['--mac', '--universal'], { spawn }), /No prepared universal native payload/)
  assert.equal(runElectronBuilder(['--mac', '--x64', '--arm64'], { spawn: () => ({ status: 7 }) }), 7)
})

test('strict builder refuses absent inputs before loading electron-builder', () => {
  const result = spawnSync(process.execPath, [path.join(import.meta.dirname, 'run-electron-builder.mjs'),
    '--prepared', path.join(import.meta.dirname, 'missing-prepared.json'), '--native-deps', 'missing', '--dir'], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /run preparation again/)
  assert.doesNotMatch(result.stdout, /electron-builder\s+version/)
})

test.runIf(process.platform === 'linux')('prepackaged native Linux formats reuse existing app bytes without staging native dependencies', async () => {
  const source = path.resolve(import.meta.dirname, '../../..')
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-prepackaged-'))
  try {
    const electron = path.join(out, 'electron.zip')
    fs.writeFileSync(electron, 'fixture archive')
    const toolsets = { sevenZip: path.join(out, 'sevenZip'), icons: path.join(out, 'icons') }
    for (const dir of Object.values(toolsets)) fs.mkdirSync(dir)
    const manifest = await publishPackagingInputs({ source, out, target: `${process.platform}-${process.arch}`, formats: ['deb', 'rpm'], electron, toolsets })
    const app = path.join(out, 'app')
    const resources = path.join(app, 'resources')
    fs.mkdirSync(path.join(resources, 'agent-payload'), { recursive: true })
    fs.writeFileSync(path.join(resources, 'app.asar'), 'unchanged packaged app')
    fs.writeFileSync(path.join(resources, 'agent-payload/manifest.json'), '{}')
    const stamp = path.join(resources, 'install-stamp.json')
    fs.writeFileSync(stamp, JSON.stringify({ payload: 'bundled', dirty: false, commit: 'a'.repeat(40) }))
    const args = ['--prepared', manifest, '--prepackaged', app, '--linux', 'deb', 'rpm']
    let forwarded
    assert.equal(runElectronBuilder(args, { spawn: (_node, argv) => { forwarded = argv; return { status: 0 } } }), 0)
    assert.equal(forwarded[forwarded.indexOf('--prepackaged') + 1], app)
    assert.equal(fs.readFileSync(path.join(resources, 'app.asar'), 'utf8'), 'unchanged packaged app')
    fs.writeFileSync(stamp, JSON.stringify({ payload: 'bundled', dirty: true, commit: 'a'.repeat(40) }))
    assert.throws(() => runElectronBuilder(args), /clean bundled commit/)
  } finally { fs.rmSync(out, { recursive: true, force: true }) }
})

test('npm run builder forwards an apostrophe path to the wrapper verbatim', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-'))
  const manifest = path.join(root, "r'y'z", 'missing.json')
  const windows = process.platform === 'win32'
  try {
    // Windows needs a shell for npm.cmd, which joins argv unquoted.
    const result = spawnSync('npm', ['run', 'builder', '--silent', '--ignore-scripts', '--',
      '--prepared', windows ? `"${manifest}"` : manifest, '--native-deps', 'missing', '--dir'],
    { cwd: path.join(import.meta.dirname, '..'), encoding: 'utf8', shell: windows })
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes(manifest), result.stderr)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('source builds hand every child the builder heap without rewriting inherited NODE_OPTIONS', () => {
  const calls = []
  const spawn = (_node, args, options) => { calls.push({ args, options }); return { status: 0 } }
  assert.equal(runElectronBuilder(['--dir'], { spawn }), 0)
  assert.ok(calls.length >= 2)
  const heap = /--max-old-space-size=16384$/
  for (const { options } of calls) assert.match(options.env.NODE_OPTIONS, heap)
  assert.match(builderNodeOptions(''), heap)
  assert.match(builderNodeOptions('--max-old-space-size=4096'), heap)
  const quoted = '--require "/tmp/sp  ace/p.cjs"'
  assert.ok(builderNodeOptions(quoted).startsWith(quoted))
  assert.match(builderNodeOptions('--max-old-space-size=16384 --max-old-space-size=4096'), heap)
})

test('MSIX packaging requires the configured Aino certificate subject', () => {
  assert.throws(() => requireMsixPublisher({}), /AZURE_SIGN_PUBLISHER/)
  const publisher = 'CN=Fixture Publisher'
  assert.equal(requireMsixPublisher({ AZURE_SIGN_PUBLISHER: publisher }), publisher)
})

test('Linux executable identity fits update-alternatives while preserving the display name', () => {
  const script = `const config = require('./electron-builder.config.cjs'); console.log(JSON.stringify({name: config.linux.executableName ?? config.executableName, display: config.productName}))`
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, HERMES_DESKTOP_VARIANT: 'bundled', HERMES_BUILD_COMMIT: '', HERMES_PAYLOAD_TAG: 'v0.1.0' },
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)
  const identity = JSON.parse(result.stdout)
  assert.match(identity.name, /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
  assert.equal(identity.display, 'Aino Agent')
})
