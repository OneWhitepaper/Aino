import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

import type { TestInfo } from '@playwright/test'
import { parse } from 'yaml'

import { buildAppEnv, createSandbox, type Sandbox, waitForAppReady } from './fixtures'
import { activeAccountSandbox, fixtureAccountTemplate, fixtureHomes, seedFixtureMetadata } from './platform-account-home'
import { replaceAccountWindow } from './platform-account-window'
import {
  auditFixtureText,
  fixtureEnvironment,
  guardedPlatformPython,
  installLoopbackNodeGuard,
  installLoopbackPythonGuard,
  launchGuardedDesktop,
  type NativeState,
  persistedFixtureText,
  startRealPlatformAPI
} from './platform-real-api'
import { stopFixtureGateway } from './platform-workspace-proof'
import { collectErrorBanners, expect, type Page, test } from './test'

// Requires AINO_NATIVE_API_ROOT to locate the real API repository when it is
// not checked out beside Aino, a Unix Docker endpoint for disposable DBs, and
// HERMES_DESKTOP_PYTHON (or the checkout .venv) with the runtime dependencies.
type API = Awaited<ReturnType<typeof startRealPlatformAPI>>
type Launch = Awaited<ReturnType<typeof launchGuardedDesktop>>

interface ImageRequest {
  path: string
  model: string
  quality: string
  purpose: string
  input_images: number
  output_width: number
  output_height: number
  source_matches?: boolean
}

interface ImageState extends NativeState {
  image_generation_requests: number
  image_edit_requests: number
  image_tool_results: number
  image_requests: ImageRequest[]
  image_protocol: Array<{ action: string; tools: string[]; last_tool_id: string }>
}

interface AccountWindow {
  hermesDesktop: {
    platformAccount: { status(): Promise<{ phase: string; account: { id: string } | null; error: unknown }> }
    platformModels: { list(): Promise<unknown> }
  }
}

function prepareImageEnvironment(sandbox: Sandbox, api: API) {
  // This account flow does not provision the independent Nous welcome trial.
  fs.writeFileSync(path.join(sandbox.hermesHome, 'config.yaml'), [
    'updates:', '  check: false', 'display:', '  language: en',
    'nous:', '  guest: false',
    'auxiliary:', '  title_generation:', '    enabled: false', ''
  ].join('\n'), { mode: 0o600 })
  fs.writeFileSync(path.join(sandbox.hermesHome, '.env'), '', { mode: 0o600 })
  const template = fixtureAccountTemplate(sandbox)
  fs.mkdirSync(template, { mode: 0o700 })
  fs.copyFileSync(path.join(sandbox.hermesHome, 'config.yaml'), path.join(template, 'config.yaml'))
  fs.writeFileSync(path.join(template, '.env'), '', { mode: 0o600 })
  seedFixtureMetadata(template)
  fs.writeFileSync(path.join(sandbox.userDataDir, 'platform-development.json'), JSON.stringify({
    enabled: true, origin: api.info.origin
  }), { mode: 0o600 })
  const inherited = buildAppEnv(sandbox)
  const env: Record<string, string> = { ...fixtureEnvironment(), HOME: sandbox.root }

  for (const key of [
    'HERMES_DESKTOP_USER_DATA_DIR', 'HERMES_DESKTOP_IGNORE_EXISTING', 'HERMES_DESKTOP_HERMES_ROOT',
    'HERMES_DESKTOP_APP_NAME', 'HERMES_DESKTOP_SKIP_QUIT_CONFIRM', 'HERMES_DESKTOP_SKIP_PROTOCOL_REGISTRATION',
    'HERMES_DESKTOP_ISOLATED_BACKEND', 'HERMES_DESKTOP_PYTHON'
  ]) {
    if (inherited[key]) { env[key] = inherited[key] }
  }

  env.HERMES_HOME = sandbox.hermesHome
  env.AINO_E2E_ACCOUNT_TEMPLATE = template
  env.HERMES_DESKTOP_CWD = path.dirname(api.info.fixture_path)
  env.PYTHONPATH = installLoopbackPythonGuard(sandbox.root)
  env.HERMES_DESKTOP_PYTHON = guardedPlatformPython(sandbox.root, env.PYTHONPATH,
    env.HERMES_DESKTOP_PYTHON || path.resolve(import.meta.dirname, '../../../.venv/bin/python'))

  return { env, nodeGuard: installLoopbackNodeGuard(sandbox.root) }
}

