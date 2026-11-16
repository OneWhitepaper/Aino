import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { expect, test } from 'vitest'

import { localBackendProcess, readProcessSnapshot } from './desktop-smoke-process.ts'

test('the installed psutil observes a real child incarnation without a PowerShell process', async (): Promise<void> => {
  const started = Date.now() / 1000
  const child = spawn(process.execPath, ['-e', 'console.log(process.pid);setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'pipe'] })

  try {
    await once(child.stdout, 'data')
    const snapshot = readProcessSnapshot(0)
    const observed = snapshot.processes.find(row => row.pid === child.pid)

    expect(observed).toMatchObject({ pid: child.pid, parentPid: process.pid, executable: fs.realpathSync(process.execPath) })
    expect(observed!.startedAt).toBeGreaterThanOrEqual(started - 2)
    expect(observed!.startedAt).toBeLessThanOrEqual(Date.now() / 1000)
    expect(snapshot.listeners).toEqual([])
  } finally {
    child.kill()
    await once(child, 'exit')
  }
})

test('a failed process observer reports its operation and cannot become an empty successful snapshot', (): void => {
  const previous = process.env.HERMES_PYTHON
  process.env.HERMES_PYTHON = path.join(os.tmpdir(), 'missing-aino-process-observer', 'python')

  try {
    expect(() => readProcessSnapshot(0)).toThrow(/OS process\/listener snapshot failed \(port=0, python=.*ENOENT/s)
  } finally {
    if (previous === undefined) { delete process.env.HERMES_PYTHON } else { process.env.HERMES_PYTHON = previous }
  }
})

test.runIf(process.platform !== 'win32')('a relocated payload manifest owns its Python and site while outside symlinks are refused', (): void => {
  const python = process.env.HERMES_PYTHON!
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aino-process-snapshot-payload-'))
  const payload = path.join(root, 'relocated payload')
  const previous = process.env.HERMES_PYTHON

  try {
    const site = path.join(payload, 'site')
    fs.mkdirSync(site, { recursive: true })
    const source = execFileSync(python, ['-I', '-c', 'import pathlib, psutil; print(pathlib.Path(psutil.__file__).parent)'], { encoding: 'utf8' }).trim()
    fs.cpSync(source, path.join(site, 'psutil'), { recursive: true })
    const launcher = path.join(payload, 'python')
    const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

    fs.writeFileSync(launcher, `#!/bin/sh\nexec ${quote(python)} "$@"\n`, { mode: 0o700 })
    fs.symlinkSync('python', path.join(payload, 'python-link'))
    fs.writeFileSync(path.join(payload, 'manifest.json'), JSON.stringify({ runtime: { storePython: 'python-link', sitePackages: 'site' } }))
    process.env.HERMES_PYTHON = path.join(root, 'foreign-python-must-not-run')
    expect(readProcessSnapshot(0, payload).processes.some(row => row.pid === process.pid)).toBe(true)
    fs.symlinkSync(python, path.join(payload, 'outside-python'))
    fs.writeFileSync(path.join(payload, 'manifest.json'), JSON.stringify({ runtime: { storePython: 'outside-python', sitePackages: 'site' } }))
    expect(() => readProcessSnapshot(0, payload)).toThrow('observer escapes the installed payload')
  } finally {
    process.env.HERMES_PYTHON = previous
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test.runIf(process.platform === 'win32')('Windows observes the installed listener with fixture psutil and rejects an unrelated owner', async (): Promise<void> => {
  const payload = fs.mkdtempSync(path.join(os.tmpdir(), 'aino-process-snapshot-msix-'))
  const site = path.join(payload, 'site')
  fs.mkdirSync(site)
  fs.writeFileSync(path.join(payload, 'python.exe'), 'The MSIX interpreter cannot be launched externally')
  fs.writeFileSync(path.join(site, 'psutil.py'), 'raise AssertionError("The observer must use fixture psutil")')
  fs.writeFileSync(path.join(payload, 'manifest.json'), JSON.stringify({ runtime: { storePython: 'python.exe', sitePackages: 'site' } }))
  const child = spawn(process.execPath, ['-e', 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>console.log(s.address().port))'], { stdio: ['ignore', 'pipe', 'pipe'] })

  try {
    const [chunk] = await once(child.stdout, 'data')
    const port = Number(chunk.toString().trim())
    const snapshot = readProcessSnapshot(port, payload)

    expect(snapshot.listeners).toContain(child.pid)
    const backend = localBackendProcess(port, process.pid, undefined, payload)

    expect(backend).toMatchObject({ pid: child.pid, parentPid: process.pid, ownership: 'child', executable: fs.realpathSync(process.execPath) })
    expect(backend.startedAt).toBeGreaterThan(0)
    expect(() => localBackendProcess(port, child.pid!, undefined, payload)).toThrow('found 0')
    fs.writeFileSync(path.join(payload, 'manifest.json'), JSON.stringify({ runtime: {
      storePython: path.relative(payload, process.execPath), sitePackages: 'site'
    } }))
    expect(() => readProcessSnapshot(port, payload)).toThrow('observer escapes the installed payload')
  } finally {
    child.kill()
    await once(child, 'exit')
    fs.rmSync(payload, { recursive: true, force: true })
  }
  // This native contract performs three independently bounded (30s) OS scans.
  // Vitest's 5s unit-test default can expire while a valid Windows query runs.
}, 120_000)
