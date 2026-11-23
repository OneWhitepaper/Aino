/**
 * Failure class: FIRST RUN on a healthy install.
 *
 * A user who installed Hermes with scripts/install.sh and built the Desktop
 * app with `hermes desktop` opens the app. It must find that install and go
 * straight to chat — on the first launch and on every later one — and never
 * show the first-run setup chooser or start the bootstrap installer
 * (#123888, #123800: the chooser / installer came back on every launch while
 * the local install was healthy). The second launch drops the Desktop
 * bootstrap marker first: a usable install is recognised off the filesystem.
 *
 * Real entry point: the packaged app the install built, launched with the
 * install's environment and no HERMES_DESKTOP_HERMES_ROOT override, so the app
 * resolves the backend the way it does for a user ($HERMES_HOME/hermes-agent).
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { expect, test } from '@playwright/test'

import { readChatIdentity } from '../../../../tests-js/scripts/desktop-chat-smoke'
import { assertBackendOrigin, localBackendProcess } from '../../../../tests-js/scripts/desktop-smoke-process'
import { recordWebSockets, send, waitForInteractive } from '../core/harness'

import { accountHome } from './account-fixture'
import {
  backendServeProcesses,
  closeQuietly,
  diagnostics,
  type InstallFacts,
  installProcesses,
  launchInstalledApp,
  nonGatewayProcesses,
  startInstallSession,
  stopInstallGateway
} from './harness'

const RUN = Date.now().toString(36)
const U = (n: number) => `U${n}-${RUN}`
const A = (n: number) => `A${n}-${RUN}`

/** Every process of the install that is a bootstrap/installer run, sampled for the whole boot. */
function startInstallerSampler(facts: InstallFacts): { stop: () => string[] } {
  const seen = new Set<string>()

  const scan = () => {
    for (const proc of installProcesses(facts)) {
      if (/install\.sh|install\.ps1|bootstrap-runner|\bpm (bootstrap|install)\b/.test(proc.cmdline)) {
        seen.add(proc.cmdline.slice(0, 240))
      }
    }
  }

  const timer = setInterval(scan, 100)

  return {
    stop: () => {
      clearInterval(timer)
      scan()

      return [...seen]
    }
  }
}

test('a healthy local install opens straight to chat on every launch: no setup chooser, no bootstrap installer', async () => {
  const session = await startInstallSession()
  const { facts, provider, env } = session

  try {
    for (const launch of [1, 2]) {
      await test.step(launch === 1 ? 'launch 1' : 'launch 2, bootstrap marker absent', async () => {
        if (launch === 2) {
          // A usable install the Desktop bootstrap never stamped (a CLI install from before the
          // marker, or one whose marker was lost): usability, not the marker, decides.
          fs.rmSync(path.join(facts.checkout, '.hermes-bootstrap-complete'), { force: true })
        }

        const installer = startInstallerSampler(facts)

        const { app, page, logTail, firstRunScreensSeen } = await launchInstalledApp(facts, env).catch(error => {
          installer.stop()
          throw error
        })

        try {
          const ws = recordWebSockets(page)
          await waitForInteractive(app, page, 180_000).catch(error => {
            throw new Error(`${(error as Error).message}\n${diagnostics(facts, logTail())}`)
          })

          expect(
            firstRunScreensSeen(),
            `launch ${launch} of a healthy install showed the first-run setup chooser\n${diagnostics(facts, logTail())}`
          ).toEqual([])

          // Login changes the data home, not the installed code. gateway ensure may attach
          // to the account's shared multiplexer; prove its actual listener and source tree.
          const identity = await readChatIdentity(page)
          expect(fs.realpathSync(identity.hermesHome!)).toBe(fs.realpathSync(accountHome(facts)))
          expect(fs.realpathSync(identity.hermesRoot)).toBe(fs.realpathSync(facts.checkout))

          const connection = await page.evaluate(() => (window as unknown as {
            hermesDesktop: { getConnection: () => Promise<{ mode: string; baseUrl: string }> }
          }).hermesDesktop.getConnection())

          const base = new URL(connection.baseUrl)
          expect(connection.mode).toBe('local')
          expect(['127.0.0.1', 'localhost', '[::1]']).toContain(base.hostname)
          const backend = localBackendProcess(Number(base.port), app.process().pid!, accountHome(facts))
          assertBackendOrigin(backend, facts.checkout, 'source', { appReportedRoot: identity.hermesRoot,
            installedCommit: facts.headSha })
          expect(backendServeProcesses(facts).map(proc => proc.pid), `one gateway owner\n${diagnostics(facts)}`).toEqual([backend.pid])

          provider.script(U(launch), [{ text: [`${A(launch)} `, 'healthy ', 'install'] }])
          await send(page, `${U(launch)} hello`, 'Enter', ws)
          await expect(page.getByText(`${A(launch)} healthy install`)).toBeVisible({ timeout: 120_000 })

          expect(
            installer.stop(),
            `launch ${launch} of a healthy install started the bootstrap installer\n${diagnostics(facts, logTail())}`
          ).toEqual([])
        } finally {
          installer.stop()
          await closeQuietly(app)
        }

        await expect
          .poll(() => nonGatewayProcesses(facts).map(p => `${p.pid} ${p.cmdline.slice(0, 160)}`), {
            timeout: 30_000,
            message: 'quitting the app leaves nothing of the install running but its gateway'
          })
          .toEqual([])
        const stopped = stopInstallGateway(facts)
        expect(stopped.code, `hermes gateway stop\n${stopped.output}`).toBe(0)
        await expect
          .poll(() => installProcesses(facts).map(p => `${p.pid} ${p.cmdline.slice(0, 160)}`), {
            timeout: 30_000,
            message: 'stopping the gateway leaves nothing of the install running'
          })
          .toEqual([])
      })
    }

    expect(
      fs.existsSync(path.join(facts.hermesHome, 'hermes-agent', '.git')),
      'the install is still the git checkout the installer made'
    ).toBe(true)
  } finally {
    await session.close()
  }
})