async function signIn(launched: Launch, api: API) {
  let { page } = launched
  await expect(page.getByRole('textbox', { name: 'Phone number', exact: true })).toBeVisible({ timeout: 90_000 })
  await page.getByRole('checkbox', { name: 'Keep me signed in on this device', exact: true }).uncheck()
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill(api.info.phone)
  await page.getByRole('button', { name: 'Send code', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Verification code', exact: true })).toBeVisible()
  const code = await api.control<{ code: string }>('code')

  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill(code.code)
  page = await replaceAccountWindow(launched, current => current.getByRole('button', { name: 'Sign in', exact: true }).click())
  await expect.poll(() => page.evaluate(async () => {
    const state = await (window as unknown as AccountWindow).hermesDesktop.platformAccount.status()

    return { phase: state.phase, error: state.error }
  })).toEqual({ phase: 'signed_in', error: null })
}

async function selectImageModel(page: Page, sandbox: Sandbox) {
  await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  await page.getByRole('button', { name: 'Model', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Apply as default', exact: true })).toBeVisible()
  const disclosure = page.getByRole('button', { name: 'Image generation', exact: true })

  await disclosure.click()
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
  const models = page.locator('[data-aino-image-models]')
  const model = models.getByRole('option', { name: /Fixture Image/ })

  await expect(model).toBeVisible()
  // cmdk ignores a parked pointer until a real mouse movement or wheel event.
  await page.mouse.move(0, 0)
  await model.click()
  const quality = models.getByRole('group', { name: 'Image quality', exact: true })

  await expect(quality.getByRole('button', { name: 'Auto', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await quality.getByRole('button', { name: 'High', exact: true }).click()
  await expect(quality.getByRole('button', { name: 'High', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await quality.getByRole('button', { name: 'Auto', exact: true }).click()
  await expect(quality.getByRole('button', { name: 'Auto', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => parse(fs.readFileSync(path.join(sandbox.hermesHome, 'config.yaml'), 'utf8')).image_gen)
    .toMatchObject({ provider: 'aino', model: 'fixture-image-model', quality: 'auto' })
}

async function renderedImage(page: Page, index: number) {
  // Compact history delivers generated media through the existing Markdown
  // image surface; active tool cards use the generated-image surface.
  const images = page.locator('[data-slot="aui_generated-image"] img:visible, [data-slot="aui_markdown-image"] img:visible')
  const image = images.nth(index)

  await expect(image).toBeVisible({ timeout: 30_000 })
  await expect(images).toHaveCount(index + 1)
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => ({
    loaded: node.complete && node.naturalWidth > 0,
    width: node.naturalWidth,
    height: node.naturalHeight
  }))).toMatchObject({ loaded: true })

  return image.evaluate((node: HTMLImageElement) => {
    const canvas = document.createElement('canvas')
    canvas.width = node.naturalWidth
    canvas.height = node.naturalHeight
    const context = canvas.getContext('2d')!

    context.drawImage(node, 0, 0)

    return {
      renderer: node.closest('[data-slot="aui_generated-image"], [data-slot="aui_markdown-image"]')?.getAttribute('data-slot'),
      width: node.naturalWidth, height: node.naturalHeight, pixels: [...context.getImageData(0, 0, 1, 1).data]
    }
  })
}

async function sendImageTurn(page: Page, marker: string) {
  const input = page.locator('[data-slot="composer-rich-input"]:visible')

  await input.fill(marker)
  await input.press('Enter')
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, { timeout: 90_000 })
}

function fixtureSources(apiRoot: string) {
  const files = execFileSync('git', [
    'ls-files', '--cached', '--others', '--exclude-standard', '-z',
    'backend/internal/repository/aino_*_integration_test.go'
  ], { cwd: apiRoot, encoding: 'utf8' }).split('\0').filter(Boolean)

  return files.map(filename => {
    const source = fs.readFileSync(path.join(apiRoot, filename), 'utf8')

    return { path: filename, sha256: createHash('sha256').update(source).digest('hex'), source }
  })
}

async function assertNativeImageGuards(sandbox: Sandbox, launched: Launch) {
  const active = await activeAccountSandbox(sandbox, launched)
  const guards: Record<string, string[]> = {}

  for (const home of fixtureHomes(sandbox)) {
    for (const marker of fs.existsSync(home) ? fs.readdirSync(home).filter(name => name.includes('network-guard-active')) : []) {
      guards[marker] = [...(guards[marker] ?? []), ...fs.readFileSync(path.join(home, marker), 'utf8').trim().split('\n')]
    }
  }

  for (const marker of ['node-network-guard-active', 'chromium-network-guard-active']) {
    expect(guards[marker]).toContain(String(launched.app.process().pid))
  }

  const owner = JSON.parse(fs.readFileSync(path.join(active.hermesHome, 'gateway.pid'), 'utf8')) as { pid: number }

  expect(guards['python-network-guard-active']).toContain(String(owner.pid))

  return guards
}

async function attachJSON(testInfo: TestInfo, name: string, value: unknown) {
  const filename = testInfo.outputPath(`${name}.json`)
  fs.writeFileSync(filename, JSON.stringify(value, null, 2), { mode: 0o600 })
  await testInfo.attach(name, { path: filename, contentType: 'application/json' })
}

test('native account image selection generates and edits through the real managed image tool', async ({ browserName: _browserName }, testInfo) => {
  test.setTimeout(300_000)
  let stage = 'compile-api'

  const advance = (next: string) => {
    stage = next
    fs.writeFileSync(testInfo.outputPath('native-image-progress.json'), JSON.stringify({ stage, at: new Date().toISOString() }), { mode: 0o600 })
  }

  advance(stage)
  const repoRoot = path.resolve(import.meta.dirname, '../../..')
  const apiRoot = process.env.AINO_NATIVE_API_ROOT || path.resolve(repoRoot, '../Aino-API')
  const apiSources = fixtureSources(apiRoot)
  const api = await startRealPlatformAPI(apiRoot)
  const sandbox = createSandbox('native-images')
  let launched: Launch | null = null
  const diagnostics: string[] = []

  try {
    const prepared = prepareImageEnvironment(sandbox, api)

    advance('launch')
    launched = await launchGuardedDesktop(prepared.env, prepared.nodeGuard)
    const { app, transportAudit } = launched

    app.on('window', current => {
      current.on('pageerror', error => diagnostics.push(error.message))
      current.on('console', message => diagnostics.push(message.text()))
    })
    app.process().stdout?.on('data', value => diagnostics.push(String(value)))
    app.process().stderr?.on('data', value => diagnostics.push(String(value)))
    advance('sign-in')
    await signIn(launched, api)
    const { page } = launched
    const active = await activeAccountSandbox(sandbox, launched)
    advance('gateway-ready')
    await waitForAppReady(launched as never, 120_000)
    await assertNativeImageGuards(sandbox, launched)
    advance('image-model-and-quality')
    await selectImageModel(page, active)
    await page.screenshot({ path: testInfo.outputPath('native-image-model-auto.png') })
    advance('text-model')
    await page.getByRole('button', { name: 'Close settings', exact: true }).click()
    await page.locator('[data-tour="sidebar-nav-new-session"]').click()
    await page.locator('[data-tour="model-pill"]').click()
    await page.locator('[data-platform-model-id="fixture-tool-model"]').click()
    await expect(page.locator('[data-tour="model-pill"]')).toContainText('fixture-tool-model')
    advance('generation-submit')
    await sendImageTurn(page, 'fixture-image-generate')
    advance('generation-render')
    const generated = await renderedImage(page, 0)

    await expect.poll(async () => (await api.control<ImageState>('state')).image_generation_requests).toBe(1)
    await expect.poll(async () => (await api.control<ImageState>('state')).image_tool_results).toBe(1)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, { timeout: 90_000 })
    await page.screenshot({ path: testInfo.outputPath('native-generated-image.png') })
    advance('edit-submit')
    await sendImageTurn(page, 'fixture-image-edit')
    advance('edit-render')
    const edited = await renderedImage(page, 1)

    await expect.poll(async () => (await api.control<ImageState>('state')).image_edit_requests).toBe(1)
    await expect.poll(async () => (await api.control<ImageState>('state')).image_tool_results).toBe(2)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, { timeout: 90_000 })
    const state = await api.control<ImageState>('state')

    expect(state.image_tool_results).toBe(2)
    const protocol = ['discover_image_search', 'discover_image_describe', 'tool_call_tool_calls', 'tool_call_stop']

    expect(state.image_protocol.map(request => request.action)).toEqual([...protocol, ...protocol])
    expect(state.image_requests).toMatchObject([
      { path: '/v1/images/generations', model: 'gpt-image-fixture', quality: 'auto', purpose: 'image', input_images: 0, output_width: 32, output_height: 32 },
      { path: '/v1/images/edits', model: 'gpt-image-fixture', quality: 'auto', purpose: 'image', input_images: 1, source_matches: true, output_width: 32, output_height: 32 }
    ])
    expect(generated).toMatchObject({ width: 32, height: 32, pixels: [34, 153, 221, 255] })
    expect(edited).toMatchObject({ width: 32, height: 32, pixels: [221, 153, 34, 255] })
    expect(state.usage_ledger.filter(row => row.desktop_purpose === 'image')).toHaveLength(2)
    const guards = await assertNativeImageGuards(sandbox, launched)
    expect(await collectErrorBanners(page)).toEqual([])
    await Promise.all(transportAudit.pending)
    expect(transportAudit.unexpectedRendererDestinations).toEqual([])

    for (const home of fixtureHomes(sandbox)) {
      for (const marker of ['blocked-network.txt', 'blocked-node-network.txt', 'blocked-chromium-network.txt']) {
        expect(fs.existsSync(path.join(home, marker)), `${home}/${marker}`).toBe(false)
      }
    }

    await page.screenshot({ path: testInfo.outputPath('native-edited-image.png') })

    advance('renderer-audit')

    const publicRenderer = await page.evaluate(async () => ({
      account: await (window as unknown as AccountWindow).hermesDesktop.platformAccount.status(),
      models: await (window as unknown as AccountWindow).hermesDesktop.platformModels.list(),
      storage: { ...localStorage }, body: document.body.innerText
    }))

    const audit = await auditFixtureText(api, [JSON.stringify(publicRenderer), ...diagnostics])

    const evidence = {
      aino_sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
      spec_sha256: createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex'),
      api_sha: api.apiSha,
      api_fixture_diff_sha256: createHash('sha256').update(fs.readFileSync(path.join(api.dir, 'api-source-working.diff'))).digest('hex'),
      api_fixture_sources: apiSources.map(({ path: filename, sha256 }) => ({ path: filename, sha256 })),
      generated, edited, state, audit, guards,
      boundary: 'Real native app, managed binding, Agent and image plugin; isolated real API handlers with synthetic loopback upstream pixels.'
    }

    advance('shutdown-audit')
    await app.close()
    launched = null
    stopFixtureGateway(sandbox)
    const persistedAudit = await auditFixtureText(api, [...persistedFixtureText(sandbox.hermesHome), ...persistedFixtureText(sandbox.userDataDir)])

    await attachJSON(testInfo, 'native-image-api-fixture-sources', apiSources)
    await attachJSON(testInfo, 'native-image-receipt', { ...evidence, persisted_audit: persistedAudit })
  } catch (error) {
    const runtime = fixtureHomes(sandbox).flatMap(home => {
      const logs = path.join(home, 'logs')

      return fs.existsSync(logs) ? persistedFixtureText(logs) : []
    })

    const state = await api.control<ImageState>('state')
    const page = launched?.page
    const renderer = page ? { url: page.url(), body: await page.locator('body').innerText() } : null

    await auditFixtureText(api, [...runtime, ...diagnostics, JSON.stringify(renderer)])
    await attachJSON(testInfo, 'native-image-startup-diagnostics', { diagnostics, runtime, state, renderer })
    await attachJSON(testInfo, 'native-image-stage', { stage, api_log: api.logPath })
    await launched?.page.screenshot({ path: testInfo.outputPath('native-image-failure.png') })
    throw error
  } finally {
    await launched?.app.close()
    stopFixtureGateway(sandbox)
    sandbox.cleanup()
    await api.close()
  }

  advance('complete')
})
