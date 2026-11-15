import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { extractReleasedWindowsZip, stageReleasedWindowsZip } from './released-windows-zip.mjs'

const python = process.env.HERMES_PYTHON || 'python3'
const commit = '22a472fcbca8775f56c0f89374027b8e4c68ab5b'
const runtime = { repoDir: 'app', toolsDir: 'tools', storePython: 'tools/python/python.exe',
  sitePackages: 'venv/Lib/site-packages', commands: { hermes: 'bin/aino.exe' } }

function pe(arch = 'x64') {
  const bytes = Buffer.alloc(128)
  bytes.write('MZ'); bytes.writeUInt32LE(64, 60); bytes.write('PE\0\0', 64)
  bytes.writeUInt16LE(arch === 'arm64' ? 0xaa64 : 0x8664, 68)
  return bytes
}

function fixture(extra = [], overrides = {}, arch = 'x64') {
  const stamp = { schemaVersion: 1, commit, tag: 'v0.1.5', baseVersion: '0.1.5', displayVersion: '0.1.5',
    payload: 'bundled', updateMechanism: 'external', distribution: 'desktop-app', runtime, ...overrides }
  const root = 'Aino/resources/'
  const files = [
    ['Aino/Aino Agent.exe', pe(arch)], [root + 'install-stamp.json', JSON.stringify(stamp)],
    [root + 'agent-payload/app/install-stamp.json', JSON.stringify(stamp)],
    [root + 'agent-payload/manifest.json', JSON.stringify({ schema: 1, target: `win32-${arch}`, runtime })],
    [root + 'agent-payload/tools/python/python.exe', pe(arch)],
    [root + 'agent-payload/bin/aino.exe', pe(arch)],
    [root + 'agent-payload/venv/Lib/site-packages/fixture.txt', 'dependency'],
  ]
  return [...files, ...extra].map(([name, data, mode]) => ({ name, data: Buffer.from(data).toString('base64'), mode }))
}

function archive(directory, rows) {
  const filename = path.join(directory, 'release.zip')
  execFileSync(python, ['-W', 'ignore::UserWarning', '-c', `import base64,json,stat,sys,zipfile
with zipfile.ZipFile(sys.argv[1], 'w', compression=zipfile.ZIP_DEFLATED) as z:
 for row in json.load(sys.stdin):
  info=zipfile.ZipInfo(row['name']); info.create_system=3
  info.external_attr=(row.get('mode') or (stat.S_IFREG | 0o644)) << 16
  z.writestr(info, base64.b64decode(row['data']))
`, filename], { input: JSON.stringify(rows) })
  return filename
}

async function temporary(work) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'released-windows-zip-'))
  try { return await work(directory) } finally { fs.rmSync(directory, { recursive: true, force: true }) }
}

function digest(filename) {
  return { size: fs.statSync(filename).size, sha256: createHash('sha256').update(fs.readFileSync(filename)).digest('hex') }
}

test('a pinned GitHub wrapper admits only its verified inner release ZIP before the existing provenance checks', async () => {
  for (const arch of ['x64', 'arm64']) await temporary(async directory => {
    const inner = archive(directory, fixture([], {}, arch))
    const pin = digest(inner)
    const wrapperRoot = path.join(directory, 'wrapper')
    fs.mkdirSync(wrapperRoot)
    const outer = archive(wrapperRoot, [{ name: `AinoBundled-0.1.5-win-${arch}.zip`, data: fs.readFileSync(inner).toString('base64') }])
    fs.rmSync(inner)
    const wrapper = digest(outer)
    const result = await extractReleasedWindowsZip({ archive: outer, ...pin, wrapper, out: path.join(directory, 'app'), arch, python })
    assert.equal(result.stamp.commit, commit)
    assert.deepEqual(result.artifactWrapper.outer, wrapper)
    assert.deepEqual(result.artifactWrapper.inner, pin)
    assert.equal(result.artifactWrapper.entry, `AinoBundled-0.1.5-win-${arch}.zip`)
    assert.equal(fs.existsSync(result.exe), true)
    assert.deepEqual(fs.readdirSync(wrapperRoot), [])
  })
})

test('bad wrapper or inner pins and any extra, unsafe, duplicate or linked wrapper member expose no application', async () => {
  for (const fault of ['outer-size', 'outer-hash', 'inner-size', 'inner-hash', 'extra', 'unsafe', 'duplicate', 'link']) {
    await temporary(async directory => {
      const inner = archive(directory, fixture())
      const pin = digest(inner)
      const name = 'AinoBundled-0.1.5-win-x64.zip'
      const row = { name, data: fs.readFileSync(inner).toString('base64') }
      const rows = [fault === 'unsafe' ? { ...row, name: `../${name}` } :
        fault === 'link' ? { ...row, mode: 0o120777 } : row]
      if (fault === 'extra') rows.push({ ...row, name: 'extra.zip' })
      if (fault === 'duplicate') rows.push(row)
      const wrapperRoot = path.join(directory, 'wrapper')
      fs.mkdirSync(wrapperRoot)
      const outer = archive(wrapperRoot, rows)
      const wrapper = digest(outer)
      if (fault === 'outer-size') wrapper.size++
      if (fault === 'outer-hash') wrapper.sha256 = 'f'.repeat(64)
      if (fault === 'inner-size') pin.size++
      if (fault === 'inner-hash') pin.sha256 = 'f'.repeat(64)
      const out = path.join(directory, 'app')
      const diagnostic = fault.endsWith('hash') ? /SHA-256 mismatch/ :
        fault.endsWith('size') ? /size mismatch/ : /wrapper|Unsafe ZIP|duplicate/i
      await assert.rejects(extractReleasedWindowsZip({ archive: outer, ...pin, wrapper, out, arch: 'x64', python }),
        diagnostic, fault)
      assert.equal(fs.existsSync(out), false, fault)
      assert.deepEqual(fs.readdirSync(wrapperRoot), [], fault)
    })
  }
})

