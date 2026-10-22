import { waitForAppReady } from './fixtures'
import { type launchGuardedDesktop, type NativeState, type startRealPlatformAPI } from './platform-real-api'
import { expect, type Page } from './test'

type Launch = Awaited<ReturnType<typeof launchGuardedDesktop>>
type API = Awaited<ReturnType<typeof startRealPlatformAPI>>
interface AccountSnapshot {
  phase: 'signed_in' | 'signed_out' | 'offline' | 'loading' | 'reauth_required'
  account: { id: string } | null
  revision: number
  error: { code: string } | null
}
interface AccountBridge {
  status(): Promise<AccountSnapshot>
  retry(): Promise<AccountSnapshot>
  logout(): Promise<AccountSnapshot>
  onChanged(listener: (snapshot: AccountSnapshot) => void): () => void
}
interface EdgeWindow {
  hermesDesktop: {
    platformAccount: AccountBridge
    openWindow(): Promise<unknown>
  }
  edgeAccountEvents: Array<{ phase: string; id: string | null; revision: number }>
  edgeOfflineAllowed: boolean
  edgeAlerts: Array<{ expected: boolean; message: string }>
  edgeRuntime?: { socket: WebSocket; id: string }
  edgeRuntimeObserverInstalled?: boolean
  edgeTerminalEvents?: unknown[]
}
export interface NativeFaultState {
  profile_calls: number
  profile_401s: number
  network_drops: number
  refresh_started: number
  refresh_completed: number
  refresh_waiting: number
  logout_started: number
  logout_completed: number
  logout_waiting: number
  credential_requests: number
  credential_successes: number
  inference_requests: number
  inference_waiting: number
  gate_timeouts: number
  gate_cancellations: number
  refresh_responses: number
}
export interface EdgeContext {
  launched: Launch
  api: API
  accountId: string
  signInAgain(): Promise<void>
}

export async function observeEdgeAlerts(launched: Launch, allowRevocation: boolean) {
  const observe = (allow: boolean) => {
    const target = window as unknown as EdgeWindow
    target.edgeAlerts = []
    target.edgeOfflineAllowed = false

    const scan = () => {
      for (const alert of document.querySelectorAll('[role="alert"]')) {
        const text = alert.textContent?.trim() ?? ''

        if (!text) { continue }

        const message = (alert.querySelector('details > div') ??
          alert.querySelector(':scope > div:first-child > div > .min-w-0'))?.textContent?.trim()

        const expected = allow && (
          message === 'Aino model authorization was revoked. Sign in and select the model again.' ||
          (target.edgeOfflineAllowed && alert.tagName === 'P' && text === 'The account service is offline. Check your connection and retry.')
        )

        if (!target.edgeAlerts.some(item => item.message === text && item.expected === expected)) {
          target.edgeAlerts.push({ expected, message: text })
        }
      }
    }

    const start = () => {
      scan()
      new MutationObserver(scan).observe(document.body, { childList: true, subtree: true, characterData: true })
    }

    if (document.body) { start() } else { document.addEventListener('DOMContentLoaded', start, { once: true }) }
  }

  await launched.app.context().addInitScript(observe, allowRevocation)
  await launched.page.evaluate(observe, allowRevocation)
}

export async function assertEdgeAlerts(launched: Launch) {
  for (const page of launched.app.windows()) {
    const alerts = await page.evaluate(() => (window as unknown as EdgeWindow).edgeAlerts)
    expect(Array.isArray(alerts)).toBe(true)
    expect(alerts.filter(item => !item.expected), 'unexpected native alerts').toEqual([])
  }
}

// Observe the real renderer transport before login mounts the gateway. Retain
// its runtime only to issue the existing read-only, owner-checked model.options.
export async function observeNativeRuntime(page: Page) {
  const observe = () => {
    const target = window as unknown as EdgeWindow

    if (target.edgeRuntimeObserverInstalled) { return }
    target.edgeRuntimeObserverInstalled = true
    target.edgeTerminalEvents = []
    const Original = window.WebSocket
    window.WebSocket = new Proxy(Original, {
      construct(ctor, args) {
        const socket = Reflect.construct(ctor, args) as WebSocket
        socket.addEventListener('message', event => {
          if (typeof event.data !== 'string') {
            return
          }

          let response: { result?: { session_id?: string; info?: { model_source?: string } } }

          try {
            response = JSON.parse(event.data)
          } catch {
            return
          }

          if (event.data.includes('"turn_metrics"') || event.data.includes('"message.complete"')) {
            target.edgeTerminalEvents?.push(response)
          }

          if (response.result?.session_id && response.result.info?.model_source === 'aino') {
            target.edgeRuntime = { socket, id: response.result.session_id }
          }
        })

        return socket
      }
    })
  }

  await page.addInitScript(observe)
  await page.evaluate(observe)
}

