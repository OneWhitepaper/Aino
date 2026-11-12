import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { copyDir } from 'builder-util'
import { test } from 'vitest'

import afterPack from './after-pack.mjs'
import { rehashPayloadDigests } from './payload-digests.mjs'

const repo = path.resolve(import.meta.dirname, '../../..')
const python = process.env.HERMES_PYTHON || 'python3'

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-pnpm-'))
  const staged = path.join(directory, 'staged')
  const payload = path.join(directory, 'resources', 'agent-payload')
  const entry = path.join(staged, 'tools', 'pnpm')
  const keep = path.join(entry, 'dist', 'node_modules', 'undici', 'lib', 'llhttp', '.gitkeep')
  fs.mkdirSync(path.dirname(keep), { recursive: true })
  fs.writeFileSync(keep, '')
  fs.writeFileSync(path.join(entry, 'pnpm'), 'native package fixture')
  fs.writeFileSync(path.join(staged, 'manifest.json'), '{}')
  const env = { ...process.env, HERMES_PYTHON: python,
    HERMES_HOME: path.join(directory, 'home'), HERMES_RUNTIME_DIR: path.join(directory, 'runtime') }
  delete env.PYTHONHOME
  delete env.PYTHONPATH
  const runPython = code => execFileSync(python, ['-c', code, staged, payload], { cwd: repo, env, encoding: 'utf8' }).trim()
  runPython('from pathlib import Path; import sys; from scripts.bundles.payload import record_tools; from pm.store import current_target; record_tools(Path(sys.argv[1]), Path("pm/lock.json"), current_target(), {"pnpm":"pnpm"})')
  const before = JSON.parse(fs.readFileSync(path.join(staged, 'tools', 'facts.json'), 'utf8'))
  const digest = () => runPython('from pathlib import Path; import sys; from pm.store import tree_digest; print(tree_digest(Path(sys.argv[2])/"tools/pnpm"))')
  const asar = path.join(directory, 'resources', 'app.asar')
  fs.mkdirSync(path.dirname(asar), { recursive: true })
  fs.writeFileSync(asar, 'fixture archive')
  fs.mkdirSync(path.join(`${asar}.unpacked`, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(`${asar}.unpacked`, 'dist', 'electron-main.mjs'),
    'const ready = /HERMES_(?:BACKEND|DASHBOARD)_READY[^\\n]*port=(\\d+)/m\n')
  return { directory, staged, payload, before, digest, env }
}

async function packedFixture() {
  const f = fixture()
  await copyDir(f.staged, f.payload)
  assert.equal(fs.existsSync(path.join(f.payload, 'tools/pnpm/dist/node_modules/undici/lib/llhttp/.gitkeep')), false)
  assert.notEqual(f.digest(), f.before.packages.pnpm.digest)
  return f
}

function withPython(env, run) {
  const previous = process.env.HERMES_PYTHON
  process.env.HERMES_PYTHON = env.HERMES_PYTHON
  return Promise.resolve().then(run).finally(() => {
    if (previous === undefined) delete process.env.HERMES_PYTHON
    else process.env.HERMES_PYTHON = previous
  })
}

test('the existing final-byte refresh preserves pinned pnpm identity after the native resource copier drops its empty marker', async () => {
  const f = await packedFixture()
  try {
    await withPython(f.env, () => rehashPayloadDigests(f.payload))
    const after = JSON.parse(fs.readFileSync(path.join(f.payload, 'tools', 'facts.json'), 'utf8'))
    assert.deepEqual(after.packages.pnpm, { ...f.before.packages.pnpm, digest: f.digest() })
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true })
  }
})

test.runIf(process.platform === 'linux')('Linux afterPack seals copied tool bytes and refuses missing facts without inventing them', async () => {
  const f = await packedFixture()
  try {
    const context = { electronPlatformName: process.platform, appOutDir: f.directory }
    await withPython(f.env, () => afterPack(context))
    const facts = path.join(f.payload, 'tools', 'facts.json')
    const after = JSON.parse(fs.readFileSync(facts, 'utf8'))
    assert.deepEqual(after.packages.pnpm, { ...f.before.packages.pnpm, digest: f.digest() })
    fs.unlinkSync(facts)
    await assert.rejects(withPython(f.env, () => afterPack(context)))
    assert.equal(fs.existsSync(facts), false)
    fs.unlinkSync(path.join(f.payload, 'manifest.json'))
    await withPython(f.env, () => afterPack(context))
    assert.equal(fs.existsSync(facts), false)
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true })
  }
})
