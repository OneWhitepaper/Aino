import { account, sendPrompt } from './platform-account-edge-proof'
import { nativeBindingObservations } from './platform-account-window'
import type { launchGuardedDesktop, NativeState, startRealPlatformAPI } from './platform-real-api'
import { expect, type Page } from './test'

type Launch = Awaited<ReturnType<typeof launchGuardedDesktop>>
type API = Awaited<ReturnType<typeof startRealPlatformAPI>>

export interface IsolationParticipant {
  launched: Launch
  api: API
  accountId: string
}

interface Owner { platform_origin: string; user_id: string }
interface UsageRow {
  user_id: number
  api_key_id: number
  desktop_session_id: string
  desktop_turn_id: string
  actual_cost: string
}
interface IsolationState extends NativeState {
  usage_ledger: UsageRow[]
  credential_requests: number
  credential_successes: number
  inference_requests: number
  inference_responses: number
}
interface Faults { inference_waiting: number; gate_timeouts: number; credential_waiting: number }
interface ObservedWindow {
  hermesDesktop: {
    platformModels: { owner(revision: number): Promise<Owner> }
    api<T>(request: { path: string }): Promise<T>
  }
  edgeRuntime?: { socket: WebSocket; id: string }
  isolationAlerts: Array<{ message: string; expected: boolean }>
  isolationExpectedErrors: string[]
}

export interface IsolationHistory {
  url: string
  owner: Owner
  revision: number
  runtimeId: string
  storedSessionId: string
  bindingEvidence: Awaited<ReturnType<typeof nativeBindingObservations>>
  fixtureContent: string
  state: IsolationState
}

export async function observeIsolationAlerts(launched: Launch) {
  const observe = () => {
    const target = window as unknown as ObservedWindow
    target.isolationAlerts = []
    target.isolationExpectedErrors = []

    const scan = () => {
      for (const alert of document.querySelectorAll('[role="alert"]')) {
        const text = alert.textContent?.trim() ?? ''

        if (!text) { continue }
        const message = alert.querySelector(':scope > div:first-child > div > .min-w-0')?.textContent?.trim()
        const expected = Boolean(message && target.isolationExpectedErrors.includes(message))

        if (!target.isolationAlerts.some(item => item.message === text && item.expected === expected)) {
          target.isolationAlerts.push({ message: text, expected })
        }
      }
    }

    const start = () => {
      scan()
      new MutationObserver(scan).observe(document.body, { childList: true, subtree: true, characterData: true })
    }

    if (document.body) { start() } else { document.addEventListener('DOMContentLoaded', start, { once: true }) }
  }

  await launched.app.context().addInitScript(observe)
  await launched.page.evaluate(observe)
}

export async function assertIsolationAlerts(launched: Launch) {
  for (const page of launched.app.windows()) {
    const alerts = await page.evaluate(() => (window as unknown as ObservedWindow).isolationAlerts)
    expect(Array.isArray(alerts)).toBe(true)
    expect(alerts.filter(item => !item.expected), 'unexpected native isolation alerts').toEqual([])
  }
}

function state({ api, accountId }: IsolationParticipant) {
  return api.control<IsolationState>(`state?user_id=${encodeURIComponent(accountId)}`)
}

function ledger(value: IsolationState) {
  return { balance: value.balance, usage_cost: value.usage_cost, usage_calls: value.usage_calls,
    usage_turns: value.usage_turns, usage_ledger: value.usage_ledger, orders: value.orders }
}

function units(value: string) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value)

  if (!match || /[1-9]/.test((match[2] ?? '').slice(8))) { throw new Error('Invalid fixture currency') }

  return BigInt(match[1]) * 100_000_000n + BigInt((match[2] ?? '').slice(0, 8).padEnd(8, '0'))
}

