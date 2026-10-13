import { writeEnvFile, writeMockProviderConfig } from '../../../tests-js/scripts/mock-provider-config'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { startMockServer } from '../../../tests-js/scripts/mock-server'

import { buildAppEnv, createSandbox, waitForAppReady,  } from './fixtures'
import { assertEdgeAlerts, observeEdgeAlerts, observeNativeRuntime, sendPrompt, sendToolTurn, verifyConcurrentAccountLifecycle, verifyOfflineAndAuthorizationRecovery } from './platform-account-edge-proof'
import { verifyNativeCompressionAfterRestart, verifyNativeCompressionBeforeRestart } from './platform-compression-proof'
import { observeInferenceAlerts, verifyInferenceFailures } from './platform-inference-failure-proof'
import { assertIsolationAlerts, type IsolationParticipant, observeIsolationAlerts, verifyConcurrentIsolation, verifyRetainedHistoryIsolation } from './platform-isolation-proof'
import { assertLateLeaseAlerts, observeLateLeaseAlerts, verifyLateLeaseAcrossAccountSwitch } from './platform-late-lease-proof'
import { installPackagedPythonTransport, launchGuardedPackagedDesktop, PACKAGED_PLATFORM_ORIGIN } from './platform-packaged-api'
import { auditFixtureText, fixtureEnvironment, installLoopbackNodeGuard, installLoopbackPythonGuard, isExpectedBlockedThemeFontRequest, KNOWN_BLOCKED_THEME_FONT_URL, launchGuardedDesktop, type NativeState, type NativeTransportAudit, persistedFixtureText, startRealPlatformAPI } from './platform-real-api'
import { verifyWebsiteWallet } from './platform-website-wallet'
import { seedPlatformWorkspace, verifyPlatformWorkspace } from './platform-workspace-proof'
import { allowErrorBanners, expect, type Page, test } from './test'

interface NativeWindow {
  hermesDesktop: {
    platformAccount: { status(): Promise<{ account: { id: string } | null; phase: string; error: unknown }> }
    platformModels: { list(): Promise<unknown> }
    platformBilling: { summary(input: { expected_user_id: string }): Promise<{ balance: string }> }
  }
}

type NativeLaunch = Awaited<ReturnType<typeof launchGuardedDesktop>>

test('transport audit accepts only the inert denied theme stylesheet shape', () => {
  const stylesheet = { url: KNOWN_BLOCKED_THEME_FONT_URL, method: 'GET', resourceType: 'stylesheet', hasUploadData: false, hasAuthorization: false }

  expect(isExpectedBlockedThemeFontRequest(stylesheet)).toBe(true)
  expect(isExpectedBlockedThemeFontRequest({ ...stylesheet, resourceType: 'xhr' })).toBe(false)
  expect(isExpectedBlockedThemeFontRequest({ ...stylesheet, method: 'POST', hasUploadData: true })).toBe(false)
  expect(isExpectedBlockedThemeFontRequest({ ...stylesheet, hasAuthorization: true })).toBe(false)
  expect(isExpectedBlockedThemeFontRequest({ ...stylesheet, hasUploadData: true })).toBe(false)
  expect(isExpectedBlockedThemeFontRequest({ ...stylesheet, url: 'https://fixture.invalid/stylesheet' })).toBe(false)
})

function observeNativeLaunch({ app, page, transportAudit }: NativeLaunch, consoleLines: string[]): NativeTransportAudit {
  page.on('console', message => consoleLines.push(message.text()))
  app.on('window', peer => peer.on('console', message => consoleLines.push(message.text())))
  app.process().stdout?.on('data', value => consoleLines.push(String(value)))
  app.process().stderr?.on('data', value => consoleLines.push(String(value)))

  return transportAudit
}

function assertNativeGuardsReady(sandbox: ReturnType<typeof createSandbox>, app: NativeLaunch['app']) {
  for (const marker of ['node-network-guard-active', 'chromium-network-guard-active']) {
    expect(fs.readFileSync(path.join(sandbox.hermesHome, marker), 'utf8').split('\n')).toContain(String(app.process().pid))
  }
}

function deniedDestinations(sandbox: ReturnType<typeof createSandbox>, marker: string): string[] {
  const markerPath = path.join(sandbox.hermesHome, marker)

  return fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8').trim().split('\n').filter(Boolean) : []
}

async function assertNoBlockedTransport(sandbox: ReturnType<typeof createSandbox>, launchAudits: NativeTransportAudit[]) {
  await Promise.all(launchAudits.flatMap(audit => audit.pending))
  expect(launchAudits.flatMap(audit => audit.unexpectedRendererDestinations)).toEqual([])
  expect(launchAudits.flatMap(audit => audit.knownBlockedThemeFontHosts).every(host => host === 'fonts.googleapis.com')).toBe(true)

  for (const marker of ['blocked-network.txt', 'blocked-node-network.txt']) {
    expect(deniedDestinations(sandbox, marker), `${marker}: denied destinations`).toEqual([])
  }

  const profilesRoot = path.join(sandbox.hermesHome, 'profiles')

  for (const profile of fs.existsSync(profilesRoot) ? fs.readdirSync(profilesRoot, { withFileTypes: true }) : []) {
    if (!profile.isDirectory()) { continue }
    const profileSandbox = { ...sandbox, hermesHome: path.join(profilesRoot, profile.name) }

    expect(deniedDestinations(profileSandbox, 'blocked-network.txt'), `${profile.name}: denied Python destinations`).toEqual([])
  }

  const unexpectedChromiumHosts = deniedDestinations(sandbox, 'blocked-chromium-network.txt')

  const expectedFontHosts = launchAudits.flatMap(audit => {
    const candidates = deniedDestinations(sandbox, `blocked-chromium-font-candidate-${audit.mainPid}.txt`)
    const verified = deniedDestinations(sandbox, `verified-theme-font-denial-${audit.mainPid}.txt`)

    expect(deniedDestinations(sandbox, `font-observer-error-${audit.mainPid}.txt`)).toEqual([])
    expect(deniedDestinations(sandbox, `unexpected-theme-font-shape-${audit.mainPid}.txt`)).toEqual([])
    expect(candidates, `every font candidate from launch ${audit.mainPid} must be independently verified`).toEqual(verified)

    return candidates
  })

  expect(unexpectedChromiumHosts, 'blocked-chromium-network.txt: denied destinations').toEqual([])
  expect(expectedFontHosts).not.toEqual([])
  expect(expectedFontHosts.every(host => host === 'fonts.googleapis.com')).toBe(true)

  return { expectedFontHosts }
}

function assertChromiumGuardProof(sandbox: ReturnType<typeof createSandbox>, mainPid: number) {
  const expectedFontHosts = deniedDestinations(sandbox, `blocked-chromium-font-candidate-${mainPid}.txt`)
  const unexpectedHosts = deniedDestinations(sandbox, 'blocked-chromium-network.txt')

  expect(expectedFontHosts).toContain('fonts.googleapis.com')
  expect(unexpectedHosts).toContain('fixture.invalid')
  expect(unexpectedHosts).toContain('fonts.googleapis.com')
}

function pythonGuardPids(sandbox: ReturnType<typeof createSandbox>): Set<number> {
  const markerPath = path.join(sandbox.hermesHome, 'python-network-guard-active')

  if (!fs.existsSync(markerPath)) { return new Set() }

  return new Set(fs.readFileSync(markerPath, 'utf8').split('\n').flatMap(value => {
    const pid = Number(value)

    return Number.isInteger(pid) && pid > 0 ? [pid] : []
  }))
}

function assertNewGuardedBackend(sandbox: ReturnType<typeof createSandbox>, priorGuardPids: Set<number>) {
  const ownershipPath = path.join(sandbox.userDataDir, 'backend-ownership.json')
  const ownership = JSON.parse(fs.readFileSync(ownershipPath, 'utf8')) as { backends?: Array<{ pid?: unknown }> }

  const backendPids = new Set((ownership.backends ?? []).flatMap(entry => {
    const pid = Number(entry.pid)

    return Number.isInteger(pid) && pid > 0 ? [pid] : []
  }))

  const newGuardPids = [...pythonGuardPids(sandbox)].filter(pid => !priorGuardPids.has(pid))

  expect(newGuardPids).not.toEqual([])
  expect(newGuardPids.some(pid => backendPids.has(pid))).toBe(true)
}

function prepareNativePlatformEnvironment(
  sandbox: ReturnType<typeof createSandbox>,
  api: Awaited<ReturnType<typeof startRealPlatformAPI>>,
  options: { compressionInPlace?: boolean } = {}
) {
  const compression = options.compressionInPlace === false ? 'compression:\n  in_place: false\n' : ''
  fs.writeFileSync(path.join(sandbox.hermesHome, 'config.yaml'), `updates:\n  check: false\ndisplay:\n  language: en\n${compression}auxiliary:\n  title_generation:\n    enabled: false\n`, { mode: 0o600 })
  fs.writeFileSync(path.join(sandbox.hermesHome, '.env'), '', { mode: 0o600 })
  seedPlatformWorkspace(sandbox)
  fs.writeFileSync(path.join(sandbox.userDataDir, 'platform-development.json'), JSON.stringify({ enabled: true, origin: api.info.origin }), { mode: 0o600 })
  const inherited = buildAppEnv(sandbox)
  const env: Record<string, string> = { ...fixtureEnvironment(), HOME: sandbox.root }

  for (const key of ['HERMES_DESKTOP_USER_DATA_DIR', 'HERMES_DESKTOP_IGNORE_EXISTING', 'HERMES_DESKTOP_HERMES_ROOT', 'HERMES_DESKTOP_APP_NAME', 'HERMES_DESKTOP_SKIP_QUIT_CONFIRM']) { env[key] = inherited[key] }
  env.HERMES_HOME = sandbox.hermesHome
  env.HERMES_DESKTOP_CWD = path.dirname(api.info.fixture_path)
  env.PYTHONPATH = installLoopbackPythonGuard(sandbox.root)

  return {
    env,
    nodeGuard: installLoopbackNodeGuard(sandbox.root),
    pythonGuardPids: pythonGuardPids(sandbox)
  }
}

