import { expect, it } from 'vitest'

import { applyOperationStatus, normalizeConnectionRequest, parseConnectionTarget } from './connection-request'

it('keeps the reviewed MCP source through connection request normalization', () => {
  const config = { url: 'https://example.test/mcp', auth: 'oauth' as const, timeout: 1200, env_keys: ['EXAMPLE_KEY'] }

  const target = {
    name: 'example',
    kind: 'mcp' as const,
    action: 'install' as const,
    state: 'pending' as const,
    mcp_config: config
  }

  expect(parseConnectionTarget(target)?.mcpConfig).toEqual(config)

  const request = normalizeConnectionRequest(
    {
      op_id: 'custom-mcp',
      tool_call_id: 'call-custom',
      seq: 1,
      deadline_at: 1800000000,
      timeout_seconds: 300,
      targets: [target]
    },
    'session'
  )

  expect(request?.targets[0].mcpConfig).toEqual(config)
  expect(request).not.toBeNull()

  const live = applyOperationStatus(request!, {
    op_id: 'custom-mcp',
    seq: 2,
    deadline_at: 1800000000,
    settled: false,
    settled_by: null,
    targets: [{ name: 'example', kind: 'mcp', action: 'install', state: 'initiated' }]
  })

  expect(live.targets[0].mcpConfig).toEqual(config)
  expect(live.targets[0].state).toBe('initiated')
})
