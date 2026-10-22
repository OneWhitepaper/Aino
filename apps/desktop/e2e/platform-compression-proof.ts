import { sendPrompt } from './platform-account-edge-proof'
import type { NativeState, startRealPlatformAPI } from './platform-real-api'
import { expect, type Page } from './test'

type API = Awaited<ReturnType<typeof startRealPlatformAPI>>

interface RuntimeBinding {
  runtime_id: string
  model_source: string
  owner: { platform_origin: string; user_id: string }
  status: string
}

interface CompressionRpcResult {
  operation?: string
  message_count?: number
  summary?: { headline?: string; aborted?: boolean; noop?: boolean }
}

export interface CompressionReceipt {
  user_id: string
  billing_session_id: string
  first_turn_id: string
  compression_turn_id: string
  compression_call_ids: string[]
  raw_before_messages: number
  raw_after_messages: number
  before_rendered_user_messages: number
  after_rendered_user_messages: number
  compression_requests: number
  compression_handoff_requests: number
  before: NativeState
  compressed: NativeState
  binding: RuntimeBinding
}

function state(api: API) {
  return api.control<NativeState>('state')
}

function units(value: string): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value)

  if (!match || /[1-9]/.test((match[2] ?? '').slice(8))) {throw new Error(`Invalid fixture currency: ${value}`)}

  return BigInt(match[1]) * 100_000_000n + BigInt((match[2] ?? '').slice(0, 8).padEnd(8, '0'))
}

function settledCost(rows: NativeState['usage_ledger']): bigint {
  return rows.reduce((sum, row) => sum + units(row.actual_cost), 0n)
}

function renderedUserMessageCount(page: Page): Promise<number> {
  return page.locator('[data-slot="aui_thread-viewport"] [data-message-id][data-role="user"]').count()
}

async function selectFixtureModel(page: Page) {
  await page.locator('[data-tour="model-pill"]').first().click()
  await page.getByRole('button', { name: 'Aino models', exact: true }).click()
  await page.getByRole('option', { name: /fixture-tool-model/ }).click()
  await expect(page.locator('[data-tour="model-pill"]').first()).toContainText('fixture-tool-model')
}

async function sendLargePrompt(page: Page, text: string) {
  const composer = page.locator('[contenteditable="true"]').first()
  await composer.click()
  await page.keyboard.insertText(text)
  await page.keyboard.press('Enter')
}

async function waitForToolTurn(page: Page, api: API, before: NativeState) {
  await expect.poll(async () => (await state(api)).usage_calls, { timeout: 90_000 }).toBe(before.usage_calls + 2)
  await expect(page.getByText(`Verified ${api.info.fixture_content}`, { exact: false }).first()).toBeVisible({ timeout: 90_000 })
  await expect(page.locator('[contenteditable="true"]').first().locator('xpath=ancestor::form')
    .getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  const after = await state(api)
  expect(after.tool_results - before.tool_results).toBe(1)

  return after
}

async function runtimeBinding(page: Page): Promise<RuntimeBinding> {
  return page.evaluate(() => new Promise<RuntimeBinding>((resolve, reject) => {
    const target = window as unknown as {
      edgeRuntime?: { socket: WebSocket; id: string }
    }

    const runtime = target.edgeRuntime

    if (!runtime || runtime.socket.readyState !== WebSocket.OPEN) {
      reject(new Error('Original renderer runtime transport unavailable'))

      return
    }

    const id = `compression-readonly-${crypto.randomUUID()}`

    const cleanup = () => { clearTimeout(timer); runtime.socket.removeEventListener('message', receive) }

    const receive = (event: MessageEvent) => {
      if (typeof event.data !== 'string') {return}
      let response: { id?: string; error?: unknown; result?: { session_info?: { model_source?: string; platform_owner?: RuntimeBinding['owner']; model_status?: string } } }

      try { response = JSON.parse(event.data) } catch { return }

      if (response.id !== id) {return}
      cleanup()
      const info = response.result?.session_info

      if (response.error || !info?.platform_owner || !info.model_source) {
        reject(new Error('Owner-checked compression runtime read failed'))

        return
      }

      resolve({ runtime_id: runtime.id, model_source: info.model_source, owner: info.platform_owner, status: info.model_status ?? '' })
    }

    const timer = setTimeout(() => { cleanup(); reject(new Error('Compression runtime observation timed out')) }, 5_000)
    runtime.socket.addEventListener('message', receive)
    runtime.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'model.options', params: {
      session_id: runtime.id, profile: 'default', explicit_only: true, include_session_info: true
    } }))
  }))
}

