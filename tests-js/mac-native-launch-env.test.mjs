import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { resolveDesktopHermesHome, resolveDesktopUserData } from '../apps/desktop/electron/data-paths.mjs'
import { prepareNativeLaunchEnvironment, restoreNativeLaunchEnvironment } from '../tests/install/e2e-assets/mac-native-launch-env.mjs'

const directories = []
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }) })
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-launch-env-'))
  directories.push(directory)
  const stateFile = path.join(directory, 'prior.json')
  const values = { HERMES_HOME: '/prior/home', HTTPS_PROXY: 'http://prior-proxy:8080' }
  const launchctl = ([action, key, value]) => {
    if (action === 'getenv') return { status: key in values ? 0 : 1, stdout: values[key] || '' }
    if (action === 'setenv') values[key] = value
    else if (action === 'unsetenv') delete values[key]
    else throw new Error('Unexpected launchctl command')
    return { status: 0, stdout: '' }
  }
  return { directory, stateFile, values, launchctl }
}

test('native OS launch keeps the same sandbox without inheriting the old app environment', () => {
  const { directory, stateFile, values, launchctl } = fixture()
  const env = { HERMES_HOME: path.join(directory, 'agent'), HERMES_DESKTOP_USER_DATA_DIR: path.join(directory, 'desktop'),
    HTTPS_PROXY: 'http://127.0.0.1:12345', API_TOKEN: 'never-send-this-to-launchd' }
  prepareNativeLaunchEnvironment(env, stateFile, launchctl)

  expect(resolveDesktopHermesHome({ home: '/os-user', env: values, platform: 'darwin' })).toBe(env.HERMES_HOME)
  expect(resolveDesktopUserData('/os-user/Library/Application Support/Aino', values)).toBe(env.HERMES_DESKTOP_USER_DATA_DIR)
  expect(values.HTTPS_PROXY).toBe(env.HTTPS_PROXY)
  expect(values).not.toHaveProperty('API_TOKEN')
})

test('native fixture cleanup restores previous values and removes its temporary overrides', () => {
  const { directory, stateFile, values, launchctl } = fixture()
  const before = { ...values }
  prepareNativeLaunchEnvironment({ HERMES_HOME: path.join(directory, 'agent'),
    HERMES_DESKTOP_USER_DATA_DIR: path.join(directory, 'desktop') }, stateFile, launchctl)
  expect(values.HERMES_HOME).not.toBe(before.HERMES_HOME)

  restoreNativeLaunchEnvironment(stateFile, launchctl)
  expect(values).toEqual(before)
})
