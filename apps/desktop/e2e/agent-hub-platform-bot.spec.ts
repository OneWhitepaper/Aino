import * as fs from 'node:fs'
import * as path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { buildAppEnv, createSandbox, waitForAppReady } from './fixtures'
import { activeAccountSandbox, fixtureAccountTemplate, seedFixtureMetadata } from './platform-account-home'
import { nativeBindingObservations, replaceAccountWindow } from './platform-account-window'
import {
  fixtureEnvironment,
  guardedPlatformPython,
  installLoopbackNodeGuard,
  installLoopbackPythonGuard,
  launchGuardedDesktop,
  type NativeState,
  startRealPlatformAPI
} from './platform-real-api'
import { inspectGatewayIdentity, stopFixtureGateway } from './platform-workspace-proof'
import { collectErrorBanners, type ElectronApplication, expect, type Page, test } from './test'

const BOT = 'fresh-platform-bot'

function gatewayReady(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const ready = (globalThis as unknown as { __AINO_E2E_GATEWAY_READY_WINDOWS__: Set<number> })
      .__AINO_E2E_GATEWAY_READY_WINDOWS__

    return BrowserWindow.getAllWindows().some(window => ready.has(window.webContents.id))
  })
}

function composer(page: Page) {
  return page.locator('[contenteditable="true"]:visible').first()
}

async function sendPrompt(page: Page, text: string, input = composer(page)) {
  await input.click()
  await input.pressSequentially(text)
  await expect(input).toHaveText(text)
  await input.press('Enter')
}

async function openHub(page: Page) {
  if (await page.getByRole('button', { name: 'New bot or group chat' }).isVisible()) {
    return
  }
  await page.getByRole('button', { name: /^Switch conversation mode:/ }).click()
  await page.getByRole('menuitemradio', { name: /^Bot(?:\s|$)/ }).click()
  await expect(page.getByRole('button', { name: 'New bot or group chat' })).toBeVisible()
}

function canonicalChat(home: string) {
  const file = path.join(home, 'profiles', BOT, 'state.db')

  if (!fs.existsSync(file)) {
    return undefined
  }

  const db = new DatabaseSync(file, { readOnly: true })

  try {
    return db.prepare("SELECT id FROM sessions WHERE title = 'Bot Chat'").get()?.id as string | undefined
  } finally {
    db.close()
  }
}

function userMessageSession(home: string, profile: string, prompt: string) {
  const file = path.join(home, ...(profile === 'default' ? [] : ['profiles', profile]), 'state.db')

  if (!fs.existsSync(file)) {
    return undefined
  }

  const db = new DatabaseSync(file, { readOnly: true })

  try {
    return db.prepare("SELECT session_id FROM messages WHERE role = 'user' AND instr(content, ?) > 0").get(prompt)
      ?.session_id as string | undefined
  } finally {
    db.close()
  }
}

