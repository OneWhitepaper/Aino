import { waitForAppReady } from './fixtures'
import { account, type NativeFaultState, sendPrompt, sendToolTurn } from './platform-account-edge-proof'
import { captureIsolationHistory } from './platform-isolation-proof'
import type { launchGuardedDesktop, NativeState, startRealPlatformAPI } from './platform-real-api'
import { expect } from './test'

type Launch = Awaited<ReturnType<typeof launchGuardedDesktop>>
type API = Awaited<ReturnType<typeof startRealPlatformAPI>>

export interface LateLeaseContext {
  launched: Launch
  api: API
  accountId: string
  // Use the secondary phone's first real SMS challenge. Any cooldown wait must
  // finish before this helper arms the fixture's 30-second response gate.
  signInOther(): Promise<void>
}

interface LeaseFaults extends NativeFaultState {
  credential_waiting: number
  credential_responses: number
}

interface OwnerState extends NativeState {
  credential_requests: number
  credential_successes: number
  inference_requests: number
  inference_responses: number
  usage_ledger: Array<{ user_id: number; desktop_session_id: string; desktop_turn_id: string; actual_cost: string }>
}

interface LateLeaseWindow {
  hermesDesktop: {
    platformAccount: {
      logout(): Promise<{ phase: string; account: { id: string } | null; revision: number }>
    }
    platformModels: {
      bind(input: { connection_id: string; profile: string; session_id: string; model_id: string;
        expected_account_revision: number; session_ticket: string }): Promise<{ ok: boolean; error?: { code: string } }>
    }
  }
  edgeRuntime?: { socket: WebSocket; id: string }
  lateLeaseAlerts: Array<{ message: string; expected: boolean }>
  lateLeaseResponseReleased: boolean
}

const STALE_LEASE_MESSAGE = 'Model authorization failed. Your message has not been sent. Select the model again to retry.'

export async function observeLateLeaseAlerts(launched: Launch) {
  const observe = (expectedMessage: string) => {
    const target = window as unknown as LateLeaseWindow
    target.lateLeaseAlerts = []
    target.lateLeaseResponseReleased = false

    const scan = () => {
      for (const alert of document.querySelectorAll('[role="alert"]')) {
        const text = alert.textContent?.trim() ?? ''

        const message = (alert.querySelector('details > div') ??
          alert.querySelector(':scope > div:first-child > div > .min-w-0'))?.textContent?.trim()

        if (!text) { continue }
        const expected = target.lateLeaseResponseReleased && message === expectedMessage

        if (!target.lateLeaseAlerts.some(entry => entry.message === text && entry.expected === expected)) {
          target.lateLeaseAlerts.push({ message: text, expected })
        }
      }
    }

    const start = () => {
      scan()
      new MutationObserver(scan).observe(document.body, { subtree: true, childList: true, characterData: true })
    }

    if (document.body) { start() } else { document.addEventListener('DOMContentLoaded', start, { once: true }) }
  }

  await launched.app.context().addInitScript(observe, STALE_LEASE_MESSAGE)
  await launched.page.evaluate(observe, STALE_LEASE_MESSAGE)
}

export async function assertLateLeaseAlerts(launched: Launch) {
  for (const page of launched.app.windows()) {
    const alerts = await page.evaluate(() => (window as unknown as LateLeaseWindow).lateLeaseAlerts)
    expect(Array.isArray(alerts)).toBe(true)
    expect(alerts.filter(entry => !entry.expected), 'unexpected late-lease alerts').toEqual([])
  }
}

function ledger(state: OwnerState) {
  return { balance: state.balance, usage_cost: state.usage_cost, usage_calls: state.usage_calls,
    usage_turns: state.usage_turns, usage_ledger: state.usage_ledger, orders: state.orders }
}

function units(value: string) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value)

  if (!match || /[1-9]/.test((match[2] ?? '').slice(8))) { throw new Error('Invalid fixture currency') }

  return BigInt(match[1]) * 100_000_000n + BigInt((match[2] ?? '').slice(0, 8).padEnd(8, '0'))
}