async function runtimeStatus(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const runtime = (window as unknown as EdgeWindow).edgeRuntime

        if (!runtime || runtime.socket.readyState !== WebSocket.OPEN) {
          reject(new Error('Original renderer runtime transport unavailable'))

          return
        }

        const id = `native-readonly-${crypto.randomUUID()}`

        const cleanup = () => {
          clearTimeout(timer)
          runtime.socket.removeEventListener('message', receive)
        }

        const receive = (event: MessageEvent) => {
          if (typeof event.data !== 'string') {
            return
          }

          let response: { id?: string; result?: { session_info?: { model_status?: string } }; error?: unknown }

          try {
            response = JSON.parse(event.data)
          } catch {
            return
          }

          if (response.id !== id) {
            return
          }

          cleanup()

          if (response.error) {
            reject(new Error('Read-only runtime observation rejected'))

            return
          }

          resolve(response.result?.session_info?.model_status ?? '')
        }

        const timer = setTimeout(() => {
          cleanup()
          reject(new Error('Read-only runtime observation timed out'))
        }, 5_000)

        runtime.socket.addEventListener('message', receive)
        runtime.socket.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            method: 'model.options',
            params: {
              session_id: runtime.id,
              profile: 'default',
              explicit_only: true,
              include_session_info: true
            }
          })
        )
      })
  )
}

export async function account(page: Page) {
  return page.evaluate(() => (window as unknown as EdgeWindow).hermesDesktop.platformAccount.status())
}

function accountOperation(page: Page, operation: 'retry' | 'logout') {
  return page.evaluate(async method => {
    try {
      const snapshot = await (window as unknown as EdgeWindow).hermesDesktop.platformAccount[method]()

      return { ok: true, phase: snapshot.phase, id: snapshot.account?.id ?? null, code: snapshot.error?.code ?? null }
    } catch (error) {
      return { ok: false, phase: '', id: null, code: String((error as { code?: unknown }).code ?? '') }
    }
  }, operation)
}

async function observeAccount(page: Page) {
  await page.evaluate(() => {
    const target = window as unknown as EdgeWindow
    target.edgeAccountEvents = []
    target.hermesDesktop.platformAccount.onChanged(snapshot => {
      target.edgeAccountEvents.push({
        phase: snapshot.phase,
        id: snapshot.account?.id ?? null,
        revision: snapshot.revision
      })
    })
  })
}

async function peerWindow(launched: Launch) {
  await launched.page.evaluate(() => (window as unknown as EdgeWindow).hermesDesktop.openWindow())
  await expect.poll(() => launched.app.windows().length).toBe(2)
  const peer = launched.app.windows().find(candidate => candidate !== launched.page)!
  await waitForAppReady({ app: launched.app, page: peer } as never, 60_000)
  await Promise.all([observeAccount(launched.page), observeAccount(peer)])

  return peer
}

async function bothAccount(pages: Page[], phase: AccountSnapshot['phase'], id: string | null) {
  for (const page of pages) {
    await expect
      .poll(async () => {
        const snapshot = await account(page)

        return { phase: snapshot.phase, id: snapshot.account?.id ?? null }
      })
      .toEqual({ phase, id })
  }
}

export async function sendToolTurn(page: Page, api: API) {
  const before = await api.control<NativeState>('state')
  await page.locator('[data-tour="model-pill"]').first().click()
  await page.getByRole('button', { name: 'Aino models', exact: true }).click()
  await page.getByRole('option', { name: /fixture-tool-model/ }).click()
  await sendPrompt(page, `Read ${api.info.fixture_path} and verify its content.`)
  await expect
    .poll(async () => (await api.control<NativeState>('state')).usage_calls, { timeout: 60_000 })
    .toBe(before.usage_calls + 2)
  await expect(page.getByText(`Verified ${api.info.fixture_content}`, { exact: false }).first()).toBeVisible()
  await expect(
    page
      .locator('[contenteditable="true"]')
      .first()
      .locator('xpath=ancestor::form')
      .getByRole('button', { name: 'Stop', exact: true })
  ).toHaveCount(0)
  const after = await api.control<NativeState>('state')
  expect(after.model_calls - before.model_calls).toBe(2)
  expect(after.tool_results - before.tool_results).toBe(1)

  return after
}

export async function sendPrompt(page: Page, text: string) {
  const composer = page.locator('[contenteditable="true"]').first()
  await composer.click()
  await composer.pressSequentially(text)
  await page.keyboard.press('Enter')
}

export function consumption(state: NativeState) {
  return {
    model_calls: state.model_calls,
    usage_calls: state.usage_calls,
    tool_results: state.tool_results,
    balance: state.balance
  }
}

