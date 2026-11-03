/**
 * C2 core: onboarding completion, then the first chat.
 *
 * Fresh sandbox, NO provider configured: the workspace stays available.
 * The user opens Settings → Model and configures a custom endpoint; the real
 * backend probes it (/v1/models), saves it, and applies it as the default.
 * Then the first chat must obey the same
 * transcript oracle as everything else. A smoke test for onboarding followed
 * by a first chat; the #120005 double-paint needs a non-default profile and is
 * guarded by transcript-integrity.spec.ts.
 *
 * Invariants: the onboarding result is what the backend persisted and what
 * the model is actually called with (config base_url == entered URL; the
 * first completion carries the endpoint's advertised model); one live socket
 * to the backend after onboarding; every message exactly once, DOM ==
 * persisted, streamed == provider, at every sampled frame.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { expect, test } from '@playwright/test'
import { parse } from 'yaml'

import {
  coreAppEnv,
  createCoreSandbox,
  currentSessionId,
  launchCoreApp,
  recordWebSockets,
  send,
  signInCoreAccount,
  waitForInteractive
} from './harness'
import { assertTranscriptOracle, installDuplicateSampler } from './oracle'
import { startScriptedProvider } from './provider'

const nonce = Math.random()
  .toString(36)
  .slice(2, 8)
  .replace(/[^a-z0-9]/g, 'x')
  .padEnd(4, 'q')

const U = (n: number) => `U${n}-${nonce}`
const A = (n: number) => `A${n}-${nonce}`

test('model settings (custom endpoint) then first chat renders exactly once', async () => {
  const provider = await startScriptedProvider()
  const sandbox = createCoreSandbox('onboard')
  // A fresh desktop install starts the first-run onboarding chat on the free trial, and once a
  // provider is configured it starts it on that provider at the next launch (#137522, #137807). This
  // spec covers explicit model setup without the trial, then plain chats: no guest trial,
  // onboarding recorded as done. Keep the core harness's development account and English UI.
  fs.writeFileSync(path.join(sandbox.hermesHome, 'config.yaml'), [
    'account:', '  dev_mode: true',
    'display:', '  language: en',
    'nous:', '  guest: false',
    'onboarding:', '  run: false',
    ''
  ].join('\n'))
  const { app, page } = await launchCoreApp(coreAppEnv(sandbox))
  const ws = recordWebSockets(page)

  try {
    await signInCoreAccount(page)
    await installDuplicateSampler(page)

    await test.step('Settings → Model: configure and apply a custom endpoint', async () => {
      await waitForInteractive(app, page)
      await expect(page.getByRole('button', { name: "I'll choose a provider later", exact: true })).toHaveCount(0)
      await page.getByRole('button', { name: 'Open settings', exact: true }).click()
      await page.locator('.settings-navigation-items').getByRole('button', { name: 'Model', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Model', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Custom models', exact: true }).click()
      await page.getByRole('button', { name: 'Configure custom models', exact: true }).click()

      const form = page.getByRole('dialog', { name: 'Configure custom models', exact: true })

      await form.getByRole('textbox', { name: 'Name', exact: true }).fill('core-onboarding')
      await form.getByRole('textbox', { name: 'Endpoint URL', exact: true }).fill(provider.url)
      await form.getByRole('button', { name: 'Test connection', exact: true }).click()
      // The model must come from real endpoint discovery, not a fixture config write.
      await expect(form.getByRole('combobox', { name: 'Model name', exact: true })).toHaveValue('mock-model')
      await form.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(form).toHaveCount(0)

      // Saving a connection leaves the current model unchanged; the user explicitly applies it.
      await page.getByRole('combobox', { name: 'Custom connection', exact: true }).click()
      await page.getByRole('option', { name: 'core-onboarding', exact: true }).click()
      await page.getByRole('combobox', { name: 'Model', exact: true }).click()
      await page.getByRole('option', { name: 'mock-model', exact: true }).click()
      await page.getByRole('button', { name: 'Apply as default', exact: true }).click()
      await expect(page.locator('.default-main-model-current-value')).toContainText('mock-model')
      await page.getByRole('button', { name: 'Close settings', exact: true }).click()
      await waitForInteractive(app, page)
    })

    await test.step('the persisted assignment is what the user entered', async () => {
      const config = parse(fs.readFileSync(path.join(sandbox.hermesHome, 'config.yaml'), 'utf8'))

      expect(config.model.provider).toBe('core-onboarding')
      expect(config.model.default).toBe('mock-model')
      expect(config.model.base_url).toContain(`127.0.0.1:${new URL(provider.url).port}`)
      expect(config.providers['core-onboarding'].base_url).toBe(config.model.base_url)
    })

    await test.step('first chat after onboarding renders exactly once', async () => {
      provider.script(U(1), [
        { reasoning: ['R1-', nonce, ' thinking'], text: [`${A(1)} `, 'first ', 'reply ', 'after ', 'setup'] }
      ])
      await send(page, `${U(1)} hello`, 'Enter', ws)
      await expect
        .poll(() => provider.completions.some(c => c.marker === U(1) && c.finished), {
          timeout: 120_000,
          message: 'the first chat after onboarding reached the configured endpoint'
        })
        .toBe(true)
      const first = provider.completions.find(c => c.marker === U(1))
      // The fake endpoint advertises exactly one model at /v1/models.
      expect(first?.body?.model, 'the model is called with the endpoint-advertised model').toBe('mock-model')
      await expect.poll(() => currentSessionId(page)).not.toBe('')
      const sessionId = await currentSessionId(page)
      await assertTranscriptOracle(
        page,
        ws,
        provider,
        { sessionId, expectUserMarkers: [U(1)] },
        'first chat after onboarding'
      )
      await expect
        .poll(() => ws.sockets.filter(s => !s.closed).length, { timeout: 30_000, message: 'live backend sockets' })
        .toBe(1)
    })

    await test.step('second turn and a reload keep it exactly once', async () => {
      provider.script(U(2), [{ text: [`${A(2)} `, 'second ', 'reply'] }])
      await send(page, `${U(2)} again`, 'Enter', ws)
      await expect
        .poll(() => provider.completions.some(c => c.marker === U(2) && c.finished), { timeout: 120_000 })
        .toBe(true)
      const sessionId = await currentSessionId(page)
      await assertTranscriptOracle(page, ws, provider, { sessionId, expectUserMarkers: [U(1), U(2)] }, 'second turn')
      await page.reload()
      await waitForInteractive(app, page)
      await installDuplicateSampler(page)
      await expect.poll(() => currentSessionId(page)).toBe(sessionId)
      await assertTranscriptOracle(
        page,
        ws,
        provider,
        { sessionId, expectUserMarkers: [U(1), U(2)] },
        'reload after onboarding'
      )
    })
  } finally {
    await app.close().catch(() => undefined)
    await provider.close()
    sandbox.cleanup()
  }
})