async function runtime(page: Page) {
  return page.evaluate(() => new Promise<{ id: string; owner: Owner; status: string }>((resolve, reject) => {
    const retained = (window as unknown as ObservedWindow).edgeRuntime

    if (!retained || retained.socket.readyState !== WebSocket.OPEN) {
      reject(new Error('Original renderer runtime transport unavailable'))

      return
    }

    const id = `isolation-readonly-${crypto.randomUUID()}`

    const cleanup = () => { clearTimeout(timer); retained.socket.removeEventListener('message', receive) }

    const receive = (event: MessageEvent) => {
      if (typeof event.data !== 'string') { return }
      let result: { id?: string; error?: unknown; result?: { session_info?: { platform_owner?: Owner; model_status?: string } } }

      try { result = JSON.parse(event.data) } catch { return }

      if (result.id !== id) { return }
      cleanup()
      const info = result.result?.session_info

      if (result.error || !info?.platform_owner) { reject(new Error('Owner-checked runtime read failed'));

 return }

      resolve({ id: retained.id, owner: info.platform_owner, status: info.model_status ?? '' })
    }

    const timer = setTimeout(() => { cleanup(); reject(new Error('Runtime observation timed out')) }, 5_000)
    retained.socket.addEventListener('message', receive)
    retained.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'model.options', params: {
      session_id: retained.id, profile: 'default', explicit_only: true, include_session_info: true
    } }))
  }))
}

async function publicOwner(participant: IsolationParticipant) {
  const snapshot = await account(participant.launched.page)
  expect(snapshot.phase).toBe('signed_in')
  expect(snapshot.account?.id).toBe(participant.accountId)

  const owner = await participant.launched.page.evaluate(revision =>
    (window as unknown as ObservedWindow).hermesDesktop.platformModels.owner(revision), snapshot.revision)

  expect(owner).toEqual({ platform_origin: participant.api.info.origin, user_id: participant.accountId })

  return { owner, revision: snapshot.revision }
}

async function selectAndSend(participant: IsolationParticipant) {
  const { page } = participant.launched
  await page.locator('[data-tour="model-pill"]').first().click()
  await page.getByRole('menuitem', { name: /fixture-tool-model/ }).click()
  await sendPrompt(page, `Read ${participant.api.info.fixture_path} and verify its content.`)

  return performance.now()
}