async function rawMessageCount(page: Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const runtime = (window as unknown as { edgeRuntime?: { socket: WebSocket; id: string } }).edgeRuntime

    if (!runtime || runtime.socket.readyState !== WebSocket.OPEN) {
      reject(new Error('Original renderer runtime transport unavailable'))

      return
    }

    const id = `compression-snapshot-${crypto.randomUUID()}`

    const cleanup = () => { clearTimeout(timer); runtime.socket.removeEventListener('message', receive) }

    const receive = (event: MessageEvent) => {
      if (typeof event.data !== 'string') {return}
      let response: { id?: string; error?: unknown; result?: { message_count?: number } }

      try { response = JSON.parse(event.data) } catch { return }

      if (response.id !== id) {return}
      cleanup()

      if (response.error || typeof response.result?.message_count !== 'number') {
        reject(new Error(`Compression snapshot failed: ${JSON.stringify(response.error ?? response.result)}`))

        return
      }

      resolve(response.result.message_count)
    }

    const timer = setTimeout(() => { cleanup(); reject(new Error('Compression snapshot timed out')) }, 5_000)
    runtime.socket.addEventListener('message', receive)
    runtime.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'session.resume', params: {
      session_id: runtime.id, profile: 'default'
    } }))
  }))
}

async function armCompressionRpcObservation(page: Page) {
  await page.evaluate(() => {
    const target = window as unknown as {
      edgeRuntime?: { socket: WebSocket; id: string }
      compressionRpcId?: string | number
      compressionRpc?: { result?: CompressionRpcResult; error?: unknown }
    }

    const socket = target.edgeRuntime?.socket

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('Original renderer runtime transport unavailable')
    }

    target.compressionRpcId = undefined
    target.compressionRpc = undefined
    const originalSend = socket.send.bind(socket)

    socket.send = data => {
      if (typeof data === 'string') {
        try {
          const request = JSON.parse(data) as { id?: string | number; method?: string; params?: { operation?: string } }

          if ((request.method === 'session.compress' ||
              (request.method === 'session.mutate' && request.params?.operation === 'compress')) && request.id !== undefined) {
            target.compressionRpcId = request.id
          }
        } catch {
          // The production transport owns validation; this observer ignores non-JSON frames.
        }
      }

      originalSend(data)
    }

    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string' || target.compressionRpcId === undefined) {return}

      try {
        const response = JSON.parse(event.data) as { id?: string | number; result?: CompressionRpcResult; error?: unknown }

        if (response.id === target.compressionRpcId) {
          target.compressionRpc = { result: response.result, error: response.error }
        }
      } catch {
        // Ignore unrelated non-JSON frames.
      }
    })
  })
}

async function compressionRpcResult(page: Page): Promise<CompressionRpcResult> {
  await expect.poll(() => page.evaluate(() => (window as unknown as {
    compressionRpc?: { result?: CompressionRpcResult; error?: unknown }
  }).compressionRpc), { timeout: 120_000 }).toBeTruthy()

  return page.evaluate(() => {
    const response = (window as unknown as {
      compressionRpc?: { result?: CompressionRpcResult; error?: unknown }
    }).compressionRpc

    if (response?.error || !response?.result) {
      throw new Error(`session.compress failed: ${JSON.stringify(response?.error ?? null)}`)
    }

    return response.result
  })
}

