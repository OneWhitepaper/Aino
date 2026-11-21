/** Real account prerequisites shared by all four installed-update journeys. */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { type ElectronApplication, type Page } from '@playwright/test'

import { platformLoginWorkspace, readFixturePlatformSession, signInPlatformFixture } from '../../../../tests-js/scripts/platform-account-fixture'
import { resolveDesktopHermesHome } from '../../electron/data-paths.mjs'

export interface AccountInstall {
  home: string
  sandboxRoot: string
}

export function accountHome(facts: AccountInstall): string {
  return resolveDesktopHermesHome({ home: facts.home, accountWorkspace: {
    userData: path.join(facts.sandboxRoot, 'user-data'), origin: 'https://api.agentera.com.cn', userId: '17'
  } })
}

/** Existing encrypted sessions must restore; re-signing in would hide a broken relaunch. */
export async function signInUpdateAccount(app: ElectronApplication, page: Page, requireExisting: boolean): Promise<Page> {
  const current = app.windows().filter(candidate => !candidate.isClosed()).at(-1) ?? page

  // Automatic restore can retire the initial window without any form submission.
  // Use the same workspace transition observer; never issue a fresh login here.
  const workspace = requireExisting
    ? await platformLoginWorkspace(app, current, async () => undefined)
    : await signInPlatformFixture(app, current, { keepSignedIn: true })

  await readFixturePlatformSession(workspace)

  return workspace
}

/** Accumulate stdout: a daemon's readiness line can cross arbitrary pipe chunks. */
export function waitForFixtureOutput(child: ChildProcess, description: string, pattern: RegExp,
  timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = ''
    let errors = ''

    const finish = (error?: Error, value?: string) => {
      clearTimeout(timer)
      child.stdout!.off('data', onData)
      child.stderr!.off('data', onStderr)
      child.off('error', onError)
      child.off('exit', onExit)
      child.stdin?.off('error', onError)
      child.stdout!.off('error', onError)
      child.stderr!.off('error', onError)

      if (error) { reject(error) } else { resolve(value!) }
    }

    const onData = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8192)
      const match = pattern.exec(output)

      if (match) { finish(undefined, match[0]) }
    }

    const onStderr = (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-2000) }
    const onError = (error: Error) => finish(error)

    const onExit = (code: number | null, signal: string | null) =>
      finish(new Error(`${description} exited (${code ?? signal}) before readiness: ${errors}`))

    const timer = setTimeout(() => finish(new Error(`${description} did not become ready: ${errors}`)), timeoutMs)
    child.stdout!.on('data', onData)
    child.stderr!.on('data', onStderr)
    child.once('error', onError)
    child.once('exit', onExit)
    child.stdin?.once('error', onError)
    child.stdout!.once('error', onError)
    child.stderr!.once('error', onError)

    if (child.exitCode !== null || child.signalCode !== null) { onExit(child.exitCode, child.signalCode) }
  })
}

/** Teardown is bounded even when a failed daemon ignores SIGTERM. */
export function stopFixtureChild(child: ChildProcess, graceMs = 2000): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) { return Promise.resolve() }

  return new Promise((resolve, reject) => {
    let killDeadline: ReturnType<typeof setTimeout> | undefined

    const finish = (error?: Error) => {
      clearTimeout(termDeadline)
      clearTimeout(killDeadline)
      child.off('exit', onExit)
      child.off('error', onError)

      if (error) { reject(error) } else { resolve() }
    }

    const onExit = () => finish()
    const onError = (error: Error) => finish(error)

    const termDeadline = setTimeout(() => {
      child.kill('SIGKILL')
      killDeadline = setTimeout(() => finish(new Error(`Fixture child ${child.pid} did not exit after SIGKILL`)), graceMs)
    }, graceMs)

    child.once('exit', onExit)
    child.once('error', onError)
    child.kill('SIGTERM')
  })
}