async function settledFreshDraft(participant: IsolationParticipant, before: IsolationState) {
  await expect.poll(async () => (await state(participant)).usage_calls, { timeout: 60_000 }).toBe(before.usage_calls + 2)
  const { page } = participant.launched
  await expect(page.getByText(`Verified ${participant.api.info.fixture_content}`, { exact: false }).first()).toBeVisible()
  await expect(page.locator('[contenteditable="true"]').first().locator('xpath=ancestor::form')
    .getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  const after = await state(participant)
  const rows = after.usage_ledger.slice(before.usage_ledger.length)
  expect(rows).toHaveLength(2)
  expect(rows.every(row => String(row.user_id) === participant.accountId && row.api_key_id > 0)).toBe(true)
  expect(new Set(rows.map(row => row.desktop_session_id)).size).toBe(1)
  expect(new Set(rows.map(row => row.desktop_turn_id)).size).toBe(1)
  expect(rows.every(row => row.desktop_session_id.length > 0 && row.desktop_turn_id.length > 0)).toBe(true)
  expect(units(before.balance) - units(after.balance)).toBe(units(after.usage_cost) - units(before.usage_cost))
  expect(rows.reduce((sum, row) => sum + units(row.actual_cost), 0n)).toBe(units(before.balance) - units(after.balance))
  // Both draft and prompt still claim the session. The existing live-lease
  // cache (95329aa3e7) reuses the first lease for that second binding.
  await assertFreshLeaseBinding(participant)
  expect(after.credential_requests - before.credential_requests).toBe(1)
  expect(after.credential_successes - before.credential_successes).toBe(1)
  expect(after.inference_requests).toBe(before.inference_requests + 2)
  expect(after.orders).toBe(before.orders)

  return after
}

export async function assertFreshLeaseBinding(participant: IsolationParticipant) {
  const observed = await runtime(participant.launched.page)

  const bindings = (await nativeBindingObservations(participant.launched.app))
    .filter(entry => entry.sessionId === observed.id)

  // Ticket negotiation may precede the two authorized bindings. It must not
  // obtain another lease or obscure a different native binding failure.
  expect(bindings.every(entry => entry.completed)).toBe(true)
  expect(bindings.filter(entry => !entry.ok).every(entry => entry.code === 'binding_ticket_required')).toBe(true)
  const successful = bindings.filter(entry => entry.ok)
  expect(successful.length).toBeGreaterThanOrEqual(2)
  expect(successful.every(entry => entry.code === null && typeof entry.expiresAt === 'string')).toBe(true)
  expect(new Set(bindings.map(entry => entry.revision)).size).toBe(1)
  expect(Date.parse(successful[0].expiresAt!)).toBeGreaterThan(Date.now())
  expect(new Set(successful.map(entry => entry.expiresAt)).size).toBe(1)

  return bindings
}

export async function captureIsolationHistory(participant: IsolationParticipant): Promise<IsolationHistory> {
  const identity = await publicOwner(participant)
  const observed = await runtime(participant.launched.page)
  expect(observed.owner).toEqual(identity.owner)
  expect(observed.status).toBe('ready')

  const url = participant.launched.page.url()
  const storedSessionId = decodeURIComponent(new URL(url).hash.slice(1).split('?')[0].replace(/^\//, ''))
  expect(storedSessionId).not.toBe('')

  const detail = await participant.launched.page.evaluate(id =>
    (window as unknown as ObservedWindow).hermesDesktop.api<{ id: string }>({
      path: `/api/sessions/${encodeURIComponent(id)}?profile=default`
    }), storedSessionId)

  expect(detail.id).toBe(storedSessionId)

  const bindingEvidence = (await nativeBindingObservations(participant.launched.app)).filter(entry => entry.sessionId === observed.id)

  return { url, ...identity, runtimeId: observed.id, storedSessionId, bindingEvidence,
    fixtureContent: participant.api.info.fixture_content, state: await state(participant) }
}

/** A stale link or known ID cannot bypass the account's physical history root. */
export async function historyUnavailable(page: Page, history: IsolationHistory) {
  const proof = await page.evaluate(async id => {
    const api = (window as unknown as ObservedWindow).hermesDesktop.api
    const listed = await api<{ sessions: Array<{ id: string }> }>({ path: '/api/sessions?profile=default&limit=100' })

    const search = await api<{ results: Array<{ session_id: string }> }>({
      path: `/api/sessions/search?profile=default&q=${encodeURIComponent(id)}`
    })

    const reads = []

    for (const suffix of ['', '/messages']) {
      try {
        const data = await api({ path: `/api/sessions/${encodeURIComponent(id)}${suffix}?profile=default` })
        reads.push({ suffix, data })
      } catch (error) {
        reads.push({ suffix, rejected: String(error) })
      }
    }

    return { listed: listed.sessions.map(row => row.id), search: search.results.map(row => row.session_id), reads }
  }, history.storedSessionId)

  expect(proof.listed).not.toContain(history.storedSessionId)
  expect(proof.search).toEqual([])

  for (const read of proof.reads) {
    expect(read).toEqual({ suffix: read.suffix, rejected: expect.stringMatching(/404/) })
  }

  return proof
}

export async function verifyConcurrentIsolation(left: IsolationParticipant, right: IsolationParticipant) {
  const sameSite = left.api.info.origin === right.api.info.origin

  if (sameSite) { expect(left.accountId).not.toBe(right.accountId) }
  else { expect(left.accountId).toBe(right.accountId) }

  await Promise.all([publicOwner(left), publicOwner(right)])
  const before = await Promise.all([state(left), state(right)])
  const apis = sameSite ? [left.api] : [left.api, right.api]

  for (const api of apis) { await api.control('faults', JSON.stringify({ hold_inference_before_auth: true })) }

  try {
    const submittedAt = await Promise.all([selectAndSend(left), selectAndSend(right)])

    // Enter can complete while the newly bound sessions are still building their agents.
    await expect.poll(async () => Promise.all(apis.map(async api => {
      const { inference_waiting, gate_timeouts } = await api.control<Faults>('faults')

      return { inference_waiting, gate_timeouts }
    })), { timeout: 30_000 }).toEqual(apis.map(() => ({ inference_waiting: sameSite ? 2 : 1, gate_timeouts: 0 })))
    const gateObservedAt = performance.now()

    expect(ledger(await state(left))).toEqual(ledger(before[0]))
    expect(ledger(await state(right))).toEqual(ledger(before[1]))
    await left.api.control('faults', JSON.stringify({ hold_inference_before_auth: false }))
    const leftAfter = await settledFreshDraft(left, before[0])
    let rightHeld: IsolationState | null = null

    if (!sameSite) {
      rightHeld = await state(right)
      expect(ledger(rightHeld)).toEqual(ledger(before[1]))
      expect((await right.api.control<Faults>('faults')).inference_waiting).toBe(1)
      await right.api.control('faults', JSON.stringify({ hold_inference_before_auth: false }))
    }

    const rightAfter = await settledFreshDraft(right, before[1])
    const histories = await Promise.all([captureIsolationHistory(left), captureIsolationHistory(right)])
    expect(histories[0].runtimeId).not.toBe(histories[1].runtimeId)
    const leftTurns = new Set(leftAfter.usage_ledger.map(row => row.desktop_turn_id))
    expect(rightAfter.usage_ledger.every(row => !leftTurns.has(row.desktop_turn_id))).toBe(true)
    const leftSessions = new Set(leftAfter.usage_ledger.map(row => row.desktop_session_id))
    expect(rightAfter.usage_ledger.every(row => !leftSessions.has(row.desktop_session_id))).toBe(true)

    if (sameSite) {
      const leftKeys = new Set(leftAfter.usage_ledger.map(row => row.api_key_id))

      expect(rightAfter.usage_ledger.every(row => !leftKeys.has(row.api_key_id))).toBe(true)
    }

    for (const api of apis) { expect((await api.control<Faults>('faults')).gate_timeouts).toBe(0) }

    return { same_site: sameSite, overlap_observed: true, selective_release: !sameSite,
      submit_to_gate_ms: submittedAt.map(start => Math.round(gateObservedAt - start)),
      before, after: [leftAfter, rightAfter], right_while_left_settled: rightHeld, histories }
  } finally {
    for (const api of apis) { await api.control('faults', JSON.stringify({ hold_inference_before_auth: false })) }
  }
}

export async function verifyRetainedHistoryIsolation(
  current: IsolationParticipant,
  prior: IsolationHistory,
  priorAPI: API,
  restorePrior: () => Promise<IsolationParticipant>
) {
  const identity = await publicOwner(current)
  expect(identity.owner).not.toEqual(prior.owner)
  const priorParticipant = { ...current, api: priorAPI, accountId: prior.owner.user_id }
  const before = await Promise.all([state(priorParticipant), state(current)])
  await assertIsolationAlerts(current.launched)
  await current.launched.page.goto(prior.url)
  const { page } = current.launched
  await expect(page.locator('[contenteditable="true"]').first()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(`Verified ${prior.fixtureContent}`, { exact: false })).toHaveCount(0)
  const unavailable = await historyUnavailable(page, prior)
  const denied = await Promise.all([state(priorParticipant), state(current)])

  for (const index of [0, 1]) {
    expect(ledger(denied[index])).toEqual(ledger(before[index]))
    expect(denied[index].credential_requests).toBe(before[index].credential_requests)
    expect(denied[index].inference_requests).toBe(before[index].inference_requests)
  }

  await page.evaluate(() => { window.location.hash = '/' })
  await selectAndSend(current)
  const recovered = await settledFreshDraft(current, denied[1])
  const history = await captureIsolationHistory(current)
  expect(history.owner).toEqual(identity.owner)
  expect(history.runtimeId).not.toBe(prior.runtimeId)
  expect(ledger(await state(priorParticipant))).toEqual(ledger(before[0]))

  const restored = await restorePrior()
  expect((await publicOwner(restored)).owner).toEqual(prior.owner)
  await restored.launched.page.goto(prior.url)
  await expect(restored.launched.page.getByText(`Verified ${prior.fixtureContent}`, { exact: false }).first()).toBeVisible({ timeout: 60_000 })

  const restoredMessages = await restored.launched.page.evaluate(id =>
    (window as unknown as ObservedWindow).hermesDesktop.api<{ session_id: string; messages: unknown[] }>({
      path: `/api/sessions/${encodeURIComponent(id)}/messages?profile=default`
    }), prior.storedSessionId)

  expect(restoredMessages.session_id).toBe(prior.storedSessionId)
  expect(JSON.stringify(restoredMessages.messages)).toContain(prior.fixtureContent)
  const reverseUnavailable = await historyUnavailable(restored.launched.page, history)
  expect(ledger(await state(restored))).toEqual(ledger(before[0]))
  expect(ledger(await state(current))).toEqual(ledger(recovered))
  await assertIsolationAlerts(restored.launched)

  return { old_owner: prior.owner, current_owner: identity.owner, history_visible: false,
    rejected_before_credentials_and_inference: true, explicit_new_chat_recovers: true,
    original_account_history_restored: true, unavailable, reverseUnavailable, before, denied, recovered, history }
}