export async function verifyNativeCompressionBeforeRestart(page: Page, api: API): Promise<CompressionReceipt> {
  await selectFixtureModel(page)
  const before = await state(api)
  const olderContext = 'NATIVE_COMPRESSION_OLDER_CONTEXT preserve this historical detail. '.repeat(400)
  await sendPrompt(page, `Read ${api.info.fixture_path} and verify its content for the first native turn.`)
  const first = await waitForToolTurn(page, api, before)
  const firstRows = first.usage_ledger.slice(before.usage_ledger.length)

  const second = await (async () => {
    await sendLargePrompt(page, `Read ${api.info.fixture_path} and verify its content for the second native turn.\n${olderContext}`)

    return waitForToolTurn(page, api, first)
  })()

  await sendPrompt(page, `Read ${api.info.fixture_path} and verify its content for the third native turn.`)
  await waitForToolTurn(page, api, second)
  await expect.poll(() => renderedUserMessageCount(page), { timeout: 30_000 }).toBe(3)
  const beforeRenderedUserMessages = await renderedUserMessageCount(page)
  const beforeCompression = await state(api)
  const rawBeforeMessages = await rawMessageCount(page)
  await armCompressionRpcObservation(page)
  const composer = page.locator('[contenteditable="true"]').first()
  await composer.click()
  await page.keyboard.insertText('/compress preserve the native tool-turn history')
  await expect(composer).toContainText('preserve the native tool-turn history')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const rpc = await compressionRpcResult(page)
  expect(rpc.operation).toBe('compress')
  expect(rpc.summary?.aborted).not.toBe(true)
  expect(rpc.summary?.noop).not.toBe(true)

  if (typeof rpc.message_count !== 'number') {throw new Error('Compression receipt omitted message_count')}
  const rawAfterMessages = rpc.message_count
  expect(rawBeforeMessages - rawAfterMessages).toBeGreaterThan(0)
  // Desktop keeps the archived segment in visible scrollback after the model history shrinks.
  await expect.poll(() => renderedUserMessageCount(page), { timeout: 30_000 })
    .toBe(beforeRenderedUserMessages)
  await expect(page.getByText('verify its content for the first native turn.', { exact: false }).first()).toBeVisible()
  const afterRenderedUserMessages = await renderedUserMessageCount(page)
  await expect.poll(async () => (await state(api)).compression_requests, { timeout: 60_000 })
    .toBeGreaterThan(beforeCompression.compression_requests)
  await expect.poll(async () => (await state(api)).usage_ledger
    .slice(beforeCompression.usage_ledger.length)
    .filter(row => row.desktop_purpose === 'compression').length, { timeout: 60_000 })
    .toBeGreaterThan(0)
  const compressed = await state(api)

  const compressionRows = compressed.usage_ledger.slice(beforeCompression.usage_ledger.length)
    .filter(row => row.desktop_purpose === 'compression')

  const chatRows = beforeCompression.usage_ledger.slice(before.usage_ledger.length)

  expect(compressionRows.length).toBeGreaterThan(0)
  expect(compressionRows.every(row => row.user_id === compressed.user_id && row.desktop_session_id && row.desktop_turn_id && row.desktop_call_id)).toBe(true)
  expect(new Set(compressionRows.map(row => row.desktop_turn_id)).size).toBe(1)
  expect(new Set(compressionRows.map(row => row.desktop_call_id)).size).toBe(compressionRows.length)
  const billingSessionId = compressionRows[0]!.desktop_session_id
  const firstTurn = firstRows[0]?.desktop_turn_id ?? ''
  expect(billingSessionId).toBeTruthy()
  expect(firstTurn).toBeTruthy()
  expect(firstRows).toHaveLength(2)
  expect(firstRows.every(row => row.desktop_session_id === billingSessionId && row.desktop_turn_id === firstTurn)).toBe(true)
  expect(chatRows.every(row => row.user_id === compressed.user_id && row.desktop_session_id === billingSessionId && row.desktop_purpose === 'chat')).toBe(true)
  expect(compressionRows.every(row => row.desktop_session_id === billingSessionId)).toBe(true)
  expect(compressionRows[0]!.desktop_turn_id).not.toBe(firstTurn)
  expect(chatRows.some(row => row.desktop_turn_id === compressionRows[0]!.desktop_turn_id)).toBe(false)
  const chatCallIds = new Set(chatRows.map(row => row.desktop_call_id))
  expect(compressionRows.every(row => !chatCallIds.has(row.desktop_call_id))).toBe(true)
  const settled = compressed.usage_ledger.slice(before.usage_ledger.length)
  expect(units(before.balance) - units(compressed.balance)).toBe(settledCost(settled))
  expect(settledCost(settled)).toBe(units(compressed.usage_cost) - units(before.usage_cost))
  const binding = await runtimeBinding(page)
  expect(binding.model_source).toBe('aino')
  expect(binding.owner.platform_origin).toBe(api.info.origin)
  expect(binding.owner.user_id).toBe(String(compressed.user_id))

  return {
    user_id: String(compressed.user_id), billing_session_id: billingSessionId, first_turn_id: firstTurn,
    compression_turn_id: compressionRows[0]!.desktop_turn_id,
    compression_call_ids: compressionRows.map(row => row.desktop_call_id!),
    raw_before_messages: rawBeforeMessages, raw_after_messages: rawAfterMessages,
    before_rendered_user_messages: beforeRenderedUserMessages,
    after_rendered_user_messages: afterRenderedUserMessages, compression_requests: compressed.compression_requests,
    compression_handoff_requests: compressed.compression_handoff_requests, before, compressed, binding
  }
}

