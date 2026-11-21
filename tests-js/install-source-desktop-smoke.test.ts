import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { expect, it } from 'vitest'

const adapter = path.resolve(import.meta.dirname, '../tests/install/e2e-assets/source-desktop-smoke.mjs')

it('passes the configured executable to the chat driver and still refuses missing or ambiguous apps', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'source-desktop-smoke-'))
  const desktop = path.join(root, 'apps/desktop')
  const output = path.join(root, 'evidence')
  const capture = path.join(root, 'chat-arguments.json')

  const layouts: Partial<Record<NodeJS.Platform, string>> = {
    linux: 'linux-unpacked/aino',
    darwin: 'mac-arm64/Aino.app/Contents/MacOS/Aino',
    win32: 'win-unpacked/Aino.exe',
  }

  const relative = layouts[process.platform]

  if (!relative) {throw new Error(`Unsupported fixture host: ${process.platform}`)}
  const binary = path.join(desktop, 'release', relative)

  try {
    mkdirSync(path.dirname(binary), { recursive: true })
    writeFileSync(binary, 'current desktop', { mode: 0o755 })
    writeFileSync(path.join(desktop, 'package.json'), JSON.stringify({ name: 'hermes', productName: 'Aino' }))
    writeFileSync(path.join(desktop, 'electron-builder.config.cjs'), `module.exports = {
      executableName: 'Aino', linux: { executableName: 'aino' }, directories: { output: 'release' }
    }`)
    const probe = path.join(root, 'chat-probe.mjs')
    writeFileSync(probe, `import fs from 'node:fs';
      fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({args: process.argv.slice(2), cwd: process.cwd()}));`)
    const preload = path.join(root, 'chat-boundary.mjs')
    // Only replace the expensive GUI boundary; selection, parsing and spawning stay real.
    writeFileSync(preload, `import childProcess from 'node:child_process';
      import path from 'node:path';
      import { syncBuiltinESMExports } from 'node:module';
      const spawnSync = childProcess.spawnSync;
      childProcess.spawnSync = (command, args, options) => spawnSync(command,
        path.basename(args[0]) === 'desktop-smoke.ts' ? [${JSON.stringify(probe)}, ...args.slice(1)] : args, options);
      syncBuiltinESMExports();`)

    const args = ['--root', root, '--home', path.join(root, 'home'), '--user-data', path.join(root, 'user-data'),
      '--out', output, '--phase', 'new', '--expect-commit', 'a'.repeat(40), '--desktop', 'present', '--method', 'installer-script+desktop']

    const run = () => spawnSync(process.execPath, ['--import', preload, adapter, ...args], { encoding: 'utf8' })
    const good = run()
    expect(good.status, good.stderr).toBe(0)
    const observed = JSON.parse(readFileSync(capture, 'utf8'))
    expect(observed.args.slice(0, 4)).toEqual(['--exe', binary, '--origin', 'source'])
    expect(observed.cwd).toBe(realpathSync(root))

    rmSync(capture)
    rmSync(binary)
    const missing = run()
    expect(missing.status).toBe(1)
    expect(JSON.parse(readFileSync(path.join(output, 'desktop-chat-new.json'), 'utf8')).status).toBe('failed')
    expect(() => readFileSync(capture)).toThrow()

    writeFileSync(binary, 'current desktop', { mode: 0o755 })

    const alternatives: Partial<Record<NodeJS.Platform, string>> = {
      linux: 'linux-arm64-unpacked/aino', darwin: 'mac/Aino.app/Contents/MacOS/Aino', win32: 'win-arm64-unpacked/Aino.exe',
    }

    const other = path.join(desktop, 'release', alternatives[process.platform]!)
    mkdirSync(path.dirname(other), { recursive: true })
    writeFileSync(other, 'another desktop', { mode: 0o755 })
    const ambiguous = run()
    expect(ambiguous.status).toBe(1)
    expect(ambiguous.stderr).toContain('expected exactly one installed desktop executable, found 2')
    expect(() => readFileSync(capture)).toThrow()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
