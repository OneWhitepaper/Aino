import { afterEach, expect, it, vi } from 'vitest'

import { setApiRequestConnection, setApiRequestProfile } from './client'
import { setMcpServerEnabled } from './mcp'

afterEach(() => {
  setApiRequestConnection(null)
  setApiRequestProfile(null)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('pins explicit MCP writes while preserving ambient behavior for legacy callers', async () => {
  const api = vi.fn().mockResolvedValue({ ok: true })
  vi.stubGlobal('hermesDesktop', { api })
  setApiRequestConnection('ambient-host')
  setApiRequestProfile('ambient-profile')
  await setMcpServerEnabled('files', true, { connectionId: 'owner-host', profile: 'owner-profile' })
  expect(api).toHaveBeenLastCalledWith(
    expect.objectContaining({
      connectionId: 'owner-host',
      profile: 'owner-profile',
      method: 'PUT',
      body: { enabled: true }
    })
  )
  await setMcpServerEnabled('files', false)
  expect(api).toHaveBeenLastCalledWith(
    expect.objectContaining({ connectionId: 'ambient-host', profile: 'ambient-profile', body: { enabled: false } })
  )
})
