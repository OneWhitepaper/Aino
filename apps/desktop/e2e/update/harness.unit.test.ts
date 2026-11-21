import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { expect, test } from 'vitest'

import { desktopMainProcesses, type InstallFacts, installProcesses, packagedExe, releaseDir } from './harness'

test.each(['aino', 'Aino', 'Hermes', 'hermes'])(
  'the installed update harness finds the packaged %s executable without selecting helpers',
  name => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update executable '))
    const facts = { checkout: root } as InstallFacts
    const dir = releaseDir(facts)
    const executable = path.join(dir, name)

    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'chrome_crashpad_handler'), 'helper', { mode: 0o755 })
      fs.writeFileSync(executable, 'desktop', { mode: 0o755 })
      const found = fs.statSync(packagedExe(facts))
      const expected = fs.statSync(executable)
      expect([found.dev, found.ino]).toEqual([expected.dev, expected.ino])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)

test('the installed update harness refuses a release containing only helper executables', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update helpers '))
  const facts = { checkout: root } as InstallFacts
  const dir = releaseDir(facts)

  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'chrome_crashpad_handler'), 'helper', { mode: 0o755 })
    expect(() => packagedExe(facts)).toThrow(/no packaged .* executable/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// Electron 44 zeroes its processes' /proc/<pid>/environ, so the installed app shows no
// HERMES_HOME. A copy of node under the install's release dir, started with an empty
// environment, is that process.
test.skipIf(process.platform !== 'linux')(
  'the install census still sees the packaged app when its environment names no HERMES_HOME',
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update census '))

    const facts = {
      hermesHome: path.join(root, 'home', '.hermes'),
      checkout: path.join(root, 'checkout')
    } as InstallFacts

    fs.mkdirSync(releaseDir(facts), { recursive: true })
    const exe = path.join(releaseDir(facts), 'Hermes')
    fs.copyFileSync(process.execPath, exe)
    const app = spawn(exe, ['-e', 'setTimeout(() => {}, 60_000)'], { env: {}, stdio: 'ignore' })

    try {
      await expect.poll(() => installProcesses(facts).map(proc => proc.pid)).toContain(app.pid)
      expect(desktopMainProcesses(facts).map(proc => proc.pid)).toEqual([app.pid])
    } finally {
      app.kill('SIGKILL')
      await expect.poll(() => installProcesses(facts).length).toBe(0)
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)

// Crashpad's handler runs from the same release dir with no `--type=` and is reparented to init,
// and it can outlive the app it served. The update spec signals the app it found as "relaunched":
// a handler taken for the app gets the SIGTERM and the real app is never asked to quit.
test.skipIf(process.platform !== 'linux')(
  "the packaged app's crash handler is not a Desktop main process",
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update census '))
    const facts = {
      hermesHome: path.join(root, 'home', '.hermes'),
      checkout: path.join(root, 'checkout')
    } as InstallFacts
    fs.mkdirSync(releaseDir(facts), { recursive: true })
    const exe = path.join(releaseDir(facts), 'Hermes')
    const handlerExe = path.join(releaseDir(facts), 'chrome_crashpad_handler')
    fs.copyFileSync(process.execPath, exe)
    fs.copyFileSync(process.execPath, handlerExe)

    const handler = spawn(
      handlerExe,
      ['-e', 'setTimeout(() => {}, 60_000)', '--', '--monitor-self-annotation=ptype=crashpad-handler'],
      {
        env: {},
        stdio: 'ignore'
      }
    )

    const app = spawn(exe, ['-e', 'setTimeout(() => {}, 60_000)'], { env: {}, stdio: 'ignore' })

    try {
      await expect
        .poll(() =>
          installProcesses(facts)
            .map(proc => proc.pid)
            .sort()
        )
        .toEqual([handler.pid, app.pid].sort())
      expect(desktopMainProcesses(facts).map(proc => proc.pid)).toEqual([app.pid])
    } finally {
      handler.kill('SIGKILL')
      app.kill('SIGKILL')
      await expect.poll(() => installProcesses(facts).length).toBe(0)
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)