function decimalUnits(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value)

  if (!match || /[1-9]/.test((match[3] ?? '').slice(8))) { throw new Error(`Unexpected fixture decimal: ${value}`) }

  const units = BigInt(match[2]) * 100_000_000n + BigInt((match[3] ?? '').slice(0, 8).padEnd(8, '0'))

  return match[1] === '-' ? -units : units
}

test('fixture decimal parser preserves exact eight-place values', () => {
  expect(decimalUnits('0.0003000000')).toBe(30_000n)
  expect(decimalUnits('-1.250000000')).toBe(-125_000_000n)
  expect(() => decimalUnits('0.0003000001')).toThrow('Unexpected fixture decimal')
  expect(() => decimalUnits('not-a-decimal')).toThrow('Unexpected fixture decimal')
})

async function auditRenderer(page: Page, api: Awaited<ReturnType<typeof startRealPlatformAPI>>) {
  const publicData = await page.evaluate(async () => {
    const desktop = (window as unknown as NativeWindow).hermesDesktop
    const account = await desktop.platformAccount.status()

    return {
      account,
      models: account.phase === 'signed_in' ? await desktop.platformModels.list() : null,
      localStorage: { ...localStorage },
      body: document.body.innerText
    }
  })

  const audit = await api.control<{ leaked: boolean; checked_credentials: number }>('audit', JSON.stringify(publicData))

  expect(audit.leaked).toBe(false)
  expect(audit.checked_credentials).toBeGreaterThan(2)

  return audit
}

