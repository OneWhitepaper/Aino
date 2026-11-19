import { expect, it } from 'vitest'

import { CanonicalDesktopProtocol } from './canonical-protocol'

it('retains reviewed handoff and its request identity through canonical creation', () => {
  const protocol = new CanonicalDesktopProtocol()
  const handoff = { source_session_id: 'source', summary: 'Implement the reviewed plan', files: ['src/app.ts'] }
  const input = { source: 'desktop', profile: 'named', execution_mode: 'code', request_id: 'review-1', handoff }

  const request = protocol.prepare('session.create', input)
  expect(request).toMatchObject({ ...input, source: 'gui' })
  expect(request).not.toHaveProperty('title')
  expect(protocol.prepare('session.create', input)).toEqual(request)
})