/** The control socket is announced before the unlocked login collection is exported. */
function keyringUnlocked(env: Record<string, string>): boolean {
  const call = (destination: string, object: string, ...method: string[]) => spawnSync('dbus-send',
    ['--session', '--print-reply', '--reply-timeout=500', `--dest=${destination}`, object, ...method],
    { env, encoding: 'utf8', timeout: 1000 })

  const owner = call('org.freedesktop.DBus', '/org/freedesktop/DBus',
    'org.freedesktop.DBus.NameHasOwner', 'string:org.freedesktop.secrets')

  // Do not auto-activate a second keyring while our foreground daemon is starting.
  if (owner.status !== 0 || !/boolean true/.test(owner.stdout)) { return false }

  const alias = call('org.freedesktop.secrets', '/org/freedesktop/secrets',
    'org.freedesktop.Secret.Service.ReadAlias', 'string:default')

  const collection = /object path "([^"]+)"/.exec(alias.stdout)?.[1]

  if (alias.status !== 0 || !collection || collection === '/') { return false }

  const locked = call('org.freedesktop.secrets', collection, 'org.freedesktop.DBus.Properties.Get',
    'string:org.freedesktop.Secret.Collection', 'string:Locked')

  return locked.status === 0 && /boolean false/.test(locked.stdout)
}

/** A private OS keyring, not basic_text or the developer's user bus. */
export async function startPrivateSecretService(root: string, baseEnv: Record<string, string>) {
  if (process.platform !== 'linux') { throw new Error('The installed update suite requires native Linux') }

  for (const command of ['dbus-daemon', 'gnome-keyring-daemon']) {
    const probe = spawnSync(command, ['--version'], { env: baseEnv, encoding: 'utf8', timeout: 10_000 })

    if (probe.status !== 0) {
      throw new Error(`Update account persistence requires ${command}; install dbus and gnome-keyring (no plaintext fallback)`)
    }
  }

  const control = path.join(root, 'keyring-control')
  fs.mkdirSync(control, { recursive: true, mode: 0o700 })
  const serviceEnv = { ...baseEnv }
  // Infrastructure is private to the test, not a gateway/update process of the install.
  delete serviceEnv.HERMES_HOME

  const bus = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1'], {
    env: serviceEnv, stdio: ['ignore', 'pipe', 'pipe']
  })

  let keyring: ChildProcess | undefined

  try {
    const address = (await waitForFixtureOutput(bus, 'Private account DBus', /^unix:[^\n]+\n/m)).trim()

    const env = { ...baseEnv, DBUS_SESSION_BUS_ADDRESS: address, GNOME_KEYRING_CONTROL: control,
      HERMES_DESKTOP_PASSWORD_STORE: 'gnome-libsecret' }

    keyring = spawn('gnome-keyring-daemon', ['--foreground', '--unlock', '--components=secrets',
      `--control-directory=${control}`], { env: { ...serviceEnv, DBUS_SESSION_BUS_ADDRESS: address,
      GNOME_KEYRING_CONTROL: control }, stdio: ['pipe', 'pipe', 'pipe'] })
    const ready = waitForFixtureOutput(keyring, 'Private account keyring', /^GNOME_KEYRING_CONTROL=[^\n]+\n/m)
    keyring.stdin!.end('isolated-update-fixture-keyring')
    await ready

    const deadline = Date.now() + 10_000

    while (!keyringUnlocked(env)) {
      if (keyring.exitCode !== null || keyring.signalCode !== null || Date.now() >= deadline) {
        throw new Error('Private account keyring has no usable unlocked login collection')
      }

      await new Promise(resolve => setTimeout(resolve, 25))
    }

    return { env, pids: [bus.pid!, keyring.pid!], close: async () => {
      try { await stopFixtureChild(keyring!) } finally { await stopFixtureChild(bus) }
    } }
  } catch (error) {
    try { if (keyring) { await stopFixtureChild(keyring) } } finally { await stopFixtureChild(bus) }
    throw error
  }
}
