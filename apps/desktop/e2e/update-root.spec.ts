import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { expect, test } from '@playwright/test'

import { buildAppEnv, createSandbox, launchDesktop } from './fixtures'
import { seedOfflineUpdateCheckCache } from './platform-offline-update-cache'

interface NativeUpdatesWindow {
  hermesDesktop: { updates: { check(): Promise<Record<string, unknown>> } }
}

test('native update check accepts the explicitly selected linked worktree', async () => {
  const sandbox = createSandbox('update-worktree')
  const source = path.join(sandbox.root, 'source')
  const linked = path.join(sandbox.root, 'linked')
  const git = (args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'maintenance.auto=false',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=Update Test',
        '-c',
        'user.email=update-test@example.invalid',
        ...args
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim()
  let launched: Awaited<ReturnType<typeof launchDesktop>> | undefined

  try {
    git(['init', '-b', 'main', source])
    fs.mkdirSync(path.join(source, 'hermes_cli'))
    fs.writeFileSync(path.join(source, 'hermes_cli', 'main.py'), '# source-root fixture\n')
    git(['-C', source, 'add', '.'])
    git(['-C', source, 'commit', '-m', 'source fixture'])
    git(['-C', source, 'worktree', 'add', '-b', 'linked-runtime', linked])
    expect(fs.statSync(path.join(linked, '.git')).isFile()).toBe(true)
    const cached = seedOfflineUpdateCheckCache({
      userDataDir: sandbox.userDataDir,
      updateRoot: linked,
      branch: 'linked-runtime'
    })
    // Read-only update IPC needs neither a real provider nor a backend runtime.
    launched = await launchDesktop(
      buildAppEnv(sandbox, {
        HERMES_DESKTOP_HERMES_ROOT: linked,
        HERMES_DESKTOP_BOOT_FAKE: '1'
      })
    )
    await launched.page.waitForFunction(() =>
      Boolean((window as unknown as NativeUpdatesWindow).hermesDesktop?.updates)
    )
    const status = await launched.page.evaluate(() =>
      (window as unknown as NativeUpdatesWindow).hermesDesktop.updates.check()
    )

    expect(status).toMatchObject({
      supported: true,
      hermesRoot: linked,
      currentBranch: 'linked-runtime',
      currentSha: cached.currentSha,
      error: 'offline-fixture'
    })
    expect(await launched.app.evaluate(({ app }) => app.getPath('userData'))).toBe(sandbox.userDataDir)
  } finally {
    await launched?.app.close()
    sandbox.cleanup()
  }
})
