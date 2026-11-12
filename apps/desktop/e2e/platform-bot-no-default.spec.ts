/** Native account models remain selectable before any default has been chosen. */
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
import { stopFixtureGateway } from './platform-workspace-proof'
import { allowErrorBanners, collectErrorBanners, expect, type Page, test } from './test'

interface AccountWindow {
  hermesDesktop: { platformModels: { list(): Promise<Array<{ id: string; state: string; is_default: boolean }>> } }
}

function canonicalChat(home: string) {
  const file = path.join(home, 'state.db')

  if (!fs.existsSync(file)) {
    return null
  }

  const db = new DatabaseSync(file, { readOnly: true })

  try {
    return (db.prepare("SELECT id FROM sessions WHERE title = 'Bot Chat'").get()?.id as string | undefined) ?? null
  } finally {
    db.close()
  }
}

function defaultPreferences(page: Page) {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter(key => key.startsWith('aino.desktop.platform-default.'))
      .map(key => localStorage.getItem(key))
  )
}

async function switchMode(page: Page, mode: 'Aino' | 'Bot') {
  await page.locator('[data-sidebar-mode-header] button').click()
  await page.getByRole('menuitemradio', { name: new RegExp(`^${mode}(?:\\s|$)`) }).click()
  await expect(page.locator('[data-sidebar-mode-header]')).toContainText(mode)
}

async function capabilities(page: Page, tab?: 'Tools') {
  await page.getByRole('button', { name: 'Capabilities', exact: true }).click()
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('/capabilities')

  if (tab) {
    const toolTab = page.getByRole('tab', { name: /^Tools(?:\s+\d+)?$/ })
    await toolTab.click()
    await expect(toolTab).toHaveAttribute('aria-selected', 'true')
  }
}

function pickerMetrics(page: Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    const row = dialog?.querySelector('[role="option"][data-value="g9-glm-5.3-flash"]')
    const bounds = row?.getBoundingClientRect()
    const center = bounds && { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }

    const describe = (element: Element | null | undefined) => {
      if (!element) {
        return null
      }

      const style = getComputedStyle(element)

      return {
        tag: element.tagName,
        slot: element.getAttribute('data-slot'),
        className: element.className,
        rect: element.getBoundingClientRect().toJSON(),
        pointerEvents: style.pointerEvents,
        height: style.height,
        overflow: style.overflow,
        position: style.position,
        zIndex: style.zIndex
      }
    }

    return {
      center,
      elements: [
        '[role="dialog"]',
        '[data-slot="dialog-body"]',
        '[cmdk-root]',
        '[data-slot="command-input-wrapper"]',
        '[data-slot="command-list"]',
        '[role="option"]'
      ].map(selector => ({ selector, values: [...(dialog?.querySelectorAll(selector) ?? [])].map(describe) })),
      dialog: describe(dialog),
      choice: describe(row),
      hit: center ? describe(document.elementFromPoint(center.x, center.y)) : null
    }
  })
}