test('new Agent Hub bot uses account models on the shared gateway and survives workspace switching and restart', async ({
  browserName: _browserName
}, info) => {
  test.setTimeout(360_000)
  const sandbox = createSandbox('agent-hub-platform')
  const api = await startRealPlatformAPI(path.resolve(import.meta.dirname, '../../../../Aino-API'))
  let launched: Awaited<ReturnType<typeof launchGuardedDesktop>> | null = null
  let accountSandbox = sandbox

  try {
    const template = fixtureAccountTemplate(sandbox)
    fs.mkdirSync(template, { mode: 0o700 })
    // The reported topology: an account default, with no provider/model in YAML.
    fs.writeFileSync(
      path.join(template, 'config.yaml'),
      'updates:\n  check: false\nonboarding:\n  run: false\napprovals:\n  mode: off\ndisplay:\n  language: en\nauxiliary:\n  title_generation:\n    enabled: false\n'
    )
    fs.writeFileSync(path.join(template, '.env'), '')
    seedFixtureMetadata(template)
    fs.writeFileSync(
      path.join(sandbox.userDataDir, 'platform-development.json'),
      JSON.stringify({ enabled: true, origin: api.info.origin })
    )
    const pythonGuard = installLoopbackPythonGuard(sandbox.root)
    const inherited = buildAppEnv(sandbox)

    const env = {
      ...fixtureEnvironment(),
      ...inherited,
      AINO_E2E_ACCOUNT_TEMPLATE: template,
      HERMES_DESKTOP_CDP_PORT: 'off',
      HERMES_DESKTOP_ISOLATED_BACKEND: '0',
      HERMES_DESKTOP_PYTHON: guardedPlatformPython(sandbox.root, pythonGuard, process.env.HERMES_DESKTOP_PYTHON!),
      HERMES_DESKTOP_CWD: path.dirname(api.info.fixture_path)
    }

    const nodeGuard = installLoopbackNodeGuard(sandbox.root)
    launched = await launchGuardedDesktop(env, nodeGuard)
    expect(await launched.app.evaluate(({ app }) => app.commandLine.hasSwitch('use-mock-keychain'))).toBe(true)
    let { page } = launched
    await expect(page.getByRole('textbox', { name: 'Phone number', exact: true })).toBeVisible()
    await page.getByRole('checkbox', { name: 'Keep me signed in on this device', exact: true }).check()
    await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill(api.info.phone)
    await page.getByRole('button', { name: 'Send code', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Verification code', exact: true })).toBeVisible()
    await page
      .getByRole('textbox', { name: 'Verification code', exact: true })
      .fill((await api.control<{ code: string }>('code')).code)
    page = await replaceAccountWindow(launched, current =>
      current.getByRole('button', { name: 'Sign in', exact: true }).click()
    )
    await waitForAppReady(launched as never, 120_000)
    accountSandbox = await activeAccountSandbox(sandbox, launched)
    const primary = inspectGatewayIdentity(accountSandbox)
    expect(primary).not.toBeNull()

    await openHub(page)
    await page.getByRole('button', { name: 'New bot or group chat' }).click()
    await page.getByRole('menuitem', { name: /^New Bot$/i }).click()
    const dialog = page.getByRole('dialog', { name: /^New Bot$/i })
    await dialog.getByPlaceholder('Inbox Triage').fill('Fresh Platform Bot')
    await dialog.getByRole('button', { name: 'Advanced', exact: true }).click()
    await dialog.getByPlaceholder('inbox-triage').fill(BOT)
    await dialog.getByRole('button', { name: 'Create Bot', exact: true }).click()
    await expect(dialog).toBeHidden({ timeout: 90_000 })
    const row = page.locator(`[data-slot="bots-roster"] [data-roster-key="local::${BOT}"]`)
    await expect(row).toBeVisible({ timeout: 60_000 })
    await row.click()
    await expect.poll(() => canonicalChat(accountSandbox.hermesHome)).toBeTruthy()
    const originalChat = canonicalChat(accountSandbox.hermesHome)

    // Native account binding must target the newly created profile, before its first turn.
    await expect
      .poll(async () => (await nativeBindingObservations(launched!.app)).filter(item => item.ok).length, {
        timeout: 60_000
      })
      .toBeGreaterThan(0)
    await expect(
      page
        .locator('[data-chat-surface]:visible [data-slot="aui_assistant-message-root"]')
        .getByText(`Verified ${api.info.fixture_content}`, { exact: true })
        .last()
    ).toBeVisible({ timeout: 60_000 })
    await expect(
      composer(page).locator('xpath=ancestor::form').getByRole('button', { name: 'Stop', exact: true })
    ).toHaveCount(0)
    const before = await api.control<NativeState>('state')
    const botBillingSession = before.usage_ledger[0]?.desktop_session_id
    expect(botBillingSession).toBeTruthy()
    expect(before.usage_ledger.every(entry => entry.desktop_session_id === botBillingSession)).toBe(true)
    await sendPrompt(page, `Read ${api.info.fixture_path} and verify its content again.`)
    await expect
      .poll(async () => (await api.control<NativeState>('state')).usage_calls, { timeout: 60_000 })
      .toBe(before.usage_calls + 2)
    await expect(
      composer(page).locator('xpath=ancestor::form').getByRole('button', { name: 'Stop', exact: true })
    ).toHaveCount(0)
    expect(inspectGatewayIdentity(accountSandbox)).toEqual(primary)
    expect(fs.existsSync(path.join(accountSandbox.hermesHome, 'profiles', BOT, 'gateway.pid'))).toBe(false)

    // Switch the whole workspace to the bot, rather than only opening its chat.
    await page.evaluate(() => {
      window.location.hash = '/profiles'
    })
    const settings = page.locator('[data-workspaces-page]')
    const defaultCard = settings.locator('[data-panel-row="default"] [data-slot="row-button"]')
    const botCard = settings.locator(`[data-panel-row="${BOT}"] [data-slot="row-button"]`)
    await defaultCard.click()
    const switchToDefault = settings.getByRole('button', { name: 'Switch to default', exact: true })

    if (await switchToDefault.isVisible()) {
      await switchToDefault.click()
    } else {
      // Creating a Bot now preserves the current workspace; there is nothing to switch.
      await expect(defaultCard).toHaveAttribute('aria-current', 'true')
      await page.evaluate(() => {
        window.location.hash = '/'
      })
    }

    await expect(settings).toBeHidden({ timeout: 60_000 })
    await page.evaluate(() => {
      window.location.hash = '/profiles'
    })
    await expect(defaultCard).toHaveAttribute('aria-current', 'true', { timeout: 60_000 })
    await botCard.click()
    await settings.getByRole('button', { name: 'Switch to Fresh Platform Bot', exact: true }).click()
    await expect(settings).toBeHidden({ timeout: 60_000 })
    await page.evaluate(() => {
      window.location.hash = '/profiles'
    })
    await expect(botCard).toHaveAttribute('aria-current', 'true', { timeout: 60_000 })
    await page.evaluate(() => {
      window.location.hash = '/'
    })
    await waitForAppReady(launched as never, 60_000)
    await page.locator('[data-sidebar-mode-header] button').click()
    await page.getByRole('menuitemradio', { name: /^Aino(?:\s|$)/ }).click()
    await page.getByRole('button', { name: 'New session', exact: true }).click()
    await page.locator('[data-tour="model-pill"]:visible').click()
    await expect(page.getByRole('menuitem', { name: /fixture-tool-model/ })).toBeVisible()
    await page.keyboard.press('Escape')
    const switched = await api.control<NativeState>('state')
    const workspacePrompt = `Read ${api.info.fixture_path} from this bot workspace and verify it.`
    await sendPrompt(page, workspacePrompt)
    await expect
      .poll(async () => (await api.control<NativeState>('state')).usage_calls, { timeout: 60_000 })
      .toBe(switched.usage_calls + 2)
    await expect(
      page
        .locator('[data-chat-surface]:visible [data-slot="aui_assistant-message-root"]')
        .getByText(`Verified ${api.info.fixture_content}`, { exact: true })
        .last()
    ).toBeVisible()
    await expect(
      composer(page).locator('xpath=ancestor::form').getByRole('button', { name: 'Stop', exact: true })
    ).toHaveCount(0)
    expect(inspectGatewayIdentity(accountSandbox)).toEqual(primary)
    expect(canonicalChat(accountSandbox.hermesHome)).toBe(originalChat)
    const workspaceSession = userMessageSession(accountSandbox.hermesHome, BOT, workspacePrompt)
    expect(workspaceSession).toBeTruthy()
    expect(workspaceSession).not.toBe(originalChat)
    expect(userMessageSession(accountSandbox.hermesHome, 'default', workspacePrompt)).toBeUndefined()
    const workspaceLedger = (await api.control<NativeState>('state')).usage_ledger.slice(switched.usage_ledger.length)
    const workspaceBillingSession = workspaceLedger[0]?.desktop_session_id
    expect(workspaceBillingSession).toBeTruthy()
    expect(workspaceBillingSession).not.toBe(botBillingSession)
    expect(workspaceLedger.every(entry => entry.desktop_session_id === workspaceBillingSession)).toBe(true)
    expect(await collectErrorBanners(page)).toEqual([])
    await page.screenshot({ path: info.outputPath('bot-workspace.png') })

    await launched.app.close()
    launched = null
    stopFixtureGateway(accountSandbox)
    launched = await launchGuardedDesktop(env, nodeGuard)
    page = launched.page
    await waitForAppReady(launched as never, 120_000)
    await info.attach('cold-before-ready-alerts', {
      contentType: 'application/json',
      body: JSON.stringify(await collectErrorBanners(page))
    })
    await expect.poll(() => gatewayReady(launched!.app), { timeout: 60_000 }).toBe(true)
    await info.attach('cold-ready-alerts', {
      contentType: 'application/json',
      body: JSON.stringify(await collectErrorBanners(page))
    })
    await openHub(page)
    await page.locator(`[data-slot="bots-roster"] [data-roster-key="local::${BOT}"]`).click()
    const restoredSurface = page.locator(
      `[data-chat-surface][data-session-anchor="session-tile:${originalChat}"]:visible`
    )
    await expect(restoredSurface).toBeVisible({ timeout: 60_000 })
    await expect(
      restoredSurface
        .locator('[data-slot="aui_assistant-message-root"]')
        .getByText(`Verified ${api.info.fixture_content}`, { exact: true })
        .last()
    ).toBeVisible({ timeout: 60_000 })
    await info.attach('cold-chat-open-alerts', {
      contentType: 'application/json',
      body: JSON.stringify(await collectErrorBanners(page))
    })
    expect(canonicalChat(accountSandbox.hermesHome)).toBe(originalChat)
    const restarted = await api.control<NativeState>('state')
    await sendPrompt(
      page,
      `Read ${api.info.fixture_path} after restart and verify it.`,
      restoredSurface.locator('[contenteditable="true"]').first()
    )
    await expect
      .poll(async () => (await api.control<NativeState>('state')).usage_calls, { timeout: 60_000 })
      .toBe(restarted.usage_calls + 2)
    const finalState = await api.control<NativeState>('state')
    expect(finalState.usage_ledger.every(entry => entry.user_id === finalState.user_id)).toBe(true)
    expect(finalState.usage_ledger.filter(entry => entry.desktop_session_id === botBillingSession)).toHaveLength(6)
    expect(finalState.usage_ledger.filter(entry => entry.desktop_session_id === workspaceBillingSession)).toHaveLength(
      2
    )
    expect(await collectErrorBanners(page)).toEqual([])
    await page.screenshot({ path: info.outputPath('bot-restarted.png') })
    const receiptPath = info.outputPath('bot-flow-receipt.json')
    fs.writeFileSync(
      receiptPath,
      JSON.stringify(
        {
          api_source: api.apiSha,
          profile: BOT,
          canonical_session: originalChat,
          workspace_session: workspaceSession,
          canonical_billing_session: botBillingSession,
          workspace_billing_session: workspaceBillingSession,
          original_gateway: primary,
          restarted_gateway: inspectGatewayIdentity(accountSandbox),
          final_state: finalState
        },
        null,
        2
      )
    )
    await info.attach('bot-flow-receipt', { contentType: 'application/json', path: receiptPath })
  } finally {
    if (launched) {
      await info.attach('native-bindings', {
        contentType: 'application/json',
        body: JSON.stringify(await nativeBindingObservations(launched.app))
      })

      if (!launched.page.isClosed()) {
        await info.attach('native-alerts', {
          contentType: 'application/json',
          body: JSON.stringify(await launched.page.locator('[role="alert"]').allTextContents())
        })
        await info.attach('final-window', { body: await launched.page.screenshot(), contentType: 'image/png' })
      }

      await launched.app.close()
    }

    const logs = path.join(accountSandbox.hermesHome, 'logs')

    if (fs.existsSync(logs)) {
      fs.cpSync(logs, info.outputPath('gateway-logs'), { recursive: true })
    }
    const botLogs = path.join(accountSandbox.hermesHome, 'profiles', BOT, 'logs')

    if (fs.existsSync(botLogs)) {
      fs.cpSync(botLogs, info.outputPath('bot-logs'), { recursive: true })
    }
    stopFixtureGateway(accountSandbox)
    await api.close()

    for (const name of ['api-exit-code.json', 'runtime-isolation.json', 'api-source-head.txt']) {
      await info.attach(name, { body: fs.readFileSync(path.join(api.dir, name)), contentType: 'text/plain' })
    }

    sandbox.cleanup()
  }
})