async function signInForThisSession(page: Page, api: Awaited<ReturnType<typeof startRealPlatformAPI>>, previousCodeAt = 0, phone = api.info.phone) {
  await expect(page.getByRole('textbox', { name: 'Phone number', exact: true })).toBeVisible({ timeout: 90_000 })
  await page.getByRole('checkbox', { name: 'Keep me signed in on this device', exact: true }).uncheck()
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill(phone)
  // Honor the real SMS cooldown before the restart's fresh challenge.
  const remaining = 61_000 - (Date.now() - previousCodeAt)

  if (remaining > 0) { await page.waitForTimeout(Math.min(remaining, 60_000)) }
  await page.getByRole('button', { name: 'Send code', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Verification code', exact: true })).toBeVisible()
  const requestedAt = Date.now()
  const code = await api.control<{ code: string }>('code')
  expect(/^\d{6}$/.test(code.code)).toBe(true)
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill(code.code)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect.poll(async () => {
    const account = await page.evaluate(() => (window as unknown as NativeWindow).hermesDesktop.platformAccount.status())

    return { phase: account.phase, error: account.error }
  }, { timeout: 15_000 }).toEqual({ phase: 'signed_in', error: null })

  return requestedAt
}

async function rechargeNativeWallet(
  page: Page,
  api: Awaited<ReturnType<typeof startRealPlatformAPI>>,
  accountID: string,
  screenshotPath: string
) {
  const before = await api.control<NativeState>('state')

  await page.getByRole('button', { name: /^My account/ }).click()
  await page.getByRole('button', { name: 'Recharge', exact: true }).click()
  await page.getByRole('textbox', { name: 'Recharge amount', exact: true }).fill('20')
  await page.getByRole('button', { name: 'Get quote', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Confirm order', exact: true })).toBeEnabled()
  expect((await api.control<NativeState>('state')).orders).toBe(before.orders)
  await page.getByRole('button', { name: 'Confirm order', exact: true }).click()
  await expect.poll(async () => (await api.control<NativeState>('state')).payment_calls).toBe(before.payment_calls + 1)
  // The fixture sends the real signed callback twice through the payment handler.
  await api.control('pay', '')
  await page.getByRole('button', { name: 'Refresh order', exact: true }).click()
  await expect(page.getByText('Recharge complete', { exact: true })).toBeVisible()
  const paid = await api.control<NativeState>('state')

  expect(paid.orders).toBe(before.orders + 1)
  expect(paid.payment_calls).toBe(before.payment_calls + 1)
  expect(decimalUnits(paid.balance) - decimalUnits(before.balance)).toBe(decimalUnits('2.8'))
  expect(paid.usage_calls).toBe(before.usage_calls)
  const wallet = await page.evaluate(id => (window as unknown as NativeWindow).hermesDesktop.platformBilling.summary({ expected_user_id: id }), accountID)

  expect(wallet.balance).toBe(paid.balance)
  await page.screenshot({ path: screenshotPath })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  return { before, paid, wallet }
}

test('native fixture guards load before real Electron main', async () => {
  test.setTimeout(45_000)
  const sandbox = createSandbox('platform-guard-proof')
  let launched: NativeLaunch | null = null
  const consoleLines: string[] = []

  try {
    fs.writeFileSync(path.join(sandbox.hermesHome, 'config.yaml'), '')
    fs.writeFileSync(path.join(sandbox.userDataDir, 'platform-development.json'), JSON.stringify({ enabled: true, origin: 'http://127.0.0.1:1' }))
    const inherited = buildAppEnv(sandbox)
    const env: Record<string, string> = { ...fixtureEnvironment(), HOME: sandbox.root, HERMES_HOME: sandbox.hermesHome, HERMES_DESKTOP_BOOT_FAKE: '1' }

    for (const key of ['HERMES_DESKTOP_USER_DATA_DIR', 'HERMES_DESKTOP_IGNORE_EXISTING', 'HERMES_DESKTOP_HERMES_ROOT', 'HERMES_DESKTOP_APP_NAME', 'HERMES_DESKTOP_SKIP_QUIT_CONFIRM']) { env[key] = inherited[key] }
    env.PYTHONPATH = installLoopbackPythonGuard(sandbox.root)
    const python = path.resolve(import.meta.dirname, '../../../.venv/bin/python')

    const pythonProof = execFileSync(python, ['-c', `import json, sitecustomize, subprocess
spawned=[]
sitecustomize._popen_init=lambda *args, **kwargs: spawned.append(True)
denied=False
try: subprocess.Popen(['/usr/bin/security','find-generic-password','-s','fixture-no-lookup','-w'])
except FileNotFoundError: denied=True
assert denied and not spawned
print(json.dumps({'credential_read_denied_before_spawn':denied,'spawned_commands':len(spawned)}))
`], { env, encoding: 'utf8' })

    expect(JSON.parse(pythonProof)).toEqual({ credential_read_denied_before_spawn: true, spawned_commands: 0 })
    launched = await launchGuardedDesktop(env, installLoopbackNodeGuard(sandbox.root))
    const launchAudit = observeNativeLaunch(launched, consoleLines)
    assertNativeGuardsReady(sandbox, launched.app)
    // Fail before issuing the probe if Chromium was not guarded at bootstrap.
    expect(fs.existsSync(path.join(sandbox.hermesHome, 'chromium-network-guard-active'))).toBe(true)

    const chromiumProof = await launched.app.evaluate(async ({ net }) => {
      try { await net.fetch('https://fixture.invalid/guard-proof');

 return false } catch (error) {
        return error instanceof Error && error.message.includes('ERR_BLOCKED_BY_CLIENT')
      }
    })

    expect(chromiumProof).toBe(true)
    expect(fs.readFileSync(path.join(sandbox.hermesHome, 'blocked-chromium-network.txt'), 'utf8')).toContain('fixture.invalid')

    const fontProof = await launched.page.evaluate(url => new Promise<boolean>(resolve => {
      const link = document.createElement('link')

      link.rel = 'stylesheet'
      link.href = url
      link.onload = () => resolve(false)
      link.onerror = () => resolve(true)
      document.head.appendChild(link)
    }), KNOWN_BLOCKED_THEME_FONT_URL)

    const sameURLFetchProof = await launched.app.evaluate(async ({ net }) => {
      try {
        await net.fetch('https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap')

        return false
      } catch (error) {
        return error instanceof Error && error.message.includes('ERR_BLOCKED_BY_CLIENT')
      }
    })

    expect(fontProof).toBe(true)
    expect(sameURLFetchProof).toBe(true)
    assertChromiumGuardProof(sandbox, launchAudit.mainPid)
    await Promise.all(launchAudit.pending)
    const candidates = deniedDestinations(sandbox, `blocked-chromium-font-candidate-${launchAudit.mainPid}.txt`)

    expect(deniedDestinations(sandbox, `font-observer-error-${launchAudit.mainPid}.txt`)).toEqual([])
    expect(candidates).toEqual(deniedDestinations(sandbox, `verified-theme-font-denial-${launchAudit.mainPid}.txt`))
    expect(launchAudit.unexpectedRendererDestinations).toEqual([])

    await launched.app.context().setExtraHTTPHeaders({ Authorization: 'Bearer fixture-denied-font-probe' })

    const authFontProof = await launched.page.evaluate(url => new Promise<boolean>(resolve => {
      const link = document.createElement('link')

      link.rel = 'stylesheet'
      link.href = url
      link.onload = () => resolve(false)
      link.onerror = () => resolve(true)
      document.head.appendChild(link)
    }), KNOWN_BLOCKED_THEME_FONT_URL)

    await launched.app.context().setExtraHTTPHeaders({})
    await Promise.all(launchAudit.pending)
    expect(authFontProof).toBe(true)
    expect(launchAudit.unexpectedRendererDestinations).toEqual(['fonts.googleapis.com'])
    expect(deniedDestinations(sandbox, `unexpected-theme-font-shape-${launchAudit.mainPid}.txt`)).toEqual(['fonts.googleapis.com'])

    const proof = await launched.app.evaluate(async () => {
      try { await globalThis.fetch('https://fixture.invalid/guard-proof');

 return false } catch (error) {
        return error instanceof Error && error.message === 'native fixture forbids non-loopback transport'
      }
    })

    expect(proof).toBe(true)
    expect(fs.readFileSync(path.join(sandbox.hermesHome, 'blocked-node-network.txt'), 'utf8')).toContain('fixture.invalid')
    console.log('Guard proof: actual Electron main and Chromium guards active before bootstrap; nonloopback fetch denied before transport; Python credential read denied with zero subprocesses')
  } finally {
    await launched?.app.close().catch(() => undefined)
    sandbox.cleanup()
  }
})

test('real website wallet uses an independent phone login', async ({ browserName: _browserName }, testInfo) => {
  test.setTimeout(120_000)
  const repoRoot = path.resolve(import.meta.dirname, '../../..')
  const api = await startRealPlatformAPI(path.resolve(repoRoot, '../Aino-API'))
  let primaryError: unknown

  try {
    const website = await verifyWebsiteWallet({ api, frontendDist: path.join(repoRoot, '../Aino-API/backend/internal/web/dist'), previousCodeAt: 0, screenshotPath: testInfo.outputPath('platform-website-wallet.png') })
    const state = await api.control<NativeState>('state')
    expect(website.accountId).toBe(String(state.user_id))
    expect(website.balance).toBe(Number(state.balance).toFixed(2))
    expect(state.usage_calls).toBe(0)
    expect(state.orders).toBe(0)
    await testInfo.attach('website-receipt', { body: JSON.stringify(website), contentType: 'application/json' })
  } catch (error) {
    primaryError = error
  }

  try { await api.close() } catch (error) {
    if (primaryError !== undefined) { throw new AggregateError([primaryError, error], 'Website fixture and cleanup failed') }
    throw error
  }

  if (primaryError !== undefined) { throw primaryError }
})

test('real API workspace switch preserves platform account across native windows', async ({ browserName: _browserName }, testInfo) => {
  test.setTimeout(180_000)
  const repoRoot = path.resolve(import.meta.dirname, '../../..')
  const sandbox = createSandbox('platform-native-workspace')
  let api: Awaited<ReturnType<typeof startRealPlatformAPI>> | null = null
  let launched: NativeLaunch | null = null
  const consoleLines: string[] = []
  const launchAudits: NativeTransportAudit[] = []
  let primaryError: unknown
  const cleanupErrors: unknown[] = []

  try {
    api = await startRealPlatformAPI(path.resolve(repoRoot, '../Aino-API'))
    const prepared = prepareNativePlatformEnvironment(sandbox, api)

    launched = await launchGuardedDesktop(prepared.env, prepared.nodeGuard)
    launchAudits.push(observeNativeLaunch(launched, consoleLines))
    assertNativeGuardsReady(sandbox, launched.app)
    await signInForThisSession(launched.page, api)
    await waitForAppReady(launched as never, 120_000)
    assertNewGuardedBackend(sandbox, prepared.pythonGuardPids)

    const initialAccount = await launched.page.evaluate(() => (window as unknown as NativeWindow).hermesDesktop.platformAccount.status())
    const initial = await api.control<NativeState>('state')

    expect(initialAccount.account?.id).toBe(String(initial.user_id))
    expect(initial.usage_calls).toBe(0)
    expect(initial.tool_results).toBe(0)
    expect(initial.orders).toBe(0)

    const screenshotPath = testInfo.outputPath('platform-native-workspace.png')
    const workspace = await verifyPlatformWorkspace(launched, api, sandbox, initialAccount.account!.id, screenshotPath)
    const chargedUnits = decimalUnits(workspace.before.balance) - decimalUnits(workspace.after.balance)
    const recordedCostUnits = decimalUnits(workspace.after.usage_cost) - decimalUnits(workspace.before.usage_cost)

    expect(workspace.after.usage_calls - workspace.before.usage_calls).toBe(2)
    expect(workspace.after.tool_results - workspace.before.tool_results).toBe(1)
    expect(workspace.after.orders).toBe(0)
    expect(workspace.after.orders).toBe(workspace.before.orders)
    expect(chargedUnits).toBe(recordedCostUnits)

    const rendererAudit = await auditRenderer(launched.page, api)
    const transport = await assertNoBlockedTransport(sandbox, launchAudits)

    await launched.app.close()
    launched = null

    const persistedAudit = await auditFixtureText(api, [
      ...persistedFixtureText(sandbox.hermesHome),
      ...persistedFixtureText(sandbox.userDataDir),
      fs.readFileSync(api.logPath, 'utf8'),
      ...consoleLines
    ])

    expect(persistedAudit.leaked).toBe(false)

    const receipt = {
      run_id: api.info.run_id,
      source: {
        aino_sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
        api_sha: api.apiSha
      },
      identity: {
        initial_account_id: initialAccount.account!.id,
        workspace_account_id: workspace.account_id,
        workspace_profile: workspace.profile,
        distinct_guarded_backend: workspace.distinct_guarded_backend,
        peer_account_matches: workspace.peer_account_matches,
        peer_wallet_matches: workspace.peer_wallet_matches,
        hide_show_preserves_account: workspace.hide_show_preserves_account,
        hide_show_preserves_wallet: workspace.hide_show_preserves_wallet
      },
      amounts: {
        before_balance: workspace.before.balance,
        after_balance: workspace.after.balance,
        charged_units: chargedUnits.toString(),
        recorded_cost_units: recordedCostUnits.toString()
      },
      counters: {
        usage_calls: workspace.after.usage_calls - workspace.before.usage_calls,
        tool_results: workspace.after.tool_results - workspace.before.tool_results,
        orders: workspace.after.orders
      },
      audits: {
        renderer: rendererAudit,
        peer_renderer: workspace.peerAudit,
        persisted: persistedAudit,
        transport: {
          denied_public_font_hosts: transport.expectedFontHosts,
          blocked_before_transport: true
        }
      },
      screenshot: 'platform-native-workspace.png'
    }

    await testInfo.attach('workspace-native-receipt', { body: JSON.stringify(receipt, null, 2), contentType: 'application/json' })
    await testInfo.attach('workspace-native-screenshot', { path: screenshotPath, contentType: 'image/png' })
  } catch (error) {
    primaryError = error
  } finally {
    try { await launched?.app.close() } catch (error) { cleanupErrors.push(error) }

    try { await api?.close() } catch (error) { cleanupErrors.push(error) }

    try { sandbox.cleanup() } catch (error) { cleanupErrors.push(error) }
  }

  if (primaryError !== undefined && cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], 'Native workspace fixture failed and cleanup did not complete')
  }

  if (primaryError !== undefined) { throw primaryError }

  if (cleanupErrors.length > 0) { throw new AggregateError(cleanupErrors, 'Native workspace fixture cleanup failed') }
})

test('native compression ledger survives close and resume with a fresh binding', async ({ browserName: _browserName }, testInfo) => {
  test.setTimeout(350_000)
  const repoRoot = path.resolve(import.meta.dirname, '../../..')
  const sandbox = createSandbox('platform-native-compression')
  let api: Awaited<ReturnType<typeof startRealPlatformAPI>> | null = null
  let launched: NativeLaunch | null = null
  const consoleLines: string[] = []
  const launchAudits: NativeTransportAudit[] = []
  let primaryError: unknown
  const cleanupErrors: unknown[] = []

  try {
    api = await startRealPlatformAPI(path.resolve(repoRoot, '../Aino-API'))
    const prepared = prepareNativePlatformEnvironment(sandbox, api, { compressionInPlace: false })
    launched = await launchGuardedDesktop(prepared.env, prepared.nodeGuard)
    launchAudits.push(observeNativeLaunch(launched, consoleLines))
    assertNativeGuardsReady(sandbox, launched.app)
    await observeNativeRuntime(launched.page)
    const firstCodeAt = await signInForThisSession(launched.page, api)
    await waitForAppReady(launched as never, 120_000)
    assertNewGuardedBackend(sandbox, prepared.pythonGuardPids)

    const receipt = await verifyNativeCompressionBeforeRestart(launched.page, api)
    const sessionUrl = launched.page.url()
    await launched.app.close()
    launched = null

    const resumedPythonGuardPids = pythonGuardPids(sandbox)
    launched = await launchGuardedDesktop(prepared.env, prepared.nodeGuard)
    launchAudits.push(observeNativeLaunch(launched, consoleLines))
    assertNativeGuardsReady(sandbox, launched.app)
    await observeNativeRuntime(launched.page)
    await signInForThisSession(launched.page, api, firstCodeAt)
    await waitForAppReady(launched as never, 120_000)
    assertNewGuardedBackend(sandbox, resumedPythonGuardPids)
    await launched.page.goto(sessionUrl)
    const resumed = await verifyNativeCompressionAfterRestart(launched.page, api, receipt)
    const billing = await launched.page.evaluate(id => (window as unknown as NativeWindow).hermesDesktop.platformBilling.summary({ expected_user_id: id }), receipt.user_id)
    expect(billing.balance).toBe(resumed.after.balance)

    const rendererAudit = await auditRenderer(launched.page, api)
    const transport = await assertNoBlockedTransport(sandbox, launchAudits)
    await launched.app.close()
    launched = null

    const persistedAudit = await auditFixtureText(api, [
      ...persistedFixtureText(sandbox.hermesHome),
      ...persistedFixtureText(sandbox.userDataDir),
      fs.readFileSync(api.logPath, 'utf8'),
      ...consoleLines
    ])

    expect(persistedAudit.leaked).toBe(false)
    await testInfo.attach('native-compression-ledger-receipt', {
      body: JSON.stringify({
        run_id: api.info.run_id,
        user_id: receipt.user_id,
        billing_session_id: receipt.billing_session_id,
        first_turn_id: receipt.first_turn_id,
        compression_turn_id: receipt.compression_turn_id,
        compression_call_ids: receipt.compression_call_ids,
        raw_before_messages: receipt.raw_before_messages,
        raw_after_messages: receipt.raw_after_messages,
        removed_messages: receipt.raw_before_messages - receipt.raw_after_messages,
        before_rendered_user_messages: receipt.before_rendered_user_messages,
        after_rendered_user_messages: receipt.after_rendered_user_messages,
        compression_requests: receipt.compression_requests,
        compression_handoff_requests: resumed.after.compression_handoff_requests,
        resumed_rows: resumed.rows,
        amounts: { before_balance: receipt.before.balance, after_balance: resumed.after.balance, usage_cost: resumed.after.usage_cost },
        binding: { initial: receipt.binding, resumed: resumed.binding },
        billing_summary: billing,
        audits: { renderer: rendererAudit, persisted: persistedAudit, transport: { denied_public_font_hosts: transport.expectedFontHosts, blocked_before_transport: true } }
      }, null, 2),
      contentType: 'application/json'
    })
  } catch (error) {
    primaryError = error
  } finally {
    try { await launched?.app.close() } catch (error) { cleanupErrors.push(error) }

    try { await api?.close() } catch (error) { cleanupErrors.push(error) }

    try { sandbox.cleanup() } catch (error) { cleanupErrors.push(error) }
  }

  if (primaryError !== undefined && cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], 'Native compression fixture and cleanup failed')
  }

  if (primaryError !== undefined) {
    throw primaryError
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Native compression fixture cleanup failed')
  }
})

