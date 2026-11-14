/**
 * Tests for electron/workspace-cwd.ts.
 *
 * Run with: node --test electron/workspace-cwd.test.ts
 */

import assert from 'node:assert/strict'
import path from 'node:path'

import { test } from 'vitest'

import { isPackagedInstallPath, resolveWorkspaceCwd } from './workspace-cwd'

const installRoot = path.resolve('/opt/Hermes')

test('isPackagedInstallPath returns false when not packaged', () => {
  assert.equal(isPackagedInstallPath(installRoot, { isPackaged: false, installRoots: [installRoot] }), false)
})

test('isPackagedInstallPath flags the install root itself', () => {
  assert.equal(isPackagedInstallPath(installRoot, { isPackaged: true, installRoots: [installRoot] }), true)
})

test('isPackagedInstallPath flags paths nested under the install root', () => {
  const nested = path.join(installRoot, 'resources', 'app.asar')

  assert.equal(isPackagedInstallPath(nested, { isPackaged: true, installRoots: [installRoot] }), true)
})

test('isPackagedInstallPath ignores paths outside the install root', () => {
  const homeProject = path.resolve('/home/user/projects/demo')

  assert.equal(isPackagedInstallPath(homeProject, { isPackaged: true, installRoots: [installRoot] }), false)
})

test('account-owned helpers prefer the account home and never enter the packaged install', () => {
  const home = path.resolve('/users/test')
  const accountHome = path.join(home, 'account-home')

  const options = {
    defaultProjectDir: installRoot,
    accountHome,
    home,
    isPackaged: true,
    sourceRepoRoot: installRoot,
    directoryExists: () => true,
    isPackagedInstallPath: (directory: string) => directory === installRoot,
    env: { HERMES_DESKTOP_CWD: path.join(home, 'other') }
  }

  assert.equal(resolveWorkspaceCwd(options), accountHome)
  assert.equal(
    resolveWorkspaceCwd({ ...options, defaultProjectDir: path.join(home, 'project') }),
    path.join(home, 'project')
  )
})
