import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'vitest'

import { thinPayloadBinaries } from './thin-payload.mjs'

test.skipIf(process.platform !== 'darwin')('retains only the native slice, bytes and mode while ignoring data and symlinks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-payload-slices-'))
  try {
    const source = path.join(root, 'probe.c')
    fs.writeFileSync(source, 'int answer(void) { return 42; }\n')
    const slices = ['arm64', 'x86_64'].map(arch => {
      const file = path.join(root, `${arch}.o`)
      execFileSync('clang', ['-target', `${arch}-apple-macos13.0`, '-c', source, '-o', file])
      return file
    })
    const fat = path.join(root, 'probe.o')
    execFileSync('lipo', ['-create', ...slices, '-output', fat])
    fs.chmodSync(fat, 0o755)
    fs.symlinkSync('probe.o', path.join(root, 'alias.o'))
    const java = Buffer.alloc(8)
    java.writeUInt32BE(0xcafebabe)
    java.writeUInt32BE(65, 4)
    fs.writeFileSync(path.join(root, 'Java.class'), java)

    assert.equal(thinPayloadBinaries(root, 'arm64'), 1)
    assert.equal(execFileSync('lipo', ['-archs', fat], { encoding: 'utf8' }).trim(), 'arm64')
    assert.deepEqual(fs.readFileSync(fat), fs.readFileSync(slices[0]))
    assert.equal(fs.statSync(fat).mode & 0o777, 0o755)
    assert.equal(fs.readlinkSync(path.join(root, 'alias.o')), 'probe.o')
    assert.deepEqual(fs.readFileSync(path.join(root, 'Java.class')), java)
    assert.equal(thinPayloadBinaries(root, 'arm64'), 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