for (const scenario of [
  { name: 'concurrent refresh and logout', verify: verifyConcurrentAccountLifecycle },
  { name: 'offline and revoked authorization recovery', verify: verifyOfflineAndAuthorizationRecovery }
]) {
  test(`native account edges: ${scenario.name}`, async ({ browserName: _browserName }, testInfo) => {
    test.setTimeout(240_000)
    allowErrorBanners()
    const repoRoot = path.resolve(import.meta.dirname, '../../..')
    const sandbox = createSandbox('platform-account-edges')
    let api: Awaited<ReturnType<typeof startRealPlatformAPI>> | null = null
    let launched: NativeLaunch | null = null
    const consoleLines: string[] = []
    const launchAudits: NativeTransportAudit[] = []
    let primaryError: unknown
    const cleanupErrors: unknown[] = []

    try {
      api = await startRealPlatformAPI(path.resolve(repoRoot, '../Aino-API'))
      const prepared = prepareNativePlatformEnvironment(sandbox, api)
      launched = await launchGuardedDesktop(prepared.env, prepared.nodeGuard)
      launchAudits.push(observeNativeLaunch(launched, consoleLines))
      assertNativeGuardsReady(sandbox, launched.app)
      await observeEdgeAlerts(launched, scenario.verify === verifyOfflineAndAuthorizationRecovery)
      await observeNativeRuntime(launched.page)
      const codeAt = await signInForThisSession(launched.page, api)
      await waitForAppReady(launched as never, 120_000)
      assertNewGuardedBackend(sandbox, prepared.pythonGuardPids)
      const initialAccount = await launched.page.evaluate(() => (window as unknown as NativeWindow).hermesDesktop.platformAccount.status())
      const active = launched
      const fixture = api

      const proof = await scenario.verify({
        launched, api, accountId: initialAccount.account!.id,
        signInAgain: async () => { await signInForThisSession(active.page, fixture, codeAt) }
      })

      await assertEdgeAlerts(launched)
      const rendererAudits = []

      for (const page of launched.app.windows()) { rendererAudits.push(await auditRenderer(page, api)) }
      expect(rendererAudits).toHaveLength(2)
      const transport = await assertNoBlockedTransport(sandbox, launchAudits)
      await launched.page.screenshot({ path: testInfo.outputPath('native-account-edge.png') })
      await launched.app.close()
      launched = null

      const persistedAudit = await auditFixtureText(api, [
        ...persistedFixtureText(sandbox.hermesHome), ...persistedFixtureText(sandbox.userDataDir),
        fs.readFileSync(api.logPath, 'utf8'), ...consoleLines
      ])

      await testInfo.attach('native-account-edge-receipt', {
        body: JSON.stringify({
          scenario: scenario.name, run_id: api.info.run_id,
          source: { aino: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(), api: api.apiSha },
          proof, rendererAudits, persistedAudit,
          transport: { blocked_before_transport: true, denied_public_font_hosts: transport.expectedFontHosts }
        }, null, 2), contentType: 'application/json'
      })
    } catch (error) {
      primaryError = error

      if (launched) {
        await launched.page.screenshot({ path: testInfo.outputPath('native-account-edge-failure.png') }).catch(() => undefined)
      }
    } finally {
      // Release fixture-only gates before closing clients, including failed runs.
      if (api) {
        try { await api.control('faults', JSON.stringify({ offline: false, profile_401_for_current_access: false,
          hold_refresh_response: false, hold_logout_response: false, hold_inference_before_auth: false })) } catch (error) { cleanupErrors.push(error) }
      }

      try { await launched?.app.close() } catch (error) { cleanupErrors.push(error) }

      try { await api?.close() } catch (error) { cleanupErrors.push(error) }

      try { sandbox.cleanup() } catch (error) { cleanupErrors.push(error) }
    }

    if (primaryError !== undefined && cleanupErrors.length > 0) { throw new AggregateError([primaryError, ...cleanupErrors], 'Native edge fixture and cleanup failed') }

    if (primaryError !== undefined) { throw primaryError }

    if (cleanupErrors.length > 0) { throw new AggregateError(cleanupErrors, 'Native edge cleanup failed') }
  })
}

async function verifyVisibleCharge(page: Page, api: Awaited<ReturnType<typeof startRealPlatformAPI>>, accountId?: string) {
  const route = accountId ? `state?user_id=${encodeURIComponent(accountId)}` : 'state'
  const before = await api.control<NativeState>(route)
  const started = Date.now()
  await page.bringToFront()
  const metrics = page.locator('[data-slot="aui_reply-metrics"]').last()
  await expect(metrics.getByText('Charged 0.0002 USD', { exact: true })).toBeVisible({ timeout: 90_000 })
  await expect(metrics.getByText(/Partially settled|Checking charges|Charges not confirmed/)).toHaveCount(0)
  const after = await api.control<NativeState>(route)
  expect(after).toEqual(before)

  return { elapsed_ms: Date.now() - started, label: await metrics.innerText(), state_unchanged: true }
}