test('a Bot without a default opens from Skills, retains drafts and lets the user select an available account model', async ({
  browserName: _browserName
}, info) => {
  test.setTimeout(360_000)
  const sandbox = createSandbox('platform-bot-no-default')

  const api = await startRealPlatformAPI(path.resolve(import.meta.dirname, '../../../../Aino-API'), {
    selectableWithoutDefault: true
  })

  let launched: Awaited<ReturnType<typeof launchGuardedDesktop>> | null = null
  let accountSandbox = sandbox

  try {
    const template = fixtureAccountTemplate(sandbox)
    fs.mkdirSync(template, { mode: 0o700 })
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

    const env = {
      ...fixtureEnvironment(),
      ...buildAppEnv(sandbox),
      AINO_E2E_ACCOUNT_TEMPLATE: template,
      HERMES_DESKTOP_CDP_PORT: 'off',
      HERMES_DESKTOP_ISOLATED_BACKEND: '0',
      HERMES_DESKTOP_PYTHON: guardedPlatformPython(sandbox.root, pythonGuard, process.env.HERMES_DESKTOP_PYTHON!),
      HERMES_DESKTOP_CWD: path.dirname(api.info.fixture_path)
    }

    launched = await launchGuardedDesktop(env, installLoopbackNodeGuard(sandbox.root))
    let { page } = launched
    await expect(page.getByRole('textbox', { name: 'Phone number', exact: true })).toBeVisible()
    await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill(api.info.phone)
    await page.getByRole('button', { name: 'Send code', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Verification code', exact: true })).toBeVisible()
    await page
      .getByRole('textbox', { name: 'Verification code', exact: true })
      .fill((await api.control<{ code: string }>('code')).code)
    page = await replaceAccountWindow(launched, current =>
      current.getByRole('button', { name: 'Sign in', exact: true }).click()
    )
    // Account login replaces the renderer and its partition. Intercept this
    // static gallery on the account context; all model traffic stays native.
    await page
      .context()
      .route('https://nousresearch.github.io/hermes-agent/docs/api/skills.json', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      )
    await waitForAppReady(launched as never, 120_000)
    accountSandbox = await activeAccountSandbox(sandbox, launched)
    await expect.poll(() => defaultPreferences(page)).toEqual([])

    const catalogResult = await page.evaluate(async () => {
      try {
        const models = await (window as unknown as AccountWindow).hermesDesktop.platformModels.list()

        return {
          error: null,
          models: models.map(model => ({ id: model.id, state: model.state, is_default: model.is_default }))
        }
      } catch (error) {
        return { error: (error as { code?: string }).code ?? 'unknown', models: [] }
      }
    })

    expect(catalogResult.error).toBeNull()
    const catalog = catalogResult.models

    expect(catalog).toHaveLength(6)
    expect(catalog.every(model => model.state === 'available' && !model.is_default)).toBe(true)
    await info.attach('catalog-without-default', { contentType: 'application/json', body: JSON.stringify(catalog) })

    const ordinaryDraft = 'Keep this ordinary conversation draft while choosing a Bot model.'
    const editor = page.locator('[data-slot="composer-rich-input"]:visible')
    await editor.fill(ordinaryDraft)
    const ordinaryTarget = await page.locator('[data-chat-surface]:visible').getAttribute('data-composer-target')
    await capabilities(page)
    const beforeOpen = await api.control<NativeState>('state')
    await switchMode(page, 'Bot')
    await expect.poll(() => page.evaluate(() => location.hash)).not.toContain('/capabilities')
    await expect.poll(() => canonicalChat(accountSandbox.hermesHome), { timeout: 60_000 }).toBeTruthy()
    const chatId = canonicalChat(accountSandbox.hermesHome)!
    const botSurface = page.locator(`[data-chat-surface][data-session-anchor="session-tile:${chatId}"]:visible`)
    await expect(botSurface).toBeVisible({ timeout: 30_000 })
    const modelChoice = botSurface.getByRole('button', { name: 'Open model picker', exact: true })
    await expect(modelChoice).toBeEnabled()
    await expect(modelChoice).toHaveText('Choose model')
    await expect(botSurface.locator('[data-slot="composer-rich-input"]')).toBeEditable()
    expect((await api.control<NativeState>('state')).model_calls).toBe(beforeOpen.model_calls)
    expect(await defaultPreferences(page)).toEqual([])
    expect(await collectErrorBanners(page)).toEqual([])
    await page.screenshot({ path: info.outputPath('bot-awaiting-model.png') })

    // Reopening the still-unselected canonical chat must not adopt a backend fallback model.
    const pendingDraft = 'Keep this Bot draft before its first model choice.'
    await editor.fill(pendingDraft)
    await switchMode(page, 'Aino')
    await expect(editor).toHaveText(ordinaryDraft)
    await capabilities(page, 'Tools')
    await switchMode(page, 'Bot')
    await expect(botSurface).toBeVisible({ timeout: 30_000 })
    await expect(editor).toHaveText(pendingDraft)
    await expect(modelChoice).toBeEnabled()
    await expect(modelChoice).toHaveText('Choose model')
    expect(canonicalChat(accountSandbox.hermesHome)).toBe(chatId)
    expect((await api.control<NativeState>('state')).model_calls).toBe(beforeOpen.model_calls)
    expect(await defaultPreferences(page)).toEqual([])
    expect(await collectErrorBanners(page)).toEqual([])

    // Sending cannot spend money or consume the draft before a model has been chosen.
    const prompt = `Read ${api.info.fixture_path} and verify its content.`
    await editor.fill(prompt)
    allowErrorBanners()
    await editor.press('Enter')
    const recover = page.getByRole('button', { name: /^Choose (?:a )?model$/ }).first()
    await expect(recover).toBeVisible()
    await expect(editor).toHaveText(prompt)
    expect((await api.control<NativeState>('state')).model_calls).toBe(beforeOpen.model_calls)
    expect(await defaultPreferences(page)).toEqual([])
    const expectedErrors = await collectErrorBanners(page)
    expect(expectedErrors.length).toBeGreaterThan(0)
    expect(expectedErrors.every(error => /Model unavailable|This model isn't available/.test(error))).toBe(true)

    await recover.click()
    const picker = page.getByRole('dialog').filter({ hasText: 'GLM-5.3-Flash' })
    await expect(picker).toBeVisible()
    const beforePointer = await pickerMetrics(page)

    if (beforePointer.center) {
      await page.mouse.move(beforePointer.center.x, beforePointer.center.y)
    }

    const metricsPath = info.outputPath('picker-hit-test.json')
    fs.writeFileSync(metricsPath, JSON.stringify({ beforePointer, afterPointer: await pickerMetrics(page) }, null, 2))
    await info.attach('picker-hit-test', { path: metricsPath, contentType: 'application/json' })
    await page.screenshot({ path: info.outputPath('recovery-picker-before-choice.png') })
    await picker.getByRole('option', { name: /GLM-5\.3-Flash/ }).click()
    await picker.getByRole('button', { name: 'Apply to this chat', exact: true }).click()
    await expect(picker).toBeHidden()
    await expect(botSurface.getByRole('button', { name: /GLM-5\.3-Flash/ })).toBeVisible()
    await expect(editor).toHaveText(prompt)
    await editor.press('Enter')
    await expect(botSurface.getByText(`Verified ${api.info.fixture_content}`, { exact: false }).first()).toBeVisible({
      timeout: 60_000
    })
    await expect(botSurface.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expect
      .poll(async () => (await api.control<NativeState>('state')).usage_calls)
      .toBe(beforeOpen.usage_calls + 2)
    expect(await defaultPreferences(page)).toEqual([])
    await page.screenshot({ path: info.outputPath('bot-model-chosen.png') })
    const botDraft = 'Keep the Bot draft while browsing ordinary tools.'
    await editor.fill(botDraft)

    await switchMode(page, 'Aino')
    await expect(editor).toHaveText(ordinaryDraft)
    await capabilities(page, 'Tools')
    await switchMode(page, 'Bot')
    await expect.poll(() => page.evaluate(() => location.hash)).not.toContain('/capabilities')
    await expect(botSurface).toBeVisible({ timeout: 30_000 })
    await expect(editor).toHaveText(botDraft)
    expect(canonicalChat(accountSandbox.hermesHome)).toBe(chatId)
    await expect(botSurface.getByRole('button', { name: /GLM-5\.3-Flash/ })).toBeVisible()
    await page.screenshot({ path: info.outputPath('bot-restored-draft.png') })
    await switchMode(page, 'Aino')
    await expect(
      page.locator(`[data-chat-surface][data-composer-target="${ordinaryTarget}"] [data-slot="composer-rich-input"]`)
    ).toHaveText(ordinaryDraft)
    expect(await collectErrorBanners(page)).toEqual(expectedErrors)
    const receiptPath = info.outputPath('no-default-native-receipt.json')
    fs.writeFileSync(
      receiptPath,
      JSON.stringify(
        {
          canonical_session: chatId,
          final_state: await api.control<NativeState>('state'),
          defaults: await defaultPreferences(page)
        },
        null,
        2
      )
    )
    await info.attach('no-default-native-receipt', { contentType: 'application/json', path: receiptPath })
  } finally {
    if (launched) {
      const observedPath = info.outputPath('native-final-observations.json')
      fs.writeFileSync(
        observedPath,
        JSON.stringify(
          {
            bindings: await nativeBindingObservations(launched.app),
            state: await api.control<NativeState>('state')
          },
          null,
          2
        )
      )
      await info.attach('native-final-observations', { path: observedPath, contentType: 'application/json' })

      if (!launched.page.isClosed()) {
        await info.attach('last-window', { body: await launched.page.screenshot(), contentType: 'image/png' })
        await info.attach('last-alerts', {
          contentType: 'application/json',
          body: JSON.stringify(await collectErrorBanners(launched.page))
        })
      }

      await launched.app.close()
    }

    stopFixtureGateway(accountSandbox)
    await api.close()
    const fixtureLog = info.outputPath('fixture-api.log')
    fs.copyFileSync(api.logPath, fixtureLog)
    await info.attach('fixture-api-log', { path: fixtureLog, contentType: 'text/plain' })
    sandbox.cleanup()
  }
})
