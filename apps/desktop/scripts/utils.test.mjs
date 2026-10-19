import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { test } from 'vitest'

test.each([
  new URL('./utils.mjs', import.meta.url).href,
  new URL('../../../scripts/build/frontend-common.mjs', import.meta.url).href
])('entry detection runs symlinked scripts and leaves imports inert: %s', helper => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'script-entry-')))
  const source = path.join(temp, 'source')
  const alias = path.join(temp, 'alias')
  fs.mkdirSync(source)
  // Junctions exercise real directory aliases without Windows symlink privileges.
  fs.symlinkSync(source, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const entry = path.join(source, 'entry.mjs')
  fs.writeFileSync(entry, `import { isMain } from ${JSON.stringify(helper)}; console.log(isMain(import.meta.url));\n`)
  const run = (...args) => execFileSync(process.execPath, args, { cwd: temp, encoding: 'utf8' }).trim()
  try {
    assert.equal(run(entry), 'true')
    assert.equal(run(path.join(alias, 'entry.mjs')), 'true')
    assert.equal(run('--preserve-symlinks-main', path.join(alias, 'entry.mjs')), 'true')
    assert.equal(run('--input-type=module', '-e', `import ${JSON.stringify(pathToFileURL(entry).href)}`), 'false')
    fs.writeFileSync(path.join(temp, 'importer.mjs'), `import ${JSON.stringify(pathToFileURL(entry).href)};\n`)
    assert.equal(run(path.join(temp, 'importer.mjs')), 'false')
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})
