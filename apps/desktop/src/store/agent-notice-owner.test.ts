import { beforeEach, expect, test, vi } from 'vitest'

import { $notifications, resetNotifications, runNotificationAction } from './notifications'

const request = vi.hoisted(() => vi.fn())
const active = vi.hoisted(() => vi.fn(() => ({ connectionId: 'local', profile: 'default' })))
vi.mock('@/store/gateway', () => ({ requestGatewayForAgent: request, activeGatewayRoute: active }))

import { clearAgentNotice, noticeToToast, showAgentNotice } from './agent-notices'
import { $routeRequest } from './recovery-requests'

beforeEach(() => {
  resetNotifications()
  request.mockReset()
  active.mockReturnValue({ connectionId: 'local', profile: 'default' })
})

const payload = {
  key: 'sessions.auto_prune',
  text: 'Low disk',
  level: 'warn',
  kind: 'sticky',
  detail: 'Complete original detail'
}

test('identical backend codes on different owners remain independent and clear only their own notice', () => {
  const a = { connectionId: 'local', profile: 'default' }
  const b = { connectionId: 'other', profile: 'default' }
  showAgentNotice(payload, a)
  showAgentNotice(payload, b)
  expect($notifications.get()).toHaveLength(2)
  clearAgentNotice(payload.key, a)
  expect($notifications.get()).toHaveLength(1)
  expect($notifications.get()[0].id).toBe(noticeToToast(payload, b)?.id)
})

test('disk snooze calls the original source and becomes deferred history only after a positive acknowledgement', async () => {
  const owner = { connectionId: 'local', profile: 'bot', sessionId: 'owned-session' }
  showAgentNotice(payload, owner)
  const id = $notifications.get()[0].id
  request.mockResolvedValueOnce({ output: 'Auto-prune is off, set by your administrator; it cannot be changed here.' })
  await runNotificationAction(id, 'secondaryAction')
  expect(request).toHaveBeenCalledWith('local', 'bot', 'slash.exec', {
    session_id: 'owned-session',
    command: 'autoprune later'
  })
  expect($notifications.get()[0].actionError).toContain('administrator')
  request.mockResolvedValueOnce({ output: "OK, I'll ask again in a week if the disk is still low." })
  await runNotificationAction(id, 'secondaryAction')
  expect($notifications.get()).toHaveLength(1)
  expect($notifications.get()[0].deferredUntil).toBeGreaterThan(Date.now())
  expect($notifications.get()[0].actionError).toBeUndefined()
})

test('the slash clear mirror cannot remove an in-flight snooze or its acknowledged history', async () => {
  const owner = { connectionId: 'local', profile: 'bot', sessionId: 'owned-session' }
  let finish!: (value: { output: string }) => void
  request.mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve
    })
  )
  showAgentNotice(payload, owner)
  const id = $notifications.get()[0].id
  const pending = runNotificationAction(id, 'secondaryAction')
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
  clearAgentNotice(payload.key, owner)
  expect($notifications.get()).toHaveLength(1)
  finish({ output: "OK, I'll ask again in a week if the disk is still low." })
  await pending
  clearAgentNotice(payload.key, owner)
  expect($notifications.get()[0].deferredUntil).toBeGreaterThan(Date.now())
})

test('a snooze finishing after account reset cannot defer a new owner notice with the same ID', async () => {
  const owner = { connectionId: 'local', profile: 'bot', sessionId: 'owned-session' }
  let finish!: (value: { output: string }) => void
  request.mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve
    })
  )
  showAgentNotice(payload, owner)
  const pending = runNotificationAction($notifications.get()[0].id, 'secondaryAction')
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
  resetNotifications()
  showAgentNotice(payload, owner)
  finish({ output: "OK, I'll ask again in a week if the disk is still low." })
  await pending
  expect($notifications.get()[0].deferredUntil).toBeUndefined()
})

test('maintenance never opens the current workspace on behalf of another source', async () => {
  const before = $routeRequest.get()
  showAgentNotice(payload, { connectionId: 'other', profile: 'default' })
  await runNotificationAction($notifications.get()[0].id, 'action')
  expect($routeRequest.get()).toBe(before)
  expect($notifications.get()[0].actionError).toBeTruthy()
})

test('opening Maintenance does not report that the disk warning was resolved', async () => {
  showAgentNotice(payload, { connectionId: 'local', profile: 'default' })
  await runNotificationAction($notifications.get()[0].id, 'action')
  expect($routeRequest.get()?.path).toBe('/command-center?section=maintenance')
  expect($notifications.get()).toHaveLength(1)
})