export async function verifyNativeCompressionAfterRestart(page: Page, api: API, receipt: CompressionReceipt) {
  await expect(page.locator('[contenteditable="true"]').first()).toBeVisible({ timeout: 90_000 })
  await expect.poll(() => renderedUserMessageCount(page), { timeout: 90_000 })
    .toBeGreaterThan(0)
  await expect(page.getByText('verify its content for the third native turn.', { exact: false }).first()).toBeVisible()
  const before = await state(api)
  await sendPrompt(page, `Read ${api.info.fixture_path} and verify its content after native compression resume.`)
  await expect.poll(async () => (await state(api)).usage_calls, { timeout: 90_000 }).toBe(before.usage_calls + 2)
  await expect(page.getByText(`Verified ${api.info.fixture_content}`, { exact: false }).last()).toBeVisible({ timeout: 90_000 })
  const after = await state(api)
  const rows = after.usage_ledger.slice(before.usage_ledger.length)
  expect(rows).toHaveLength(2)
  expect(rows.every(row => row.user_id === Number(receipt.user_id) && (row.api_key_id ?? 0) > 0)).toBe(true)
  expect(rows.every(row => row.desktop_purpose === 'chat' && row.desktop_session_id === receipt.billing_session_id)).toBe(true)
  expect(rows.every(row => Boolean(row.desktop_turn_id) && Boolean(row.desktop_call_id))).toBe(true)
  expect(new Set(rows.map(row => row.desktop_turn_id)).size).toBe(1)
  expect(new Set(rows.map(row => row.desktop_call_id)).size).toBe(2)
  const priorTurnIds = new Set(receipt.compressed.usage_ledger.map(row => row.desktop_turn_id))
  const priorCallIds = new Set(receipt.compressed.usage_ledger.map(row => row.desktop_call_id))
  expect(rows.every(row => !priorTurnIds.has(row.desktop_turn_id))).toBe(true)
  expect(rows.every(row => !priorCallIds.has(row.desktop_call_id))).toBe(true)
  expect(after.compression_handoff_requests).toBeGreaterThan(receipt.compression_handoff_requests)
  expect(units(before.balance) - units(after.balance)).toBe(settledCost(rows))
  const allRows = after.usage_ledger.slice(receipt.before.usage_ledger.length)
  expect(units(receipt.before.balance) - units(after.balance)).toBe(settledCost(allRows))
  expect(settledCost(allRows)).toBe(units(after.usage_cost) - units(receipt.before.usage_cost))
  const binding = await runtimeBinding(page)
  expect(binding.model_source).toBe(receipt.binding.model_source)
  expect(binding.owner).toEqual(receipt.binding.owner)
  expect(binding.runtime_id).toBe(receipt.binding.runtime_id)

  return { after, rows, binding }
}
