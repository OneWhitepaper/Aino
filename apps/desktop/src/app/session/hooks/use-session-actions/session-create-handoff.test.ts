import { describe, expect, it, vi } from 'vitest'

import { createGatewaySession } from './session-create-request'

const handoff = { source_session_id: 'source', summary: 'Implement the plan', files: ['src/app.ts'] }
const params = { request_id: 'review-1', source: 'desktop', execution_mode: 'code', handoff }

const created = {
  session_id: 'child',
  stored_session_id: 'child',
  message_count: 0,
  messages: [],
  info: { execution_mode: 'code', handoff }
}

describe('reviewed handoff creation', () => {
  it('reports unsupported capability when an older gateway has no runtime.describe method', async () => {
    const request = vi.fn(async () => {
      throw Object.assign(new Error('Method not found'), { code: -32601 })
    })

    await expect(createGatewaySession(null, params, request)).rejects.toThrow(/does not support Work\/Code handoffs/)
    expect(request.mock.calls).toEqual([['runtime.describe', {}]])
  })

  it('refuses an older gateway before creating any session', async () => {
    const request = vi.fn(async () => ({ capabilities: [], ...created }))

    await expect(createGatewaySession(null, params, request as never)).rejects.toThrow()
    expect(request.mock.calls).toEqual([['runtime.describe', {}]])
  })

  it('negotiates capability and sends the reviewed contract unchanged', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'runtime.describe' ? { capabilities: ['work-code-handoff-v1'] } : created
    )

    await expect(createGatewaySession(null, params, request as never)).resolves.toEqual(created)
    expect(request.mock.calls).toEqual([
      ['runtime.describe', {}],
      ['session.create', params]
    ])
  })

  it.each([
    { ...created.info, handoff: undefined },
    { ...created.info, handoff: { ...handoff, source_session_id: 'another' } },
    { ...created.info, handoff: { ...handoff, files: [] } },
    { ...created.info, execution_mode: 'work' }
  ])('rejects unproven returned handoff provenance', async info => {
    const request = vi.fn(async (method: string) =>
      method === 'runtime.describe' ? { capabilities: ['work-code-handoff-v1'] } : { ...created, info }
    )

    await expect(createGatewaySession(null, params, request as never)).rejects.toThrow()
    expect(request.mock.calls.map(([method]) => method)).toEqual(['runtime.describe', 'session.create'])
  })

  it('never drops unsupported fields to retry a handoff as ordinary creation', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'runtime.describe') {
        return { capabilities: ['work-code-handoff-v1'] }
      }

      throw new Error('invalid params for session.create: cwd_explicit: Extra inputs are not permitted')
    })

    await expect(createGatewaySession(null, { ...params, cwd_explicit: true }, request as never)).rejects.toThrow()
    expect(request.mock.calls.map(([method]) => method)).toEqual(['runtime.describe', 'session.create'])
  })
})
