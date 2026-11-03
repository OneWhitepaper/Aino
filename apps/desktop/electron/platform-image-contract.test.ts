import http from 'node:http'

import { afterEach, expect, it } from 'vitest'

import { createPlatformClient } from '../shared/platform-client'
import { parsePlatformModel } from '../shared/platform-model-contract'

const servers: http.Server[] = []

it('preserves declared image quality choices and rejects invalid or text-only declarations', () => {
  const image = catalogModel(true)
  const valid = { ...image, capabilities: { ...image.capabilities, image_quality_options: ['auto', 'high'] } }
  expect(parsePlatformModel(valid).capabilities).toMatchObject({ image_quality_options: ['auto', 'high'] })

  for (const options of [['high', 'high'], ['ultra'], 'high']) {
    expect(() =>
      parsePlatformModel({ ...valid, capabilities: { ...valid.capabilities, image_quality_options: options } })
    ).toThrow()
  }

  const chat = catalogModel(false)
  expect(() =>
    parsePlatformModel({ ...chat, capabilities: { ...chat.capabilities, image_quality_options: ['high'] } })
  ).toThrow()
})
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.closeAllConnections()
          server.close(() => resolve())
        })
    )
  )
})

function catalogModel(image: boolean) {
  return {
    id: image ? 'image-model' : 'chat-model',
    model: image ? 'image-wire' : 'chat-wire',
    display_name: 'Fixture',
    provider_label: 'Fixture',
    api_mode: image ? 'images_generations' : 'chat_completions',
    ...(image ? { purpose: 'image' } : {}),
    state: 'available',
    reason_code: null,
    is_default: true,
    context_window: null,
    max_output_tokens: null,
    capabilities: { tools: !image, vision: false, reasoning: false, ...(image ? { image_generation: true } : {}) },
    billing_source: 'balance',
    pricing: {
      currency: 'USD',
      unit: image ? 'per_image' : 'per_million_tokens',
      input: null,
      output: '0.10',
      cache_read: null,
      cache_write: null,
      effective_user_rate: '1',
      detail_available: true,
      tiers: [],
      time_pricing: null,
      group_peak: null
    }
  }
}

async function serve(
  reply: (request: http.IncomingMessage, input: Record<string, unknown>, origin: string) => unknown
) {
  const server = http.createServer(async (request, response) => {
    let body = ''

    for await (const chunk of request) {
      body += chunk
    }

    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ code: 0, message: 'ok', data: reply(request, body ? JSON.parse(body) : {}, origin) }))
  })

  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`

  return createPlatformClient({ origin, allowInsecureLoopback: true })
}

it('returns a mixed public catalog with legacy chat and explicit image purpose but no secret fields', async () => {
  const client = await serve(() => [
    catalogModel(false),
    { ...catalogModel(true), api_key: 'must-not-render', internal: { secret: 'x' } }
  ])

  const models = await client.models('access')
  expect(models).toHaveLength(2)
  expect(models[0]).toMatchObject({ purpose: 'chat', capabilities: { image_generation: false, tools: true } })
  expect(models[1]).toMatchObject({
    purpose: 'image',
    api_mode: 'images_generations',
    capabilities: { image_generation: true, tools: false }
  })
  expect(JSON.stringify(models)).not.toContain('must-not-render')
  expect(models[1]).not.toHaveProperty('internal')
})

it('opts into image models while the unversioned catalog remains chat-only for older desktops', async () => {
  const requests: string[] = []
  let serviceOrigin = ''

  const client = await serve((request, _input, origin) => {
    serviceOrigin = origin
    const url = new URL(request.url!, origin)
    requests.push(url.pathname + url.search)

    return url.searchParams.get('include_images') === 'true'
      ? [catalogModel(false), catalogModel(true)]
      : [catalogModel(false)]
  })

  const models = await client.models('access')
  expect(models.map(model => model.purpose)).toEqual(['chat', 'image'])

  const legacy = await fetch(`${serviceOrigin}/api/v1/desktop/models`, {
    headers: { authorization: 'Bearer access' }
  }).then(response => response.json())

  expect(legacy.data.map((model: { api_mode: string }) => model.api_mode)).toEqual(['chat_completions'])
  expect(requests).toEqual(['/api/v1/desktop/models?include_images=true', '/api/v1/desktop/models'])
})

it('keeps chat models working when an older API ignores the image opt-in query', async () => {
  let path = ''

  const client = await serve(request => {
    path = request.url!

    return [catalogModel(false)]
  })

  expect(await client.models('access')).toMatchObject([{ id: 'chat-model', purpose: 'chat' }])
  expect(path).toBe('/api/v1/desktop/models?include_images=true')
})

it.each(['image', 'chat', 'missing', 'wrong_model'])(
  'an image lease validates returned %s purpose and does not require chat tools',
  async returned => {
    let sent: Record<string, unknown> | undefined

    const client = await serve((_request, input, origin) => {
      sent = input

      return {
        credential_id: 'lease',
        api_key: 'main-only-image-secret',
        base_url: `${origin}/v1`,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        model: catalogModel(returned !== 'wrong_model'),
        ...(returned === 'missing' ? {} : { purpose: returned === 'image' ? 'image' : 'chat' })
      }
    })

    const input = {
      model_id: 'image-model',
      device_id: 'device',
      connection_grant_id: 'grant',
      purpose: 'image' as const
    }

    if (returned === 'image') {
      expect(await client.modelLease('access', input)).toMatchObject({
        purpose: 'image',
        api_key: 'main-only-image-secret',
        model: { id: 'image-model' }
      })
    } else {
      await expect(client.modelLease('access', input)).rejects.toMatchObject({ code: 'invalid_response' })
    }

    expect(sent).toEqual(input)
  }
)

it('a default chat lease refuses an image credential even when the caller knows its model id', async () => {
  const client = await serve((_request, _input, origin) => ({
    credential_id: 'lease',
    api_key: 'image-secret',
    base_url: `${origin}/v1`,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    purpose: 'image',
    model: catalogModel(true)
  }))

  await expect(
    client.modelLease('access', { model_id: 'image-model', device_id: 'device', connection_grant_id: 'grant' })
  ).rejects.toMatchObject({ code: 'invalid_response' })
})

it.each(['missing_purpose', 'wrong_mode', 'false_capability', 'wrong_purpose'])(
  'refuses inconsistent image model %s',
  change => {
    const model = catalogModel(true)

    if (change === 'missing_purpose') {
      delete model.purpose
    } else if (change === 'wrong_mode') {
      model.api_mode = 'responses'
    } else if (change === 'false_capability') {
      model.capabilities.image_generation = false
    } else {
      model.purpose = 'chat'
    }

    expect(() => parsePlatformModel(model)).toThrow('invalid_response')
  }
)
