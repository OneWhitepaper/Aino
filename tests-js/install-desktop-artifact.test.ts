import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { expect, it } from 'vitest'

const resolver = path.resolve(import.meta.dirname, '../tests/install/e2e-assets/desktop-artifact.cjs')
const { refreshPackagedLaunchSpec } = createRequire(import.meta.url)(resolver)

it('resolves the installed package identity for current and historical desktop builds', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'install-artifact-'))

  const cases = [
    { platform: 'linux', config: { executableName: 'Aino' }, artifact: 'linux-unpacked/Aino', binary: 'linux-unpacked/Aino' },
    { platform: 'darwin', config: { executableName: 'Aino' }, artifact: 'mac-arm64/Aino.app', binary: 'mac-arm64/Aino.app/Contents/MacOS/Aino' },
    { platform: 'win32', config: { executableName: 'Aino' }, artifact: 'win-unpacked/Aino.exe', binary: 'win-unpacked/Aino.exe' },
    { platform: 'linux', config: {}, artifact: 'linux-unpacked/hermes', binary: 'linux-unpacked/hermes' },
    { platform: 'darwin', config: {}, artifact: 'mac/Hermes.app', binary: 'mac/Hermes.app/Contents/MacOS/Hermes' },
    { platform: 'win32', config: {}, artifact: 'win-arm64-unpacked/Hermes.exe', binary: 'win-arm64-unpacked/Hermes.exe' },
    { platform: 'darwin', config: { executableName: 'Aino', mac: { executableName: 'Aino Desktop' } }, artifact: 'mac/Aino Desktop.app', binary: 'mac/Aino Desktop.app/Contents/MacOS/Aino Desktop' },
  ]

  try {
    for (const [index, sample] of cases.entries()) {
      const install = path.join(root, String(index))
      const desktop = path.join(install, 'apps/desktop')
      const output = path.join(desktop, 'packaged')
      const binary = path.join(output, sample.binary)
      mkdirSync(path.dirname(binary), { recursive: true })
      writeFileSync(binary, 'packaged desktop', { mode: 0o755 })
      writeFileSync(path.join(desktop, 'package.json'), JSON.stringify({
        name: 'hermes', productName: 'unused metadata name',
        build: { productName: 'Hermes', directories: { output: 'packaged' }, ...sample.config },
      }))

      const artifact = spawnSync(process.execPath, [resolver, install, sample.platform], { encoding: 'utf8' })
      expect(artifact.status, artifact.stderr).toBe(0)
      expect(artifact.stdout.trim()).toBe(path.join(output, sample.artifact))
      const executable = spawnSync(process.execPath, [resolver, install, sample.platform, 'executable'], { encoding: 'utf8' })
      expect(executable.status, executable.stderr).toBe(0)
      expect(executable.stdout.trim()).toBe(binary)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it.each([false, true])('loads the installed external builder config instead of stale package defaults (embedded=%s)', (embedded) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'install-artifact-config-'))
  const desktop = path.join(root, 'apps/desktop')
  const realConfig = path.resolve(import.meta.dirname, '../apps/desktop/electron-builder.config.cjs')

  const cases = [
    { platform: 'linux', relative: 'linux-arm64-unpacked/aino' },
    { platform: 'darwin', relative: 'mac-arm64/Aino.app/Contents/MacOS/Aino' },
    { platform: 'win32', relative: 'win-arm64-unpacked/Aino.exe' },
  ]

  try {
    mkdirSync(desktop, { recursive: true })
    writeFileSync(path.join(desktop, 'package.json'), JSON.stringify({
      name: 'hermes', productName: 'Aino',
      ...(embedded ? { build: { executableName: 'Hermes', directories: { output: 'obsolete' } } } : {}),
    }))
    // Execute the real config, including its platform override and extraMetadata.
    writeFileSync(path.join(desktop, 'electron-builder.config.cjs'), `module.exports = require(${JSON.stringify(realConfig)})`)

    for (const sample of cases) {
      const binary = path.join(desktop, 'release', sample.relative)
      mkdirSync(path.dirname(binary), { recursive: true })
      writeFileSync(binary, 'current packaged desktop', { mode: 0o755 })

      const result = spawnSync(process.execPath, [resolver, root, sample.platform, 'executable'], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_REPOSITORY: 'OneWhitepaper/Aino',
          HERMES_DESKTOP_VARIANT: 'store', HERMES_BUILD_COMMIT: 'b'.repeat(40),
          HERMES_PAYLOAD_TAG: 'v9.9.9+canary.20261121T000000Z', HERMES_PAYLOAD_VERSION: '9.9.9',
          _HERMES_CHANNEL_REQUEST_JSON: '{"invalid":"driver-owned channel"}' },
      })

      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout.trim()).toBe(binary)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('does not hide a broken installed config behind historical package metadata', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'install-artifact-broken-config-'))
  const desktop = path.join(root, 'apps/desktop')

  try {
    mkdirSync(path.join(desktop, 'release/linux-unpacked'), { recursive: true })
    writeFileSync(path.join(desktop, 'package.json'), JSON.stringify({
      name: 'hermes', build: { executableName: 'Hermes', directories: { output: 'release' } },
    }))
    writeFileSync(path.join(desktop, 'release/linux-unpacked/Hermes'), 'stale desktop', { mode: 0o755 })
    writeFileSync(path.join(desktop, 'electron-builder.config.cjs'), 'throw new Error("installed config is broken")')
    const result = spawnSync(process.execPath, [resolver, root, 'linux'], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('installed config is broken')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('uses each candidate platform for execute-bit checks when resolving all platforms', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'install-artifact-all-'))
  const desktop = path.join(root, 'apps/desktop')
  const binary = path.join(desktop, 'release/win-unpacked/Hermes.exe')

  try {
    mkdirSync(path.dirname(binary), { recursive: true })
    writeFileSync(binary, 'Windows executable does not need POSIX mode bits', { mode: 0o644 })
    writeFileSync(path.join(desktop, 'package.json'), JSON.stringify({
      name: 'hermes', productName: 'Hermes', build: { directories: { output: 'release' } },
    }))
    const result = spawnSync(process.execPath, [resolver, root, 'all', 'executable'], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe(binary)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('rejects empty, non-executable and ambiguous current artifacts without borrowing rollback copies', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'install-artifact-incomplete-'))
  const desktop = path.join(root, 'apps/desktop')
  const binary = path.join(desktop, 'release/linux-unpacked/aino')
  const other = path.join(desktop, 'release/linux-arm64-unpacked/aino')

  try {
    mkdirSync(path.dirname(binary), { recursive: true })
    writeFileSync(path.join(desktop, 'package.json'), JSON.stringify({ name: 'hermes', productName: 'Aino' }))
    writeFileSync(path.join(desktop, 'electron-builder.config.cjs'), `module.exports = {
      executableName: 'Aino', linux: { executableName: 'aino' }, directories: { output: 'release' }
    }`)

    for (const relative of ['linux-unpacked/Hermes', 'linux-unpacked/hermes', 'linux-unpacked.bak/aino', 'linux-unpacked.previous/aino']) {
      const stale = path.join(desktop, 'release', relative)
      mkdirSync(path.dirname(stale), { recursive: true })
      writeFileSync(stale, 'stale packaged desktop', { mode: 0o755 })
    }

    const resolve = () => spawnSync(process.execPath, [resolver, root, 'linux', 'executable'], { encoding: 'utf8' })
    expect(resolve().status).toBe(1)
    writeFileSync(binary, '', { mode: 0o755 })
    expect(resolve().status).toBe(1)
    writeFileSync(binary, 'current packaged desktop')

    if (process.platform !== 'win32') {
      chmodSync(binary, 0o644)
      expect(resolve().status).toBe(1)
      chmodSync(binary, 0o755)
    }

    expect(resolve().stdout.trim()).toBe(binary)
    mkdirSync(path.dirname(other), { recursive: true })
    writeFileSync(other, 'another current packaged desktop', { mode: 0o755 })
    const ambiguous = resolve()
    expect(ambiguous.status).toBe(1)
    expect(ambiguous.stderr).toContain('expected exactly one installed desktop executable, found 2')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('rejects stale previous-brand artifacts and incomplete current-brand app bundles', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'install-artifact-stale-'))

  try {
    const desktop = path.join(root, 'apps/desktop')
    const output = path.join(desktop, 'release')
    const staleBinaries = ['linux-unpacked/hermes', 'mac-arm64/Hermes.app/Contents/MacOS/Hermes', 'win-unpacked/Hermes.exe']

    for (const relative of staleBinaries) {
      const binary = path.join(output, relative)
      mkdirSync(path.dirname(binary), { recursive: true })
      writeFileSync(binary, 'previous build', { mode: 0o755 })
    }

    mkdirSync(path.join(output, 'mac-arm64/Aino.app'), { recursive: true })

    writeFileSync(path.join(desktop, 'package.json'), JSON.stringify({
      name: 'aino', productName: 'Aino', build: { executableName: 'Aino', directories: { output: 'release' } },
    }))

    for (const platform of ['linux', 'darwin', 'win32']) {
      const result = spawnSync(process.execPath, [resolver, root, platform], { encoding: 'utf8' })
      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('No packaged desktop artifact')
    }

    const oldExecutable = path.join(output, 'mac-arm64/Hermes.app/Contents/MacOS/Hermes')
    const spec = { matchedShape: 'packaged', argv: [oldExecutable, '--no-sandbox'], cwd: path.dirname(oldExecutable), env: { HERMES_HOME: '/isolated' } }
    expect(() => refreshPackagedLaunchSpec(spec, root, 'darwin')).toThrow('No packaged desktop artifact')
    const currentExecutable = path.join(output, 'mac-arm64/Aino.app/Contents/MacOS/Aino')
    mkdirSync(path.dirname(currentExecutable), { recursive: true })
    writeFileSync(currentExecutable, 'current build', { mode: 0o755 })
    expect(refreshPackagedLaunchSpec(spec, root, 'darwin')).toEqual({
      ...spec, argv: [currentExecutable, '--no-sandbox'], cwd: path.dirname(currentExecutable),
    })
    const sourceSpec = { ...spec, matchedShape: 'source', cwd: desktop }
    expect(refreshPackagedLaunchSpec(sourceSpec, root, 'darwin')).toBe(sourceSpec)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