test('a release ZIP pairs the desktop stamp with its executable and validates the separate runtime stamp', async () => {
  for (const arch of ['x64', 'arm64']) await temporary(async directory => {
    const zip = archive(directory, fixture([], {}, arch))
    const result = await extractReleasedWindowsZip({ archive: zip, size: fs.statSync(zip).size, out: path.join(directory, 'app'), arch, python })
    assert.equal(result.exe, path.join(directory, 'app/Aino/Aino Agent.exe'))
    assert.equal(result.payloadRoot, path.join(directory, 'app/Aino/resources/agent-payload'))
    assert.equal(result.stamp.commit, commit)
    assert.equal(result.archiveRemoved, true)
    assert.equal(fs.existsSync(zip), false)
    assert.ok(result.expandedSize > 0)
  })
})

test('unsafe archive paths, links and Windows case aliases never create an extraction tree', async () => {
  const cases = [
    ['../escape', 'bad'], ['/absolute', 'bad'], ['C:/drive', 'bad'], ['C:relative', 'bad'],
    ['\\\\server\\share', 'bad'], ['safe\\..\\escape', 'bad'], ['Aino/alias:stream', 'bad'],
    ['Aino/file.', 'bad'], ['Aino/link', 'target', 0o120777],
    ['aino/other.txt', 'case alias'], ['Aino/Resources/other.txt', 'parent case alias'],
    ['Aino/Aino Agent.exe', 'duplicate'],
  ]
  for (const entry of cases) await temporary(async directory => {
    const zip = archive(directory, fixture([entry]))
    const out = path.join(directory, 'app')
    await assert.rejects(extractReleasedWindowsZip({ archive: zip, size: fs.statSync(zip).size, out, arch: 'x64', python }), /Unsafe ZIP|collision|duplicate/i, entry[0])
    assert.equal(fs.existsSync(out), false, entry[0])
    assert.equal(fs.existsSync(zip), false, entry[0])
  })
})

test('wrong provenance, architecture and ambiguous desktop roots are rejected and cleaned', async () => {
  const wrongInner = fixture()
  const inner = wrongInner.find(row => row.name.endsWith('app/install-stamp.json'))
  inner.data = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(inner.data, 'base64')), commit: 'f'.repeat(40) })).toString('base64')
  const wrongPe = fixture()
  wrongPe.find(row => row.name.endsWith('python.exe')).data = pe('arm64').toString('base64')
  const cases = [
    { rows: fixture([], { commit: 'f'.repeat(40) }), arch: 'x64' },
    { rows: fixture([], { updateMechanism: 'app-installer' }), arch: 'x64' },
    { rows: fixture(), arch: 'arm64' },
    { rows: wrongInner, arch: 'x64' },
    { rows: wrongPe, arch: 'x64' },
    { rows: fixture(fixture().map(row => [row.name.replace(/^Aino\//, 'Other/'), Buffer.from(row.data, 'base64')])), arch: 'x64' },
  ]
  for (const item of cases) await temporary(async directory => {
    const zip = archive(directory, item.rows), out = path.join(directory, 'app')
    await assert.rejects(extractReleasedWindowsZip({ archive: zip, size: fs.statSync(zip).size, out, arch: item.arch, python }), /provenance|architecture|unique desktop/i)
    assert.equal(fs.existsSync(out), false)
    assert.equal(fs.existsSync(zip), false)
  })
})

test('the complete archive size must match before the extractor writes files', async () => {
  await temporary(async directory => {
    const zip = archive(directory, fixture()), out = path.join(directory, 'app')
    await assert.rejects(extractReleasedWindowsZip({ archive: zip, size: fs.statSync(zip).size + 1, out, arch: 'x64', python }), /size mismatch/i)
    assert.equal(fs.existsSync(out), false)
    assert.equal(fs.existsSync(zip), false)
  })
})

test('disk admission reports insufficient capacity before any archive extraction', async () => {
  await temporary(async directory => {
    const helper = fileURLToPath(new URL('./safe-windows-zip.py', import.meta.url))
    const result = spawnSync(python, [helper, 'space', directory, String(10n ** 25n)], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Insufficient disk space.*available/i)
    assert.deepEqual(fs.readdirSync(directory), [])
  })
})

test('an invalid download response removes the archive without exposing an executable', async context => {
  await temporary(async directory => {
    const disk = fs.statfsSync(directory)
    if (disk.bavail * disk.bsize < 2_100_000_000) return context.skip('Digest fixture requires production download disk admission')
    const original = globalThis.fetch
    globalThis.fetch = async () => new Response('wrong release bytes')
    try {
      await assert.rejects(stageReleasedWindowsZip({ arch: 'arm64', out: directory, python }), /Range response/)
      assert.deepEqual(fs.readdirSync(directory), [])
    } finally { globalThis.fetch = original }
  })
})