test('packaged default sandbox supports platform login tools and history restart', async ({ browserName: _browserName }, testInfo) => {
  test.setTimeout(300_000)
  const packagePath = process.env.AINO_NATIVE_PACKAGED_APP
  test.skip(!packagePath, 'Requires an explicitly built local candidate package')
  const repoRoot = path.resolve(import.meta.dirname, '../../..')
  const sandbox = createSandbox('platform-packaged')
  let api: Awaited<ReturnType<typeof startRealPlatformAPI>> | null = null
  let launched: Awaited<ReturnType<typeof launchGuardedPackagedDesktop>> | null = null
  const consoleLines: string[] = []
  const launches = []
  const launchAudits: NativeTransportAudit[] = []
  let primaryError: unknown
  const cleanupErrors: unknown[] = []
  let stage = 'fixture'

  try {
    api = await startRealPlatformAPI(path.resolve(repoRoot, '../Aino-API'))
    const prepared = prepareNativePlatformEnvironment(sandbox, api)
    installPackagedPythonTransport(prepared.env.PYTHONPATH, api.info.origin)
    let previousCodeAt = 0
    let historyURL = ''
    const initial = await api.control<NativeState>('state').catch(() => null)
    const turns = []

    for (const index of [0, 1]) {
      stage = `launch-${index}`
      const previousPids = pythonGuardPids(sandbox)
      launched = await launchGuardedPackagedDesktop(prepared.env, prepared.nodeGuard, packagePath!, api.info.origin)
      launchAudits.push(observeNativeLaunch(launched, consoleLines))
      const proof = launched.packageProof
      expect(proof.beforeEntry).toMatchObject({ packaged: true, ready: false })
      expect(proof.stop.reason).toBe('Break on start')
      expect(proof.stop.entry).toBe(path.join(packagePath!, 'Contents/Resources/app.asar/dist/electron-main.mjs'))
      expect(proof.stop.frames.length).toBeGreaterThan(0)
      expect(proof.state.packaged).toBe(true)
      expect(proof.state.appPath).toBe(path.join(packagePath!, 'Contents/Resources/app.asar'))
      expect(proof.state.executable).toBe(path.join(packagePath!, 'Contents/MacOS/Aino'))
      expect(proof.state.noSandbox).toBe(false)
      expect(proof.state.disableSandbox).toBe(false)
      expect(proof.state.windows.length).toBeGreaterThan(0)

      for (const window of proof.state.windows) {
        expect(window.preferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false })
        const metric = proof.state.metrics.find(candidate => candidate.pid === window.pid)
        expect(metric, `OS sandbox evidence for renderer ${window.pid}`).toMatchObject({ type: 'Tab', sandboxed: true })
      }

      expect(proof.children.every(child => !child.command.includes('--no-sandbox') && !child.command.includes('--disable-sandbox'))).toBe(true)

      for (const marker of ['node-network-guard-active', 'chromium-network-guard-active']) {
        expect(fs.readFileSync(path.join(sandbox.hermesHome, marker), 'utf8').split('\n')).toContain(String(launched.transportAudit.mainPid))
      }

      const mode = await launched.page.evaluate(async () => {
        const bridge = (window as unknown as { hermesDesktop: { accountAdapter: string; platformAccount: { status(): Promise<{ mode: string }> } } }).hermesDesktop

        return { adapter: bridge.accountAdapter, mode: (await bridge.platformAccount.status()).mode }
      })

      expect(mode).toEqual({ adapter: 'platform', mode: 'production' })
      stage = `login-${index}`
      previousCodeAt = await signInForThisSession(launched.page, api, previousCodeAt)
      await waitForAppReady(launched as never, 120_000)
      assertNewGuardedBackend(sandbox, previousPids)
      stage = `tool-turn-${index}`
      let after: NativeState

      if (index === 0) {
        after = await sendToolTurn(launched.page, api)
        historyURL = launched.page.url()
      } else {
        await launched.page.goto(historyURL)
        await expect(launched.page.getByText(`Verified ${api.info.fixture_content}`, { exact: false }).first()).toBeVisible({ timeout: 60_000 })
        const before = await api.control<NativeState>('state')
        await sendPrompt(launched.page, `Read ${api.info.fixture_path} again after restarting the packaged app.`)
        await expect.poll(async () => (await api!.control<NativeState>('state')).usage_calls).toBe(before.usage_calls + 2)
        await expect(launched.page.locator('[contenteditable="true"]').first().locator('xpath=ancestor::form').getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
        after = await api.control<NativeState>('state')
        expect(after.model_calls).toBe(before.model_calls + 2)
        expect(after.tool_results).toBe(before.tool_results + 1)
        expect(decimalUnits(before.balance) - decimalUnits(after.balance)).toBe(decimalUnits(after.usage_cost) - decimalUnits(before.usage_cost))
      }

      const charge = await verifyVisibleCharge(launched.page, api)
      turns.push(after)

      const owner = await launched.page.evaluate(async () => {
        const bridge = (window as unknown as { hermesDesktop: { platformAccount: { status(): Promise<{ revision: number }> }; platformModels: { owner(revision: number): Promise<{ platform_origin: string; user_id: string }> } } }).hermesDesktop

        return bridge.platformModels.owner((await bridge.platformAccount.status()).revision)
      })

      expect(owner).toEqual({ platform_origin: PACKAGED_PLATFORM_ORIGIN, user_id: String(after.user_id) })
      const rendererAudit = await auditRenderer(launched.page, api)
      await launched.page.screenshot({ path: testInfo.outputPath(`packaged-platform-${index}.png`) })
      const exit = await launched.close()
      expect(exit.all_exited).toBe(true)
      expect(exit.forced).toBe(false)
      expect(exit.processes.some(identity => identity.role.startsWith('backend:'))).toBe(true)
      launches.push({ ...proof, owner, rendererAudit, charge, exit })
      launched = null
    }

    stage = 'audits'

    const transport = await assertNoBlockedTransport(sandbox, launchAudits)

    const requests = { main: fs.readFileSync(path.join(sandbox.hermesHome, 'packaged-main-mapped-requests'), 'utf8').trim().split('\n'),
      python: fs.readFileSync(path.join(sandbox.hermesHome, 'packaged-python-mapped-requests'), 'utf8').trim().split('\n') }

    expect(requests.python).toHaveLength(4)

    const persistedAudit = await auditFixtureText(api, [...persistedFixtureText(sandbox.hermesHome),
      ...persistedFixtureText(sandbox.userDataDir), fs.readFileSync(api.logPath, 'utf8'), ...consoleLines, JSON.stringify(launches)])

    await testInfo.attach('packaged-platform-receipt', { body: JSON.stringify({ source: {
      aino: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(), api: api.apiSha },
    package_path: packagePath, run_id: api.info.run_id, initial, turns, launches, requests, persistedAudit, transport,
    boundary: 'Unmodified packaged production app, default Chromium sandbox, inspector-installed transport maps exact production origin to loopback fixture; session-only login; configured checkout Python runtime; no real service/TLS/Keychain/notarization claim.' }, null, 2), contentType: 'application/json' })
  } catch (error) {
    primaryError = error
    console.log(`Packaged native failed at ${stage}`)

    if (launched) { await launched.page.screenshot({ path: testInfo.outputPath('packaged-platform-error.png') }).catch(() => undefined) }
  } finally {
    try { await launched?.close() } catch (error) { cleanupErrors.push(error) }

    try { await api?.close() } catch (error) { cleanupErrors.push(error) }

    try { sandbox.cleanup() } catch (error) { cleanupErrors.push(error) }
  }

  if (primaryError !== undefined && cleanupErrors.length > 0) { throw new AggregateError([primaryError, ...cleanupErrors], 'Packaged fixture and cleanup failed') }

  if (primaryError !== undefined) { throw primaryError }

  if (cleanupErrors.length > 0) { throw new AggregateError(cleanupErrors, 'Packaged fixture cleanup failed') }
})

test('native late lease cannot revive the signed-out account after replacement login', async ({ browserName: _browserName }, testInfo) => {
  test.setTimeout(180_000)
  allowErrorBanners()
  const repoRoot = path.resolve(import.meta.dirname, '../../..')
  const sandbox = createSandbox('platform-late-lease')
  let api: Awaited<ReturnType<typeof startRealPlatformAPI>> | null = null
  let launched: NativeLaunch | null = null
  const consoleLines: string[] = []
  const launchAudits: NativeTransportAudit[] = []
  let primaryError: unknown
  const cleanupErrors: unknown[] = []

  try {
    api = await startRealPlatformAPI(path.resolve(repoRoot, '../Aino-API'))
    const prepared = prepareNativePlatformEnvironment(sandbox, api)
    launched = await launchGuardedDesktop(prepared.env, prepared.nodeGuard)
    launchAudits.push(observeNativeLaunch(launched, consoleLines))
    assertNativeGuardsReady(sandbox, launched.app)
    await observeLateLeaseAlerts(launched)
    await observeNativeRuntime(launched.page)
    await signInForThisSession(launched.page, api)
    await waitForAppReady(launched as never, 120_000)
    assertNewGuardedBackend(sandbox, prepared.pythonGuardPids)
    const account = await launched.page.evaluate(() => (window as unknown as NativeWindow).hermesDesktop.platformAccount.status())
    const active = launched
    const fixture = api

    const proof = await verifyLateLeaseAcrossAccountSwitch({ launched, api, accountId: account.account!.id,
      signInOther: async () => { await signInForThisSession(active.page, fixture, 0, fixture.info.secondary_phone) } })

    await assertLateLeaseAlerts(launched)
    const charge = await verifyVisibleCharge(launched.page, api, proof.current_owner.user_id)
    const rendererAudit = await auditRenderer(launched.page, api)
    const transport = await assertNoBlockedTransport(sandbox, launchAudits)
    await assertLateLeaseAlerts(launched)
    await launched.page.screenshot({ path: testInfo.outputPath('native-late-lease.png') })
    await launched.app.close()
    launched = null

    const persistedAudit = await auditFixtureText(api, [...persistedFixtureText(sandbox.hermesHome),
      ...persistedFixtureText(sandbox.userDataDir), fs.readFileSync(api.logPath, 'utf8'), ...consoleLines])

    await testInfo.attach('native-late-lease-receipt', {
      body: JSON.stringify({ source: { aino: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(), api: api.apiSha },
        run_id: api.info.run_id, proof, charge, rendererAudit, persistedAudit, transport }, null, 2), contentType: 'application/json'
    })
  } catch (error) {
    primaryError = error

    if (launched) { await launched.page.screenshot({ path: testInfo.outputPath('native-late-lease-error.png') }).catch(() => undefined) }
  } finally {
    if (api) {
      try { await api.control('faults', JSON.stringify({ hold_credential_response: false })) } catch (error) { cleanupErrors.push(error) }
    }

    try { await launched?.app.close() } catch (error) { cleanupErrors.push(error) }

    try { await api?.close() } catch (error) { cleanupErrors.push(error) }

    try { sandbox.cleanup() } catch (error) { cleanupErrors.push(error) }
  }

  if (primaryError !== undefined && cleanupErrors.length > 0) { throw new AggregateError([primaryError, ...cleanupErrors], 'Late lease and cleanup failed') }

  if (primaryError !== undefined) { throw primaryError }

  if (cleanupErrors.length > 0) { throw new AggregateError(cleanupErrors, 'Late lease cleanup failed') }
})

