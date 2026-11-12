/** Creating a Bot from the UI preserves the complete selected default's route. */
import * as fs from 'node:fs'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import * as path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { parse } from 'yaml'

import { buildAppEnv, createSandbox, waitForAppReady } from './fixtures'
import { activeAccountSandbox, fixtureAccountTemplate, seedFixtureMetadata } from './platform-account-home'
import { nativeBindingObservations, replaceAccountWindow } from './platform-account-window'
import {
  fixtureEnvironment,
  guardedPlatformPython,
  installLoopbackNodeGuard,
  installLoopbackPythonGuard,
  launchGuardedDesktop,
  startRealPlatformAPI
} from './platform-real-api'
import { stopFixtureGateway } from './platform-workspace-proof'
import { collectErrorBanners, expect, type Page, test } from './test'

interface ProviderWitness {
  model: string
  authorized: boolean
  path: string
}
interface ProfileConfig {
  model?: { provider?: string; default?: string; base_url?: string }
  providers?: Record<string, { base_url?: string; key_env?: string }>
}
interface StoredChat {
  id: string
  model: string
  model_config: string
}

const BUILTIN = 'g9-glm-5.3-flash'

const SOURCES = {
  aino: { model: BUILTIN, provider: '' },
  provider: { model: 'official-inherited-model', provider: 'deepseek' },
  custom: { model: 'relay-inherited-model', provider: 'custom:bot-relay' }
} as const

type Source = keyof typeof SOURCES

async function startProvider() {
  const requests: ProviderWitness[] = []
  const key = 'fixture-inherited-provider-key'

  const server = http.createServer(async (req, response) => {
    if (req.url === '/v1/models') {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({ data: Object.values(SOURCES).map(({ model }) => ({ id: model, object: 'model' })) })
      )

      return
    }

    if (req.url !== '/v1/chat/completions') {
      response.writeHead(404).end()

      return
    }

    const chunks: Buffer[] = []

    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk))
    }

    const body = JSON.parse(Buffer.concat(chunks).toString()) as { model: string; stream?: boolean }
    requests.push({ model: body.model, authorized: req.headers.authorization === `Bearer ${key}`, path: req.url })
    const text = `Inherited ${body.model} reached its own endpoint.`
    const usage = { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52 }

    if (body.stream) {
      response.setHeader('content-type', 'text/event-stream')
      response.write(
        `data: ${JSON.stringify({
          id: 'inherit-fixture',
          object: 'chat.completion.chunk',
          model: body.model,
          choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }]
        })}\n\n`
      )
      response.end(
        `data: ${JSON.stringify({
          id: 'inherit-fixture',
          object: 'chat.completion.chunk',
          model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage
        })}\n\ndata: [DONE]\n\n`
      )

      return
    }

    response.setHeader('content-type', 'application/json')
    response.end(
      JSON.stringify({
        id: 'inherit-fixture',
        object: 'chat.completion',
        model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage
      })
    )
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  return {
    key,
    requests,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
  }
}

function seedTemplate(home: string, source: Source, provider: Awaited<ReturnType<typeof startProvider>>) {
  const base = {
    updates: { check: false },
    onboarding: { run: false },
    approvals: { mode: 'off' },
    display: { language: 'en' },
    auxiliary: { title_generation: { enabled: false } }
  }

  const choices = {
    aino: {},
    provider: {
      model: {
        provider: SOURCES.provider.provider,
        default: SOURCES.provider.model,
        base_url: provider.url,
        api_mode: 'chat_completions',
        context_length: 64000
      }
    },
    custom: {
      model: {
        provider: SOURCES.custom.provider,
        default: SOURCES.custom.model,
        api_mode: 'chat_completions',
        context_length: 64000
      },
      providers: { 'bot-relay': { base_url: provider.url, key_env: 'BOT_RELAY_FIXTURE_KEY' } }
    }
  }

  fs.mkdirSync(home, { mode: 0o700 })
  fs.writeFileSync(path.join(home, 'config.yaml'), JSON.stringify({ ...base, ...choices[source] }))

  const secrets = {
    aino: '',
    provider: `DEEPSEEK_API_KEY=${provider.key}\nDEEPSEEK_BASE_URL=${provider.url}\n`,
    custom: `BOT_RELAY_FIXTURE_KEY=${provider.key}\n`
  }

  fs.writeFileSync(path.join(home, '.env'), secrets[source], { mode: 0o600 })
  seedFixtureMetadata(home)
}

function chatOnDisk(home: string, bot: string): StoredChat | null {
  const dbPath = path.join(home, 'profiles', bot, 'state.db')

  if (!fs.existsSync(dbPath)) {
    return null
  }

  const db = new DatabaseSync(dbPath, { readOnly: true })

  try {
    return (
      (db.prepare("SELECT id,model,model_config FROM sessions WHERE title='Bot Chat'").get() as unknown as
        StoredChat | undefined) ?? null
    )
  } finally {
    db.close()
  }
}