export async function verifyConcurrentAccountLifecycle({ launched, api, accountId }: EdgeContext) {
  const { page } = launched
  const peer = await peerWindow(launched)
  const pages = [page, peer]
  const initial = await sendToolTurn(page, api)
  expect(await runtimeStatus(page)).toBe('ready')
  expect((await api.control<{ http_status: number }>('probe-retired-lease', '')).http_status).toBe(200)
  const before = await api.control<NativeFaultState>('faults')

  await api.control('faults', JSON.stringify({ profile_401_for_current_access: true, hold_refresh_response: true }))
  const refreshes = pages.map(candidate => accountOperation(candidate, 'retry'))
  await expect
    .poll(async () => (await api.control<NativeFaultState>('faults')).profile_401s)
    .toBeGreaterThanOrEqual(before.profile_401s + 2)
  await expect.poll(async () => (await api.control<NativeFaultState>('faults')).refresh_waiting).toBe(1)
  const singleFlight = await api.control<NativeFaultState>('faults')
  expect(singleFlight.refresh_started - before.refresh_started).toBe(1)
  expect(singleFlight.refresh_completed - before.refresh_completed).toBe(1)
  await api.control('faults', JSON.stringify({ profile_401_for_current_access: false, hold_refresh_response: false }))

  for (const result of await Promise.all(refreshes)) {
    expect(result).toMatchObject({ ok: true, phase: 'signed_in', id: accountId })
  }

  await bothAccount(pages, 'signed_in', accountId)

  await api.control(
    'faults',
    JSON.stringify({ profile_401_for_current_access: true, hold_refresh_response: true, hold_logout_response: true })
  )
  const beforeLate = await api.control<NativeFaultState>('faults')
  const lateRefreshes = pages.map(candidate => accountOperation(candidate, 'retry'))
  await expect.poll(async () => (await api.control<NativeFaultState>('faults')).profile_401s).toBeGreaterThanOrEqual(beforeLate.profile_401s + 2)
  await expect.poll(async () => (await api.control<NativeFaultState>('faults')).refresh_waiting).toBe(1)
  const beforeLogout = await api.control<NativeFaultState>('faults')
  const logouts = pages.map(candidate => accountOperation(candidate, 'logout'))
  await expect.poll(async () => (await api.control<NativeFaultState>('faults')).logout_waiting).toBe(1)
  const held = await api.control<NativeFaultState>('faults')
  expect(held.logout_started - beforeLogout.logout_started).toBe(1)
  expect(held.logout_completed - beforeLogout.logout_completed).toBe(1)
  await expect.poll(() => runtimeStatus(page)).toBe('awaiting_managed_credentials')
  const localRejection = await accountOperation(peer, 'retry')
  expect(localRejection).toMatchObject({ ok: false, code: 'logout_in_progress' })
  await api.control('faults', JSON.stringify({ hold_logout_response: false }))

  for (const result of await Promise.all(logouts)) {
    expect(result).toMatchObject({ ok: true, phase: 'signed_out', id: null })
  }

  await bothAccount(pages, 'signed_out', null)
  await api.control('faults', JSON.stringify({ profile_401_for_current_access: false, hold_refresh_response: false }))

  for (const result of await Promise.all(lateRefreshes)) {
    expect(result).toMatchObject({ ok: false, code: 'auth_attempt_superseded' })
  }

  await bothAccount(pages, 'signed_out', null)
  const retired = await api.control<{ http_status: number; revoked: boolean }>('probe-retired-lease', '')
  expect(retired).toMatchObject({ http_status: 401, revoked: true })

  for (const candidate of pages) {
    await expect(candidate.getByRole('textbox', { name: 'Phone number', exact: true })).toBeVisible()
    const events = await candidate.evaluate(() => (window as unknown as EdgeWindow).edgeAccountEvents)
    const signedOut = events.findIndex(event => event.phase === 'signed_out')
    expect(signedOut).toBeGreaterThanOrEqual(0)
    expect(events.slice(signedOut).every(event => event.phase === 'signed_out' && event.id === null)).toBe(true)
  }

  const final = await api.control<NativeState>('state')
  const faults = await api.control<NativeFaultState>('faults')
  expect(consumption(final)).toEqual(consumption(initial))
  expect(faults.gate_timeouts).toBe(0)
  expect(faults.gate_cancellations).toBe(before.gate_cancellations)
  expect(faults.refresh_responses - before.refresh_responses).toBe(2)

  return {
    single_flight_refresh: true,
    single_flight_logout: true,
    late_refresh_rejected: true,
    runtime_cleared_before_logout_response: true,
    retired,
    initial: consumption(initial),
    final: consumption(final),
    faults
  }
}