test('native inference failures: balance, rate limit and service recovery', async ({ browserName: _browserName }, testInfo) => {
  test.setTimeout(240_000)
  allowErrorBanners()
  const repoRoot = path.resolve(import.meta.dirname, '../../..')
  const sandbox = createSandbox('platform-inference-failures')
  let api: Awaited<ReturnType<typeof startRealPlatformAPI>> | null = null
  let launched: NativeLaunch | null = null
  const consoleLines: string[] = []
  const launchAudits: NativeTransportAudit[] = []
  let primaryError: unknown
  const cleanupErrors: unknown[] = []

  try {
    api = await startRealPlatformAPI(path.resolve(repoRoot, '../Aino-API'))
    const prepared = prepareNativePlatformEnvironment(sandbox, api)
    launched = await launchGuardedDesktop(prepared.env, prepared.nodeGuard)
    launchAudits.push(observeNativeLaunch(launched, consoleLines))
    assertNativeGuardsReady(sandbox, launched.app)
    await observeInferenceAlerts(launched.page)
    await signInForThisSession(launched.page, api)
    await waitForAppReady(launched as never, 120_000)
    assertNewGuardedBackend(sandbox, prepared.pythonGuardPids)
    const account = await launched.page.evaluate(() => (window as unknown as NativeWindow).hermesDesktop.platformAccount.status())

    const proof = await verifyInferenceFailures({ launched, api, accountId: account.account!.id,
      signInAgain: async () => { throw new Error('Inference recovery must preserve the signed-in identity') } })

    const rendererAudit = await auditRenderer(launched.page, api)
    const transport = await assertNoBlockedTransport(sandbox, launchAudits)
    await launched.page.screenshot({ path: testInfo.outputPath('native-inference-failures.png') })
    await launched.app.close()
    launched = null

    const persistedAudit = await auditFixtureText(api, [
      ...persistedFixtureText(sandbox.hermesHome), ...persistedFixtureText(sandbox.userDataDir),
      fs.readFileSync(api.logPath, 'utf8'), ...consoleLines
    ])

    await testInfo.attach('native-inference-failures-receipt', {
      body: JSON.stringify({ source: { aino: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(), api: api.apiSha },
        run_id: api.info.run_id, proof, rendererAudit, persistedAudit, transport }, null, 2), contentType: 'application/json'
    })
  } catch (error) {
    primaryError = error

    if (launched) {
      await launched.page.screenshot({ path: testInfo.outputPath('native-inference-failures-error.png') }).catch(() => undefined)
    }
  } finally {
    if (api) {
      try { await api.control('faults', JSON.stringify({ hold_inference_before_auth: false,
        inference_http_status: 0, inference_http_failures: 0, inference_retry_after_seconds: 0 })) } catch (error) { cleanupErrors.push(error) }
    }

    try { await launched?.app.close() } catch (error) { cleanupErrors.push(error) }

    try { await api?.close() } catch (error) { cleanupErrors.push(error) }

    try { sandbox.cleanup() } catch (error) { cleanupErrors.push(error) }
  }

  if (primaryError !== undefined && cleanupErrors.length > 0) { throw new AggregateError([primaryError, ...cleanupErrors], 'Inference fixture and cleanup failed') }

  if (primaryError !== undefined) { throw primaryError }

  if (cleanupErrors.length > 0) { throw new AggregateError(cleanupErrors, 'Inference fixture cleanup failed') }
})

for (const sameSite of [true, false]) {
  test(`native concurrent isolation: ${sameSite ? 'two accounts on one site' : 'same numeric account on two sites'}`, async ({ browserName: _browserName }, testInfo) => {
    test.setTimeout(300_000)
    const repoRoot = path.resolve(import.meta.dirname, '../../..')
    const sandboxes = [createSandbox('platform-isolation-left'), createSandbox('platform-isolation-right')]
    const apis: Awaited<ReturnType<typeof startRealPlatformAPI>>[] = []
    const launches: Array<NativeLaunch | null> = [null, null]
    const launchAudits: NativeTransportAudit[][] = [[], []]
    const consoleLines: string[][] = [[], []]
    const rendererAudits: unknown[] = []
    const participants: IsolationParticipant[] = []
    let primaryError: unknown
    let stage = 'fixture-start'
    const cleanupErrors: unknown[] = []

    try {
      apis.push(await startRealPlatformAPI(path.resolve(repoRoot, '../Aino-API')))

      if (!sameSite) { apis.push(await startRealPlatformAPI(path.resolve(repoRoot, '../Aino-API'))) }

      const sites = [apis[0], sameSite ? apis[0] : apis[1]]
      const prepared = sandboxes.map((sandbox, index) => prepareNativePlatformEnvironment(sandbox, sites[index]))
      const codeTimes: number[] = []

      for (const index of [0, 1]) {
        stage = `login-${index}`
        const launched = await launchGuardedDesktop(prepared[index].env, prepared[index].nodeGuard)
        launches[index] = launched
        launchAudits[index].push(observeNativeLaunch(launched, consoleLines[index]))
        assertNativeGuardsReady(sandboxes[index], launched.app)
        await observeIsolationAlerts(launched)
        await observeNativeRuntime(launched.page)
        const phone = sameSite && index === 1 ? sites[index].info.secondary_phone : sites[index].info.phone
        codeTimes[index] = await signInForThisSession(launched.page, sites[index], 0, phone)
        await waitForAppReady(launched as never, 120_000)
        assertNewGuardedBackend(sandboxes[index], prepared[index].pythonGuardPids)
        const snapshot = await launched.page.evaluate(() => (window as unknown as NativeWindow).hermesDesktop.platformAccount.status())
        expect(snapshot.account?.id).toBeTruthy()
        participants.push({ launched, api: sites[index], accountId: snapshot.account!.id })
      }

      stage = 'overlapping-inference'
      const concurrent = await verifyConcurrentIsolation(participants[0], participants[1])
      const previous = concurrent.histories[0]
      const left = launches[0]!
      await assertIsolationAlerts(left)
      rendererAudits.push(await auditRenderer(left.page, sites[0]))
      await left.page.screenshot({ path: testInfo.outputPath('native-isolation-before-switch.png') })
      stage = 'replace-left-owner'

      if (sameSite) {
        await left.page.getByRole('button', { name: /^My account/ }).click()
        await left.page.getByRole('button', { name: 'Sign out', exact: true }).click()
        await expect.poll(async () => (await left.page.evaluate(() => (window as unknown as NativeWindow).hermesDesktop.platformAccount.status())).phase).toBe('signed_out')
        await signInForThisSession(left.page, sites[1], codeTimes[1], sites[1].info.secondary_phone)
        await waitForAppReady(left as never, 120_000)
      } else {
        await assertNoBlockedTransport(sandboxes[0], launchAudits[0])
        await left.app.close()
        launches[0] = null
        const priorPids = pythonGuardPids(sandboxes[0])
        fs.writeFileSync(path.join(sandboxes[0].userDataDir, 'platform-development.json'),
          JSON.stringify({ enabled: true, origin: sites[1].info.origin }), { mode: 0o600 })
        const restarted = await launchGuardedDesktop(prepared[0].env, prepared[0].nodeGuard)
        launches[0] = restarted
        launchAudits[0].push(observeNativeLaunch(restarted, consoleLines[0]))
        assertNativeGuardsReady(sandboxes[0], restarted.app)
        await observeIsolationAlerts(restarted)
        await observeNativeRuntime(restarted.page)
        await signInForThisSession(restarted.page, sites[1], codeTimes[1])
        await waitForAppReady(restarted as never, 120_000)
        assertNewGuardedBackend(sandboxes[0], priorPids)
      }

      stage = 'retained-history-and-new-chat'

      const retained = await verifyRetainedHistoryIsolation({
        launched: launches[0]!, api: sites[1], accountId: participants[1].accountId
      }, previous, sites[0])

      const transports = []

      for (const index of [0, 1]) {
        const launched = launches[index]!
        await assertIsolationAlerts(launched)

        for (const api of apis) { rendererAudits.push(await auditRenderer(launched.page, api)) }
        transports.push(await assertNoBlockedTransport(sandboxes[index], launchAudits[index]))
        await launched.page.screenshot({ path: testInfo.outputPath(`native-isolation-final-${index}.png`) })
        await launched.app.close()
        launches[index] = null
      }

      stage = 'persisted-secret-audit'

      const persisted = sandboxes.flatMap(sandbox => [
        ...persistedFixtureText(sandbox.hermesHome), ...persistedFixtureText(sandbox.userDataDir)
      ])

      persisted.push(...apis.map(api => fs.readFileSync(api.logPath, 'utf8')), ...consoleLines.flat())
      const persistedAudits = []

      for (const api of apis) { persistedAudits.push(await auditFixtureText(api, persisted)) }

      await testInfo.attach('native-isolation-receipt', {
        body: JSON.stringify({ source: { aino: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(), api: apis[0].apiSha },
          run_ids: apis.map(api => api.info.run_id), same_site: sameSite, concurrent, retained,
          rendererAudits, persistedAudits, transports }, null, 2), contentType: 'application/json'
      })
    } catch (error) {
      primaryError = error
      console.log(`Native isolation failed at ${stage}`)
      const states = []

      for (const participant of participants) {
        states.push(await participant.api.control(`state?user_id=${encodeURIComponent(participant.accountId)}`).catch(() => null))
      }

      const faults = []

      for (const api of apis) { faults.push(await api.control('faults').catch(() => null)) }
      await testInfo.attach('native-isolation-failure-state', {
        body: JSON.stringify({ stage, states, faults }, null, 2), contentType: 'application/json'
      })

      for (const index of [0, 1]) {
        const launched = launches[index]

        if (launched) { await launched.page.screenshot({ path: testInfo.outputPath(`native-isolation-error-${index}.png`) }).catch(() => undefined) }
      }
    } finally {
      for (const api of apis) {
        try { await api.control('faults', JSON.stringify({ hold_inference_before_auth: false, hold_credential_response: false })) } catch (error) { cleanupErrors.push(error) }
      }

      for (const launched of launches) { try { await launched?.app.close() } catch (error) { cleanupErrors.push(error) } }

      for (const api of apis) { try { await api.close() } catch (error) { cleanupErrors.push(error) } }

      for (const sandbox of sandboxes) { try { sandbox.cleanup() } catch (error) { cleanupErrors.push(error) } }
    }

    if (primaryError !== undefined && cleanupErrors.length > 0) { throw new AggregateError([primaryError, ...cleanupErrors], 'Isolation fixture and cleanup failed') }

    if (primaryError !== undefined) { throw primaryError }

    if (cleanupErrors.length > 0) { throw new AggregateError(cleanupErrors, 'Isolation fixture cleanup failed') }
  })
}

