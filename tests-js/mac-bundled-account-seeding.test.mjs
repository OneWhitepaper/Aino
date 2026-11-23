import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import yaml from 'js-yaml'
import { afterEach, expect, test, vi } from 'vitest'

import { resolveDesktopHermesHome } from '../apps/desktop/electron/data-paths.mjs'
import { runMacBundledUpdate } from '../tests/install/e2e-assets/mac-bundled-update-driver.mjs'

const directories = []
const stopped = 'fixture stopped before native launch'
afterEach(() => {
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'old-account-seeding-'))
  directories.push(directory)
  const home = path.join(directory, 'installation-home')
  const userData = path.join(directory, 'user-data')
  fs.mkdirSync(home)
  fs.mkdirSync(userData)
  vi.stubEnv('HOME', path.join(directory, 'os-home'))
  vi.stubEnv('HERMES_HOME', home)
  vi.stubEnv('HERMES_DESKTOP_USER_DATA_DIR', userData)
  const rootConfig = { updates: { desktop_feed_base_url: 'http://127.0.0.1:49339' }, plugins: { enabled: ['fixture-plugin'] } }
  fs.writeFileSync(path.join(home, 'config.yaml'), yaml.dump(rootConfig))
  fs.writeFileSync(path.join(home, '.env'), 'FIXTURE_SETTING=retained\n')
  const accountEnv = path.join(directory, 'account-env.json')
  fs.writeFileSync(accountEnv, JSON.stringify({ HTTPS_PROXY: 'http://127.0.0.1:49340' }))
  const accountHome = resolveDesktopHermesHome({ home, accountWorkspace: {
    userData, origin: 'https://api.agentera.com.cn', userId: '17',
  } })
  const values = {
    'app-bin': path.join(directory, 'fixture.app', 'Contents', 'MacOS', 'Aino Agent'),
    'old-sha': '22a472fcbca8775f56c0f89374027b8e4c68ab5b',
    'chat-out': path.join(directory, 'chat'), shots: path.join(directory, 'shots'),
    'mock-url': 'http://127.0.0.1:49336', 'platform-account-env': accountEnv,
  }
  return { home, userData, accountHome, values, rootConfig }
}

test('OLD launch seeds the fixture account model and key while retaining the root loopback feed', async () => {
  const { home, userData, accountHome, values, rootConfig } = fixture()
  let atLaunch
  await expect(runMacBundledUpdate(values, async launch => {
    const config = path.join(accountHome, 'config.yaml')
    const env = path.join(accountHome, '.env')
    atLaunch = {
      config: fs.existsSync(config) ? yaml.load(fs.readFileSync(config, 'utf8')) : null,
      env: fs.existsSync(env) ? fs.readFileSync(env, 'utf8') : '',
      rootConfig: yaml.load(fs.readFileSync(path.join(home, 'config.yaml'), 'utf8')),
      launchEnv: launch.env,
    }
    throw new Error(stopped)
  })).rejects.toThrow(stopped)

  expect(atLaunch.config).toMatchObject({
    model: { default: 'mock-model', provider: 'custom', base_url: `${values['mock-url']}/v1` },
    display: { language: 'en' }, onboarding: { run: false },
  })
  expect(atLaunch.env).toContain('OPENAI_API_KEY=e2e-mock-key\n')
  expect(atLaunch.env).toContain(`OPENAI_BASE_URL=${values['mock-url']}/v1\n`)
  expect(atLaunch.rootConfig.updates).toEqual(rootConfig.updates)
  expect(atLaunch.rootConfig.plugins).toEqual(rootConfig.plugins)
  expect(atLaunch.launchEnv).toMatchObject({ HERMES_HOME: home, HERMES_DESKTOP_USER_DATA_DIR: userData,
    HTTPS_PROXY: 'http://127.0.0.1:49340' })
  expect(fs.readFileSync(path.join(home, '.env'), 'utf8')).toBe('FIXTURE_SETTING=retained\n')
})

test('OLD launch refuses to overwrite an existing account home before opening the app', async () => {
  const { accountHome, values } = fixture()
  fs.mkdirSync(accountHome, { recursive: true })
  const retained = 'model:\n  default: retained-user-model\n'
  fs.writeFileSync(path.join(accountHome, 'config.yaml'), retained)
  const launch = vi.fn(async () => { throw new Error(stopped) })

  await expect(runMacBundledUpdate(values, launch)).rejects.toThrow('refusing to seed an existing profile')
  expect(launch).not.toHaveBeenCalled()
  expect(fs.readFileSync(path.join(accountHome, 'config.yaml'), 'utf8')).toBe(retained)
  expect(fs.readdirSync(accountHome)).toEqual(['config.yaml'])
})

test('without an account fixture OLD launch leaves the unscoped home and account directory untouched', async () => {
  const { home, accountHome, values } = fixture()
  delete values['platform-account-env']
  const before = fs.readFileSync(path.join(home, 'config.yaml'), 'utf8')
  await expect(runMacBundledUpdate(values, async () => { throw new Error(stopped) })).rejects.toThrow(stopped)

  expect(fs.existsSync(accountHome)).toBe(false)
  expect(fs.readFileSync(path.join(home, 'config.yaml'), 'utf8')).toBe(before)
  expect(fs.readFileSync(path.join(home, '.env'), 'utf8')).toBe('FIXTURE_SETTING=retained\n')
})