export async function verifyOfflineAndAuthorizationRecovery({ launched, api, accountId, signInAgain }: EdgeContext) {
  const { page } = launched
  const peer = await peerWindow(launched)
  const pages = [page, peer]
  const initial = await sendToolTurn(page, api)
  await page
    .getByRole('button', { name: /^My account/ })
    .first()
    .click()
  await Promise.all(pages.map(candidate => candidate.evaluate(() => { (window as unknown as EdgeWindow).edgeOfflineAllowed = true })))
  await api.control('faults', JSON.stringify({ offline: true }))
  const offlineResults = await Promise.all(pages.map(candidate => accountOperation(candidate, 'retry')))
  expect(offlineResults.every(result => !result.ok && result.code === 'network_unavailable')).toBe(true)
  await bothAccount(pages, 'offline', accountId)
  await expect(
    page.getByText('Account details are shown from the last verified snapshot. Reconnect to refresh them.', {
      exact: true
    })
  ).toBeVisible()

  for (const candidate of pages) {
    await expect(candidate.getByRole('textbox', { name: 'Phone number', exact: true })).toHaveCount(0)
  }

  await api.control('faults', JSON.stringify({ offline: false }))
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await bothAccount(pages, 'signed_in', accountId)
  // Wallet reads have their own explicit retry; account broadcasts must not
  // start a feedback loop of failed billing reads while the service is offline.
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByText(`${Number(initial.balance)} USD`, { exact: true })).toBeVisible()
  // Device inventory owns its recovery separately from account and wallet state.
  await page.getByRole('button', { name: 'Refresh devices', exact: true }).click()

  for (const candidate of pages) {
    await expect(candidate.getByText('The account service is offline. Check your connection and retry.', { exact: true })).toHaveCount(0)
    await candidate.evaluate(() => { (window as unknown as EdgeWindow).edgeOfflineAllowed = false })
  }

  const offlineFaults = await api.control<NativeFaultState>('faults')
  expect(offlineFaults.network_drops).toBeGreaterThanOrEqual(2)
  expect(consumption(await api.control<NativeState>('state'))).toEqual(consumption(initial))
  await page.goBack()
  await expect(page.locator('[contenteditable="true"]').first()).toBeVisible()

  const beforeRevocation = await api.control<NativeFaultState>('faults')
  await api.control('faults', JSON.stringify({ hold_inference_before_auth: true }))
  await sendPrompt(page, 'Read the same file again after verifying authorization.')
  await expect.poll(async () => (await api.control<NativeFaultState>('faults')).inference_waiting).toBe(1)
  const awaitingInference = await api.control<NativeFaultState>('faults')
  expect(awaitingInference.inference_requests).toBe(beforeRevocation.inference_requests + 1)
  expect(awaitingInference.credential_successes).toBe(beforeRevocation.credential_successes + 1)
  await api.control('revoke-session', '')
  const retired = await api.control<{ http_status: number; revoked: boolean }>('probe-retired-lease', '')
  expect(retired).toMatchObject({ http_status: 401, revoked: true })
  await api.control('faults', JSON.stringify({ hold_inference_before_auth: false }))
  const recovery = page.locator('button.aui-error-action[data-action="account"]').last()
  await expect(recovery).toBeVisible({ timeout: 30_000 })
  const errorCard = recovery.locator('xpath=ancestor::*[@role="alert"]')
  await errorCard.getByText('Details', { exact: true }).click()
  await expect(page.getByText('Aino model authorization was revoked.', { exact: false }).first()).toBeVisible()
  const errorBlock = recovery.locator('..')
  await expect(errorBlock.getByRole('button', { name: /retry/i })).toHaveCount(0)
  expect((await api.control<NativeFaultState>('faults')).inference_requests).toBe(beforeRevocation.inference_requests + 1)
  const denied = await api.control<NativeState>('state')
  expect(consumption(denied)).toEqual(consumption(initial))
  await recovery.click()
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await bothAccount(pages, 'signed_out', null)
  await signInAgain()
  await bothAccount(pages, 'signed_in', accountId)
  await waitForAppReady(launched as never, 60_000)
  expect(consumption(await api.control<NativeState>('state'))).toEqual(consumption(initial))
  expect((await api.control<NativeFaultState>('faults')).inference_requests).toBe(beforeRevocation.inference_requests + 1)
  const recovered = await sendToolTurn(page, api)
  const faults = await api.control<NativeFaultState>('faults')
  expect(faults.gate_timeouts).toBe(0)
  expect(faults.inference_requests).toBe(beforeRevocation.inference_requests + 3)
  expect(recovered.orders).toBe(0)
  expect(recovered.payment_calls).toBe(0)

  return {
    offline_identity_preserved: true,
    explicit_retry_recovers: true,
    explicit_wallet_refresh_recovers: true,
    original_inference_revoked: true,
    no_automatic_paid_replay: true,
    retired,
    before: consumption(initial),
    denied: consumption(denied),
    recovered: consumption(recovered),
    faults
  }
}