test('desktop recharge reaches the same wallet through independent website login', async ({ browserName: _browserName }, testInfo) => {
  test.setTimeout(180_000)
  const repoRoot = path.resolve(import.meta.dirname, '../../..')
  const sandbox = createSandbox('platform-recharge-website')
  let api: Awaited<ReturnType<typeof startRealPlatformAPI>> | null = null
  let launched: NativeLaunch | null = null
  const consoleLines: string[] = []
  const launchAudits: NativeTransportAudit[] = []
  let primaryError: unknown
  const cleanupErrors: unknown[] = []

  try {
    api = await startRealPlatformAPI(path.resolve(repoRoot, '../Aino-API'))
    const prepared = prepareNativePlatformEnvironment(sandbox, api)

    launched = await launchGuardedDesktop(prepared.env, prepared.nodeGuard)
    launchAudits.push(observeNativeLaunch(launched, consoleLines))
    assertNativeGuardsReady(sandbox, launched.app)
    const codeAt = await signInForThisSession(launched.page, api)

    await waitForAppReady(launched as never, 120_000)
    assertNewGuardedBackend(sandbox, prepared.pythonGuardPids)
    const account = await launched.page.evaluate(() => (window as unknown as NativeWindow).hermesDesktop.platformAccount.status())
    const recharge = await rechargeNativeWallet(launched.page, api, account.account!.id, testInfo.outputPath('desktop-recharge.png'))

    const website = await verifyWebsiteWallet({
      api,
      frontendDist: path.join(repoRoot, '../Aino-API/backend/internal/web/dist'),
      previousCodeAt: codeAt,
      screenshotPath: testInfo.outputPath('website-recharged-wallet.png')
    })

    const finalState = await api.control<NativeState>('state')
    const desktopWallet = await launched.page.evaluate(id => (window as unknown as NativeWindow).hermesDesktop.platformBilling.summary({ expected_user_id: id }), account.account!.id)

    expect(website.accountId).toBe(account.account!.id)
    expect(website.accountId).toBe(String(finalState.user_id))
    expect(website.balance).toBe(Number(recharge.paid.balance).toFixed(2))
    expect(desktopWallet.balance).toBe(finalState.balance)
    expect(finalState.balance).toBe(recharge.paid.balance)
    expect(finalState.orders).toBe(1)
    expect(finalState.payment_calls).toBe(1)
    expect(finalState.usage_calls).toBe(0)
    expect(finalState.model_calls).toBe(0)
    const rendererAudit = await auditRenderer(launched.page, api)
    const transport = await assertNoBlockedTransport(sandbox, launchAudits)

    await launched.app.close()
    launched = null

    const persistedAudit = await auditFixtureText(api, [
      ...persistedFixtureText(sandbox.hermesHome),
      ...persistedFixtureText(sandbox.userDataDir),
      fs.readFileSync(api.logPath, 'utf8'),
      ...consoleLines
    ])

    expect(persistedAudit.leaked).toBe(false)
    await testInfo.attach('cross-client-recharge-receipt', {
      body: JSON.stringify({
        run_id: api.info.run_id,
        aino_sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
        api_sha: api.apiSha,
        account_id: website.accountId,
        before_balance: recharge.before.balance,
        after_balance: finalState.balance,
        credited_units: (decimalUnits(finalState.balance) - decimalUnits(recharge.before.balance)).toString(),
        orders: finalState.orders,
        payment_calls: finalState.payment_calls,
        usage_calls: finalState.usage_calls,
        model_calls: finalState.model_calls,
        desktop_balance: desktopWallet.balance,
        website,
        rendererAudit,
        persistedAudit,
        transport: { denied_public_font_hosts: transport.expectedFontHosts, blocked_before_transport: true }
      }, null, 2),
      contentType: 'application/json'
    })
  } catch (error) {
    primaryError = error
  } finally {
    try { await launched?.app.close() } catch (error) { cleanupErrors.push(error) }

    try { await api?.close() } catch (error) { cleanupErrors.push(error) }

    try { sandbox.cleanup() } catch (error) { cleanupErrors.push(error) }
  }

  if (primaryError !== undefined && cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], 'Cross-client recharge fixture and cleanup failed')
  }

  if (primaryError !== undefined) { throw primaryError }

  if (cleanupErrors.length > 0) { throw new AggregateError(cleanupErrors, 'Cross-client recharge fixture cleanup failed') }
})

