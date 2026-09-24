import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import { parseHermesVersion, resolveUpdateRoot } from './update-root'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')

function makeCheckout(name: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `aino-update-root-${name}-`))
  fs.mkdirSync(path.join(root, 'hermes_cli'))
  fs.writeFileSync(path.join(root, 'hermes_cli', 'main.py'), '# runtime\n', 'utf8')
  fs.mkdirSync(path.join(root, '.git'))

  return root
}

test('source checkout remains the update root for an unpackaged production bundle', () => {
  const sourceRoot = makeCheckout('source')
  const activeRoot = path.join(sourceRoot, 'missing', 'hermes-agent')

  try {
    assert.equal(
      resolveUpdateRoot({
        activeHermesRoot: activeRoot,
        actualPackaged: false,
        sourceRepoRoot: sourceRoot,
        overrideRoot: null,
        isSourceRoot: (root: string) => fs.existsSync(path.join(root, 'hermes_cli', 'main.py')),
        isGitCheckout: (root: string) => fs.existsSync(path.join(root, '.git'))
      }),
      sourceRoot
    )
  } finally {
    fs.rmSync(sourceRoot, { force: true, recursive: true })
  }
})

test('prefers an explicit source override, then the managed checkout', () => {
  const sourceRoot = makeCheckout('source')
  const overrideRoot = makeCheckout('override')
  const activeRoot = makeCheckout('active')

  try {
    const options = {
      activeHermesRoot: activeRoot,
      actualPackaged: false,
      isSourceRoot: (root: string) => fs.existsSync(path.join(root, 'hermes_cli', 'main.py')),
      isGitCheckout: (root: string) => fs.existsSync(path.join(root, '.git')),
      overrideRoot,
      sourceRepoRoot: sourceRoot
    }

    assert.equal(resolveUpdateRoot(options), overrideRoot)
    assert.equal(resolveUpdateRoot({ ...options, overrideRoot: null }), sourceRoot)
    assert.equal(resolveUpdateRoot({ ...options, overrideRoot: null, sourceRepoRoot: null }), activeRoot)
    assert.equal(resolveUpdateRoot({ ...options, overrideRoot: null, actualPackaged: true }), activeRoot)
  } finally {
    for (const root of [sourceRoot, overrideRoot, activeRoot]) {
      fs.rmSync(root, { force: true, recursive: true })
    }
  }
})

test('runtime version parsing reads the canonical Hermes declaration', () => {
  assert.equal(parseHermesVersion('"""module"""\n__version__ = "0.21.0"\n__release_date__ = "2026.8.31"\n'), '0.21.0')
  assert.equal(parseHermesVersion("__version__ = '0.20.6'\n"), '0.20.6')
  assert.equal(parseHermesVersion('# no version here\n'), null)
})

test('desktop packaging metadata follows the Hermes runtime version', () => {
  const python = process.env.PYTHON ?? 'python3'

  const runtimeVersion = execFileSync(python, ['-c', 'import hermes_cli; print(hermes_cli.__version__)'], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  }).trim()

  const desktopPackage = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'apps', 'desktop', 'package.json'), 'utf8'))

  assert.ok(runtimeVersion, 'hermes_cli must expose __version__ at runtime')
  assert.equal(
    desktopPackage.version,
    runtimeVersion,
    'Electron app.getVersion() and packaged artifact metadata must stay aligned with the Agent runtime.'
  )
})