export async function verifyLateLeaseAcrossAccountSwitch({ launched, api, accountId, signInOther }: LateLeaseContext) {
  const { page } = launched
  const state = (id: string) => api.control<OwnerState>(`state?user_id=${encodeURIComponent(id)}`)
  const faults = () => api.control<LeaseFaults>('faults')
  await sendToolTurn(page, api)
  const history = await captureIsolationHistory({ launched, api, accountId })
  const before = await state(accountId)
  const beforeFaults = await faults()
  // The API fixture must count completed HTTP writes, not only successful
  // credential creation; a canceled request is not a delivered stale response.
  expect(Number.isSafeInteger(beforeFaults.credential_responses)).toBe(true)
  await api.control('faults', JSON.stringify({ hold_credential_user_id: Number(accountId), hold_credential_response: true }))
  let gateReleased = false

  try {
    // Use a genuine ticket from the original renderer socket and the public
    // native binding bridge. Retain its real completion across the account
    // switch: stale-view notification suppression is not completion evidence.
    const pendingBinding = page.evaluate(async input => {
      const target = window as unknown as LateLeaseWindow
      const runtime = target.edgeRuntime

      if (!runtime || runtime.id !== input.sessionId || runtime.socket.readyState !== WebSocket.OPEN) {
        throw new Error('Original renderer runtime transport unavailable')
      }

      const ticket = await new Promise<string>((resolve, reject) => {
        const id = `late-lease-ticket-${crypto.randomUUID()}`

        const cleanup = () => { clearTimeout(timer); runtime.socket.removeEventListener('message', receive) }

        const receive = (event: MessageEvent) => {
          if (typeof event.data !== 'string') { return }
          let response: { id?: string; error?: unknown; result?: { session_ticket?: string; managed_model_binding?: number } }

          try { response = JSON.parse(event.data) } catch { return }

          if (response.id !== id) { return }
          cleanup()

          if (response.error || response.result?.managed_model_binding !== 1 || !response.result.session_ticket) {
            reject(new Error('Original renderer binding delegation rejected'))

            return
          }

          resolve(response.result.session_ticket)
        }

        const timer = setTimeout(() => { cleanup(); reject(new Error('Binding ticket timed out')) }, 10_000)
        runtime.socket.addEventListener('message', receive)
        runtime.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'session.managed_model_ticket', params: {
          session_id: input.sessionId, owner: input.owner, model_id: 'fixture-tool-model'
        } }))
      })

      const result = await target.hermesDesktop.platformModels.bind({ connection_id: '', profile: 'default',
        session_id: input.sessionId, model_id: 'fixture-tool-model', expected_account_revision: input.revision,
        session_ticket: ticket })

      return { ok: result.ok, code: result.error?.code ?? null }
    }, { sessionId: history.runtimeId, revision: history.revision, owner: history.owner })
      .then(result => ({ completed: true, ...result }), () => ({ completed: false, ok: false, code: 'renderer_context_lost' }))

    await expect.poll(async () => (await faults()).credential_waiting).toBe(1)
    const held = await faults()
    expect(held.credential_requests).toBe(beforeFaults.credential_requests + 1)
    expect(held.credential_successes).toBe(beforeFaults.credential_successes + 1)
    expect(held.credential_responses).toBe(beforeFaults.credential_responses)
    expect(held.inference_requests).toBe(beforeFaults.inference_requests)
    expect(ledger(await state(accountId))).toEqual(ledger(before))

    const signedOut = await page.evaluate(() => (window as unknown as LateLeaseWindow).hermesDesktop.platformAccount.logout())
    expect(signedOut).toMatchObject({ phase: 'signed_out', account: null })
    expect(signedOut.revision).toBeGreaterThan(history.revision)
    await expect(page.getByRole('textbox', { name: 'Phone number', exact: true })).toBeVisible()
    expect((await faults()).credential_waiting).toBe(1)
    await signInOther()
    await waitForAppReady(launched as never, 60_000)
    const switched = await account(page)
    expect(switched.phase).toBe('signed_in')
    expect(switched.account?.id).toBeTruthy()
    expect(switched.account?.id).not.toBe(accountId)
    expect(switched.revision).toBeGreaterThan(signedOut.revision)
    const nextId = switched.account!.id
    const nextBefore = await state(nextId)
    const beforeRelease = await faults()
    expect(beforeRelease.credential_waiting).toBe(1)
    expect(beforeRelease.credential_responses).toBe(held.credential_responses)
    expect(beforeRelease.gate_cancellations).toBe(beforeFaults.gate_cancellations)
    expect(beforeRelease.gate_timeouts).toBe(beforeFaults.gate_timeouts)

    await page.evaluate(() => { (window as unknown as LateLeaseWindow).lateLeaseResponseReleased = true })
    await api.control('faults', JSON.stringify({ hold_credential_response: false }))
    gateReleased = true
    await expect.poll(async () => (await faults()).credential_responses).toBe(beforeFaults.credential_responses + 1)
    const bindingResult = await pendingBinding
    expect(bindingResult).toEqual({ completed: true, ok: false, code: 'auth_attempt_superseded' })
    const rejected = await faults()
    expect(rejected.credential_waiting).toBe(0)
    expect(rejected.gate_cancellations).toBe(beforeFaults.gate_cancellations)
    expect(rejected.gate_timeouts).toBe(beforeFaults.gate_timeouts)
    expect(rejected.inference_requests).toBe(beforeFaults.inference_requests)
    expect(ledger(await state(accountId))).toEqual(ledger(before))
    expect(ledger(await state(nextId))).toEqual(ledger(nextBefore))
    expect(await account(page)).toEqual(switched)
    await assertLateLeaseAlerts(launched)
    const staleAlerts = await page.evaluate(() => (window as unknown as LateLeaseWindow).lateLeaseAlerts)
    expect(staleAlerts.filter(entry => entry.expected).length).toBeLessThanOrEqual(1)

    await page.goto(history.url)
    await expect(page.getByText(`Verified ${api.info.fixture_content}`, { exact: false }).first()).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText(`This chat belongs to the original Aino account ${accountId}. You can read its local history, but cannot send with the current account.`, { exact: true })).toBeVisible()
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0)
    expect(ledger(await state(accountId))).toEqual(ledger(before))
    expect(ledger(await state(nextId))).toEqual(ledger(nextBefore))
    const beforeRecovery = await faults()
    expect(beforeRecovery.inference_requests).toBe(rejected.inference_requests)
    expect(beforeRecovery.credential_requests).toBe(rejected.credential_requests)

    await page.getByRole('button', { name: 'New chat with current account', exact: true }).first().click()
    await page.locator('[data-tour="model-pill"]').first().click()
    await page.getByRole('button', { name: 'Aino models', exact: true }).click()
    await page.getByRole('option', { name: /fixture-tool-model/ }).click()
    await sendPrompt(page, `Read ${api.info.fixture_path} and verify its content.`)
    await expect.poll(async () => (await state(nextId)).usage_calls, { timeout: 60_000 }).toBe(nextBefore.usage_calls + 2)
    await expect(page.getByText(`Verified ${api.info.fixture_content}`, { exact: false }).first()).toBeVisible()
    await expect(page.locator('[contenteditable="true"]').first().locator('xpath=ancestor::form')
      .getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    const recovered = await state(nextId)
    const rows = recovered.usage_ledger.slice(nextBefore.usage_ledger.length)
    expect(rows).toHaveLength(2)
    expect(rows.every(row => String(row.user_id) === nextId && row.desktop_session_id && row.desktop_turn_id)).toBe(true)
    expect(new Set(rows.map(row => row.desktop_turn_id)).size).toBe(1)
    expect(new Set(rows.map(row => row.desktop_session_id)).size).toBe(1)
    expect(rows.reduce((sum, row) => sum + units(row.actual_cost), 0n)).toBe(units(nextBefore.balance) - units(recovered.balance))
    expect(units(recovered.usage_cost) - units(nextBefore.usage_cost)).toBe(units(nextBefore.balance) - units(recovered.balance))
    expect(recovered.credential_requests).toBe(nextBefore.credential_requests + 2)
    expect(recovered.inference_requests).toBe(nextBefore.inference_requests + 2)
    expect(recovered.orders).toBe(nextBefore.orders)
    const nextHistory = await captureIsolationHistory({ launched, api, accountId: nextId })
    expect(nextHistory.runtimeId).not.toBe(history.runtimeId)
    expect(ledger(await state(accountId))).toEqual(ledger(before))
    await assertLateLeaseAlerts(launched)

    return { old_owner: { ...history.owner }, current_owner: { ...nextHistory.owner }, old_runtime_id: history.runtimeId,
      current_runtime_id: nextHistory.runtimeId, signed_out_revision: signedOut.revision,
      switched_revision: switched.revision, late_response_delivered_after_switch: true,
      binding_result: bindingResult, stale_binding_rejected_without_inference: true, explicit_new_chat_recovers: true,
      before: ledger(before), next_before: ledger(nextBefore), recovered: ledger(recovered),
      faults: { before: beforeFaults, held, before_release: beforeRelease, rejected, final: await faults() },
      audit: { expected_stale_alerts: staleAlerts.filter(entry => entry.expected).length, unexpected_alerts: 0 } }
  } finally {
    if (!gateReleased) { await api.control('faults', JSON.stringify({ hold_credential_response: false })) }
  }
}