async function chooseBuiltinDefault(page: Page) {
  const catalog = await page.evaluate(() =>
    (
      window as unknown as {
        hermesDesktop: { platformModels: { list(): Promise<Array<{ id: string; is_default: boolean }>> } }
      }
    ).hermesDesktop.platformModels.list()
  )

  expect(catalog.find(model => model.is_default)?.id).toBe('gpt-6-astra')
  expect(catalog.find(model => model.id === BUILTIN)?.is_default).toBe(false)
  await page.evaluate(() => {
    location.hash = '/settings?tab=config:model'
  })
  await page.getByRole('button', { name: 'Choose an Aino built-in model', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Choose an Aino built-in model', exact: true })
  await picker.getByRole('option', { name: /GLM-5\.3-Flash/ }).click()
  await picker.getByRole('button', { name: 'Confirm choice', exact: true }).click()
  await page.getByRole('button', { name: 'Apply as default', exact: true }).click()
  await expect(page.locator('.default-main-model-current-value')).toContainText('GLM-5.3-Flash')
  await page.evaluate(() => {
    location.hash = '/'
  })
}

async function createBot(page: Page, name: string) {
  await page.locator('[data-sidebar-mode-header] button').click()
  await page.getByRole('menuitemradio', { name: /^Bot(?:\s|$)/ }).click()
  await page.getByRole('button', { name: 'New bot or group chat', exact: true }).click()
  await page.getByRole('menuitem', { name: /^New Bot$/i }).click()
  const dialog = page.getByRole('dialog', { name: /^New Bot$/i })
  await dialog.getByPlaceholder('Inbox Triage').fill(`Inherited ${name}`)
  await dialog.getByRole('button', { name: 'Advanced', exact: true }).click()
  await dialog.getByPlaceholder('inbox-triage').fill(name)
  // The default clone source and empty model fields are the actual inherited path.
  await dialog.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 60_000 })
  const row = page.locator(`[data-slot="bots-roster"] [data-roster-key="local::${name}"]`)
  await expect(row).toBeVisible({ timeout: 60_000 })
  await row.click()
}

let api: Awaited<ReturnType<typeof startRealPlatformAPI>>
// Separate real API state keeps signup cooldowns independent of model inheritance.
test.beforeEach(async () => {
  test.setTimeout(180_000)
  api = await startRealPlatformAPI(path.resolve(import.meta.dirname, '../../../../Aino-API'), {
    catalogWithDefault: true
  })
})
test.afterEach(async () => {
  await api?.close()
})