test('real API account, native managed lease, Python tool roundtrip and wallet', async ({ browserName: _browserName }, testInfo) => {
  test.setTimeout(450_000)
  const repoRoot = path.resolve(import.meta.dirname, '../../..')
  const api = await startRealPlatformAPI(path.resolve(repoRoot, '../Aino-API'))
  const sandbox = createSandbox('platform-native-consumer')
  const byok = await startMockServer()
  let launched: NativeLaunch | null = null
  const consoleLines: string[] = []
  const launchAudits: NativeTransportAudit[] = []
  let stage = 'launch'
  let primaryError: unknown
  const cleanupErrors: unknown[] = []

  try {
    const prepared = prepareNativePlatformEnvironment(sandbox, api)
    const { env, nodeGuard, pythonGuardPids: firstPythonGuardPids } = prepared

    launched = await launchGuardedDesktop(env, nodeGuard)
    const { app, page } = launched
    launchAudits.push(observeNativeLaunch(launched, consoleLines))
    assertNativeGuardsReady(sandbox, app)
    stage = 'session-only-login'
    const firstCodeAt = await signInForThisSession(page, api)
    stage = 'workspace-ready'
    await waitForAppReady({ app, page } as never, 120_000)
    assertNewGuardedBackend(sandbox, firstPythonGuardPids)
    const snapshot = await page.evaluate(() => (window as unknown as NativeWindow).hermesDesktop.platformAccount.status())
    const initial = await api.control<NativeState>('state')
    expect(snapshot.account?.id).toBe(String(initial.user_id))
    expect(initial.balance).toBe('10.00000000')
    await page.locator('[data-tour="model-pill"]').click()
    await page.getByRole('button', { name: 'Aino models', exact: true }).click()
    await page.getByRole('option', { name: /fixture-tool-model/ }).click()
    await expect(page.locator('[data-tour="model-pill"]')).toContainText('fixture-tool-model')
    await page.screenshot({ path: testInfo.outputPath('platform-native-home-light.png') })

    stage = 'first-platform-tool-turn'
    const composer = page.locator('[contenteditable="true"]').first()
    const composerForm = composer.locator('xpath=ancestor::form')

    await composer.click()
    await composer.pressSequentially(`Read the isolated fixture file ${api.info.fixture_path} using read_file and verify its content.`)
    await page.keyboard.press('Enter')
    await expect(page.getByText(`Verified ${api.info.fixture_content}`, { exact: false }).first()).toBeVisible({ timeout: 90_000 })
    await expect.poll(async () => (await api.control<NativeState>('state')).usage_calls).toBe(2)
    const settled = await api.control<NativeState>('state')
    expect(settled.tool_results).toBe(1)
    expect(settled.usage_turns).toBe(1)
    expect(Number(initial.balance) - Number(settled.balance)).toBeCloseTo(Number(settled.usage_cost), 8)
    stage = 'stream-cancel'
    const sessionUrl = page.url()
    await expect(composerForm.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await composer.click()
    await composer.pressSequentially('fixture-cancel-stream')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await api.control<NativeState>('state')).stream_started).toBe(1)
    await composerForm.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(composerForm.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expect.poll(async () => (await api.control<NativeState>('state')).downstream_disconnects, { timeout: 15_000 }).toBe(1)
    await expect.poll(async () => (await api.control<NativeState>('state')).stream_drained, { timeout: 15_000 }).toBe(1)
    await expect.poll(async () => (await api.control<NativeState>('state')).usage_calls, { timeout: 15_000 }).toBe(3)
    const cancelled = await api.control<NativeState>('state')
    expect(cancelled.model_calls).toBe(3)
    expect(cancelled.stream_cancelled).toBe(0)
    expect(cancelled.stream_timeouts).toBe(0)
    expect(cancelled.stream_shutdowns).toBe(0)
    expect(decimalUnits(initial.balance) - decimalUnits(cancelled.balance)).toBe(decimalUnits(cancelled.usage_cost))

    stage = 'native-recharge'
    const { paid } = await rechargeNativeWallet(page, api, snapshot.account!.id, testInfo.outputPath('platform-native-recharge.png'))

    const initialAudit = await auditRenderer(page, api)
    await assertNoBlockedTransport(sandbox, launchAudits)
    expect(fs.existsSync(path.join(sandbox.hermesHome, 'node-network-guard-active'))).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('platform-native-tool-reply.png') })
    // Custom provider is introduced only AFTER proving fresh no-BYOK use.
    stage = 'restart-platform-history'
    await app.close()
    launched = null
    expect(fs.readFileSync(path.join(sandbox.hermesHome, 'config.yaml'), 'utf8')).not.toContain(byok.url)
    const resumedPythonGuardPids = pythonGuardPids(sandbox)

    launched = await launchGuardedDesktop(env, nodeGuard)
    const restarted = launched.page
    launchAudits.push(observeNativeLaunch(launched, consoleLines))
    assertNativeGuardsReady(sandbox, launched.app)
    const secondCodeAt = await signInForThisSession(restarted, api, firstCodeAt)
    await waitForAppReady(launched as never, 120_000)
    assertNewGuardedBackend(sandbox, resumedPythonGuardPids)
    expect((await restarted.evaluate(() => (window as unknown as NativeWindow).hermesDesktop.platformAccount.status())).account?.id).toBe(snapshot.account!.id)
    await restarted.goto(sessionUrl)
    await expect(restarted.getByText(`Verified ${api.info.fixture_content}`, { exact: false }).first()).toBeVisible({ timeout: 60_000 })
    const resumeComposer = restarted.locator('[contenteditable="true"]').first()
    const resumeComposerForm = resumeComposer.locator('xpath=ancestor::form')

    const beforeResume = await api.control<NativeState>('state')
    await resumeComposer.click()
    await resumeComposer.pressSequentially(`Read the isolated file again after restart: ${api.info.fixture_path}`)
    const resumeSubmittedAt = performance.now()
    await restarted.keyboard.press('Enter')
    await expect.poll(async () => (await api.control<NativeState>('state')).tool_results, { timeout: 60_000 }).toBe(beforeResume.tool_results + 1)
    await expect.poll(async () => (await api.control<NativeState>('state')).usage_calls, { timeout: 60_000 }).toBe(beforeResume.usage_calls + 2)
    const resumeToolRoundtripMs = Math.round(performance.now() - resumeSubmittedAt)
    await expect(resumeComposerForm.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    const restartAudit = await auditRenderer(restarted, api)
    await assertNoBlockedTransport(sandbox, launchAudits)
    stage = 'workspace-switch'
    const workspace = await verifyPlatformWorkspace(launched, api, sandbox, snapshot.account!.id, testInfo.outputPath('platform-native-workspace.png'))
    await assertNoBlockedTransport(sandbox, launchAudits)
    expect(decimalUnits(workspace.before.balance) - decimalUnits(workspace.after.balance)).toBe(decimalUnits(workspace.after.usage_cost) - decimalUnits(workspace.before.usage_cost))
    await launched.app.close()
    launched = null

    // The recovery pair above proves platform history and billing before any
    // custom provider exists. A third real launch is the supported reload path.
    writeMockProviderConfig(sandbox.hermesHome, byok.url, '  language: en')
    writeEnvFile(sandbox.hermesHome)
    stage = 'custom-provider-restart'
    const byokPythonGuardPids = pythonGuardPids(sandbox)

    launched = await launchGuardedDesktop(env, nodeGuard)
    const customProvider = launched.page
    launchAudits.push(observeNativeLaunch(launched, consoleLines))
    assertNativeGuardsReady(sandbox, launched.app)
    const thirdCodeAt = await signInForThisSession(customProvider, api, secondCodeAt)
    await waitForAppReady(launched as never, 120_000)
    assertNewGuardedBackend(sandbox, byokPythonGuardPids)
    expect((await customProvider.evaluate(() => (window as unknown as NativeWindow).hermesDesktop.platformAccount.status())).account?.id).toBe(snapshot.account!.id)
    stage = 'custom-provider-switch'
    await customProvider.locator('[data-tour="model-pill"]').first().click()
    await customProvider.getByRole('button', { name: 'Custom models', exact: true }).click()
    await customProvider.getByRole('menuitem', { name: /Mock Model/ }).first().click()
    const beforeBYOK = await api.control<NativeState>('state')
    const byokComposer = customProvider.locator('[contenteditable="true"]').first()
    await byokComposer.click()
    await byokComposer.pressSequentially('Hello from an isolated custom provider')
    await customProvider.keyboard.press('Enter')
    await expect(customProvider.getByText('Hello from the mock inference server!', { exact: false }).first()).toBeVisible({ timeout: 60_000 })
    const afterBYOK = await api.control<NativeState>('state')
    expect(afterBYOK.balance).toBe(beforeBYOK.balance)
    expect(afterBYOK.model_calls).toBe(beforeBYOK.model_calls)
    expect(afterBYOK.usage_calls).toBe(beforeBYOK.usage_calls)
    expect(fs.readFileSync(path.join(sandbox.hermesHome, 'config.yaml'), 'utf8')).toContain(byok.url)
    const byokAudit = await auditRenderer(customProvider, api)
    stage = 'website-wallet'
    const website = await verifyWebsiteWallet({ api, frontendDist: path.join(repoRoot, '../Aino-API/backend/internal/web/dist'), previousCodeAt: thirdCodeAt, screenshotPath: testInfo.outputPath('platform-website-wallet.png') })
    expect(website.accountId).toBe(snapshot.account!.id)
    expect(website.balance).toBe(Number(afterBYOK.balance).toFixed(2))
    const transport = await assertNoBlockedTransport(sandbox, launchAudits)
    const receipt = { run_id: api.info.run_id, api_sha: api.apiSha, aino_sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(), initial, settled, cancelled, paid, workspace, beforeBYOK, afterBYOK, website, initialAudit, restartAudit, resume_tool_roundtrip_ms: resumeToolRoundtripMs, byokAudit, transport: { known_public_font: { host: 'fonts.googleapis.com', attempted: true, blocked_before_transport: true, delivered: false, denied_hosts: transport.expectedFontHosts } }, api_log: api.logPath }
    await testInfo.attach('native-receipt', { body: JSON.stringify(receipt, null, 2), contentType: 'application/json' })
    fs.writeFileSync(path.join(api.dir, 'native-receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 })
    await launched.app.close()
    launched = null
    await assertNoBlockedTransport(sandbox, launchAudits)
    const persistedAudit = await auditFixtureText(api, [...persistedFixtureText(sandbox.hermesHome), ...persistedFixtureText(sandbox.userDataDir), fs.readFileSync(api.logPath, 'utf8'), ...consoleLines])
    expect(persistedAudit.leaked).toBe(false)
  } catch (error) {
    primaryError = error
    const state = await api.control<NativeState>('state').catch(() => null)
    const account = launched ? await launched.page.evaluate(() => (window as unknown as NativeWindow).hermesDesktop.platformAccount.status()).catch(() => null) : null
    const failure = { run_id: api.info.run_id, stage, state, account }
    fs.writeFileSync(path.join(api.dir, 'native-failure.json'), JSON.stringify(failure, null, 2), { mode: 0o600 })
    const diagnostics: string[] = [...consoleLines]
    const logDir = path.join(sandbox.hermesHome, 'logs')

    for (const entry of fs.existsSync(logDir) ? fs.readdirSync(logDir, { withFileTypes: true }) : []) {
      if (entry.isFile() && entry.name.endsWith('.log')) { diagnostics.push(fs.readFileSync(path.join(sandbox.hermesHome, 'logs', entry.name), 'utf8')) }
    }

    const text = diagnostics.join('\n')
    const checked = await api.control<{ leaked: boolean }>('audit', text).catch(() => ({ leaked: true }))

    if (!checked.leaked) { fs.writeFileSync(path.join(api.dir, 'native-diagnostics.log'), text, { mode: 0o600 }) }

    if (launched) { await launched.page.screenshot({ path: testInfo.outputPath('native-failure.png') }).catch(() => undefined) }
    console.log(`Native fixture failed at ${stage}; run_id=${api.info.run_id}; private evidence=${api.dir}`)
  } finally {
    try { await launched?.app.close() } catch (error) { cleanupErrors.push(error) }

    try { await api.close() } catch (error) { cleanupErrors.push(error) }

    try { await byok.close() } catch (error) { cleanupErrors.push(error) }

    try { sandbox.cleanup() } catch (error) { cleanupErrors.push(error) }
  }

  if (primaryError !== undefined && cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], 'Native fixture failed and cleanup did not complete')
  }

  if (primaryError !== undefined) { throw primaryError }

  if (cleanupErrors.length > 0) { throw new AggregateError(cleanupErrors, 'Native fixture cleanup failed') }
})
