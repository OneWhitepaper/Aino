import { afterEach, expect, it, vi } from 'vitest'

import * as router from './session-request-router'
import { sendSubagentControl } from './subagent-control'
import { $subagentsBySession, reconcileSubagentSnapshot } from './subagents'

const owner = { connectionId: 'child-owner', profile: 'research' }

afterEach(() => {
  $subagentsBySession.set({})
  vi.restoreAllMocks()
})

it('does not treat a visible child from a previous parent generation as controllable', async () => {
  reconcileSubagentSnapshot('parent', [
    { subagent_id: 'child', status: 'running', can_control: false, accepting_steer: true }
  ])
  const request = vi.spyOn(router, 'requestForSessionProfile')
  await expect(sendSubagentControl(owner, 'parent', 'child', 'steer', 'Do this')).rejects.toMatchObject({
    code: 'control-unavailable'
  })
  await expect(sendSubagentControl(owner, 'parent', 'child', 'interrupt')).rejects.toMatchObject({
    code: 'control-unavailable'
  })
  expect(request).not.toHaveBeenCalled()
})

it('allows stop during the final steer drain while refusing instructions that cannot be delivered', async () => {
  reconcileSubagentSnapshot('parent', [
    { subagent_id: 'child', status: 'running', can_control: true, accepting_steer: false }
  ])
  const request = vi.spyOn(router, 'requestForSessionProfile').mockResolvedValue({ found: true })
  await expect(sendSubagentControl(owner, 'parent', 'child', 'steer', 'Too late')).rejects.toMatchObject({
    code: 'not-running'
  })
  expect(request).not.toHaveBeenCalled()
  await sendSubagentControl(owner, 'parent', 'child', 'interrupt')
  expect(request).toHaveBeenCalledWith(owner, expect.any(Function), 'subagent.interrupt', {
    session_id: 'parent',
    subagent_id: 'child'
  })
})

it.each([
  { rows: [], code: 'not-running' },
  { rows: [{ subagent_id: 'child', status: 'running', can_control: false }], code: 'control-unavailable' }
])('refreshes a rejected action on its exact owner and explains $code', async ({ rows, code }) => {
  reconcileSubagentSnapshot('parent', [{ subagent_id: 'child', status: 'running', can_control: true }])

  const request = vi
    .spyOn(router, 'requestForSessionProfile')
    .mockResolvedValueOnce({ status: 'rejected' })
    .mockResolvedValueOnce({ subagents: rows })

  await expect(sendSubagentControl(owner, 'parent', 'child', 'steer', 'Keep this')).rejects.toMatchObject({ code })
  expect(request).toHaveBeenLastCalledWith(owner, expect.any(Function), 'subagent.list', { session_id: 'parent' })

  if (rows.length) {
    expect($subagentsBySession.get().parent?.[0]).toMatchObject({ canControl: false, status: 'running' })
  } else {
    expect($subagentsBySession.get().parent).toEqual([])
  }
})

it('keeps the running child when the connection fails instead of pretending it stopped', async () => {
  reconcileSubagentSnapshot('parent', [{ subagent_id: 'child', status: 'running', can_control: true }])
  vi.spyOn(router, 'requestForSessionProfile').mockRejectedValue(new Error('Disconnected'))
  await expect(sendSubagentControl(owner, 'parent', 'child', 'interrupt')).rejects.toMatchObject({
    code: 'request-failed'
  })
  expect($subagentsBySession.get().parent?.[0]?.status).toBe('running')
})