for (const source of Object.keys(SOURCES) as Source[]) {
  test(`new Bot inherits the ${source} default through its first real provider request`, async ({
    browserName: _browserName
  }, info) => {
    test.setTimeout(240_000)
    const sandbox = createSandbox(`inherit-${source}`)
    let provider: Awaited<ReturnType<typeof startProvider>> | null = null
    const bot = `inherit-${source}`
    let accountHome = sandbox
    let launched: Awaited<ReturnType<typeof launchGuardedDesktop>> | null = null
    const cleanupErrors: unknown[] = []

    try {
      provider = await startProvider()
      const template = fixtureAccountTemplate(sandbox)
      seedTemplate(template, source, provider)
      fs.writeFileSync(
        path.join(sandbox.userDataDir, 'platform-development.json'),
        JSON.stringify({ enabled: true, origin: api.info.origin })
      )
      const guard = installLoopbackPythonGuard(sandbox.root)

      const env = {
        ...fixtureEnvironment(),
        ...buildAppEnv(sandbox),
        AINO_E2E_ACCOUNT_TEMPLATE: template,
        HERMES_DESKTOP_CDP_PORT: 'off',
        HERMES_DESKTOP_ISOLATED_BACKEND: '0',
        HERMES_DESKTOP_PYTHON: guardedPlatformPython(sandbox.root, guard, process.env.HERMES_DESKTOP_PYTHON!),
        HERMES_DESKTOP_CWD: path.dirname(api.info.fixture_path)
      }

      launched = await launchGuardedDesktop(env, installLoopbackNodeGuard(sandbox.root))
      let { page } = launched
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
      accountHome = await activeAccountSandbox(sandbox, launched)

      if (source === 'aino') {
        await chooseBuiltinDefault(page)
      }

      await createBot(page, bot)
      await expect.poll(() => chatOnDisk(accountHome.hermesHome, bot), { timeout: 60_000 }).toBeTruthy()
      const chat = chatOnDisk(accountHome.hermesHome, bot)!
      const surface = page.locator(`[data-chat-surface][data-session-anchor="session-tile:${chat.id}"]:visible`)
      await expect(surface).toBeVisible()

      const config = parse(
        fs.readFileSync(path.join(accountHome.hermesHome, 'profiles', bot, 'config.yaml'), 'utf8')
      ) as ProfileConfig

      if (source === 'aino') {
        await expect(surface.getByText(`Verified ${api.info.fixture_content}`, { exact: true }).last()).toBeVisible({
          timeout: 60_000
        })
        expect(JSON.parse(chatOnDisk(accountHome.hermesHome, bot)!.model_config)).toMatchObject({
          model_source: 'aino',
          model_id: BUILTIN
        })

        const bindings = (await nativeBindingObservations(launched.app)).filter(
          entry => entry.profile === bot && entry.ok
        )

        expect(bindings.length).toBeGreaterThan(0)
        expect(bindings.every(entry => entry.modelId === BUILTIN)).toBe(true)
        expect(provider.requests).toEqual([])

        const preference = await page.evaluate(() =>
          Object.entries(localStorage).filter(([key]) => key.startsWith('aino.desktop.platform-default.'))
        )

        expect(
          preference.filter(([key, value]) => decodeURIComponent(key).includes(bot) && value === BUILTIN)
        ).toHaveLength(1)

        const receipt = JSON.stringify(
          {
            source,
            model: BUILTIN,
            api_default: 'gpt-6-astra',
            bindings,
            preference,
            stored_model: JSON.parse(chatOnDisk(accountHome.hermesHome, bot)!.model_config)
          },
          null,
          2
        )

        fs.writeFileSync(info.outputPath('inheritance-receipt.json'), receipt)
        await info.attach('builtin-model-route', { contentType: 'application/json', body: receipt })
      } else {
        await expect(
          surface.getByText(`Inherited ${SOURCES[source].model} reached its own endpoint.`, { exact: true }).last()
        ).toBeVisible({ timeout: 60_000 })
        expect(chatOnDisk(accountHome.hermesHome, bot)!.model).toBe(SOURCES[source].model)
        expect(config.model?.provider).toBe(SOURCES[source].provider)
        expect(config.model?.default).toBe(SOURCES[source].model)
        const endpoint = source === 'custom' ? config.providers?.['bot-relay']?.base_url : config.model?.base_url
        expect(endpoint).toBe(provider.url)
        expect(provider.requests.length).toBeGreaterThan(0)
        expect(provider.requests.every(request => request.model === SOURCES[source].model && request.authorized)).toBe(
          true
        )
        expect((await nativeBindingObservations(launched.app)).filter(entry => entry.profile === bot)).toEqual([])

        const receipt = JSON.stringify(
          {
            source,
            provider: config.model?.provider,
            model: config.model?.default,
            endpoint,
            requests: provider.requests
          },
          null,
          2
        )

        fs.writeFileSync(info.outputPath('inheritance-receipt.json'), receipt)
        await info.attach('provider-model-route', { contentType: 'application/json', body: receipt })
      }

      const errors = await collectErrorBanners(page)

      if (errors.length) {
        await page.getByRole('button', { name: /^Notifications and status/ }).click()
        const failedOpen = page.locator('.notification-list-item').filter({ hasText: 'Could not open' })

        if (await failedOpen.count()) {
          await failedOpen.first().click()
          await info.attach('bot-open-error-detail', {
            contentType: 'text/plain',
            body: await page.locator('.notification-panel-body').innerText()
          })
        }
      }

      expect(errors).toEqual([])
      await page.screenshot({ path: info.outputPath('inherited-bot-window.png') })
      await info.attach('inherited-bot-window', {
        path: info.outputPath('inherited-bot-window.png'),
        contentType: 'image/png'
      })
    } finally {
      const logs = path.join(accountHome.hermesHome, 'logs')

      const diagnostics = await Promise.allSettled([
        launched && !launched.page.isClosed()
          ? launched.page.screenshot().then(body => info.attach('final-window', { body, contentType: 'image/png' }))
          : Promise.resolve(),
        Promise.resolve().then(() => {
          if (fs.existsSync(logs)) {
            fs.cpSync(logs, info.outputPath('gateway-logs'), { recursive: true })
          }
        })
      ])

      const cleanup = [
        () => launched?.app.close(),
        () => stopFixtureGateway(accountHome),
        () => provider?.close(),
        () => sandbox.cleanup()
      ]

      for (const release of cleanup) {
        try {
          await release()
        } catch (error) {
          cleanupErrors.push(error)
        }
      }

      if (diagnostics.some(result => result.status === 'rejected') || cleanupErrors.length) {
        const attachment = await Promise.allSettled([
          info.attach('cleanup-status', {
            contentType: 'application/json',
            body: JSON.stringify({
              diagnosticFailures: diagnostics.filter(result => result.status === 'rejected').length,
              cleanupErrors: cleanupErrors.map(error => String(error))
            })
          })
        ])

        if (attachment[0].status === 'rejected') {
          console.error('Could not attach native cleanup diagnostics.')
        }
      }
    }

    if (cleanupErrors.length) {
      throw new AggregateError(cleanupErrors, 'Native fixture cleanup failed')
    }
  })
}
