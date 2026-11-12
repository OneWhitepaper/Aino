import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import {
  $notifications,
  clearNotifications,
  notify,
  pauseNotification,
  resumeNotification,
  runNotificationAction,
  updateNotification
} from './notifications'

beforeEach(() => {
  vi.useFakeTimers()
  clearNotifications()
})
afterEach(() => {
  clearNotifications()
  vi.useRealTimers()
})

test('hover and keyboard reading pause expiry until all reading owners leave', () => {
  const id = notify({ message: 'Saved', durationMs: 5000 })
  vi.advanceTimersByTime(1000)
  pauseNotification(id, 'hover')
  pauseNotification(id, 'focus')
  vi.advanceTimersByTime(20_000)
  resumeNotification(id, 'hover')
  vi.advanceTimersByTime(20_000)
  expect($notifications.get()).toHaveLength(1)
  resumeNotification(id, 'focus')
  vi.advanceTimersByTime(3999)
  expect($notifications.get()).toHaveLength(1)
  vi.advanceTimersByTime(1)
  expect($notifications.get()).toHaveLength(0)
})

test('an asynchronous recovery stays available after failure and only runs once at a time', async () => {
  let reject!: (error: Error) => void

  const recovery = vi.fn(
    () =>
      new Promise<void>((_, no) => {
        reject = no
      })
  )

  const id = notify({ message: 'Reconnect', action: { label: 'Retry', onClick: recovery } })
  const first = runNotificationAction(id, 'action')
  const second = runNotificationAction(id, 'action')
  expect(recovery).toHaveBeenCalledTimes(1)
  expect($notifications.get()[0].pendingAction).toBe('action')
  reject(new Error('Connection still unavailable'))
  await Promise.all([first, second])
  expect($notifications.get()[0].actionError).toBe('Connection still unavailable')
  expect($notifications.get()[0].pendingAction).toBeUndefined()
  recovery.mockResolvedValueOnce(undefined)
  await runNotificationAction(id, 'action')
  expect($notifications.get()).toHaveLength(0)
})

test('a late action cannot dismiss a replacement notification with the same identity', async () => {
  let finish!: () => void

  const id = notify({
    id: 'connection',
    message: 'Offline',
    action: {
      label: 'Retry',
      onClick: () =>
        new Promise<void>(ok => {
          finish = ok
        })
    }
  })

  const pending = runNotificationAction(id, 'action')
  notify({ id, message: 'Sign in required', durationMs: 0 })
  finish()
  await pending
  expect($notifications.get()[0].message).toBe('Sign in required')
})

test('identical passive feedback merges while different actionable owners stay separate', () => {
  notify({ message: 'Saved' })
  notify({ message: 'Saved' })
  expect($notifications.get()).toHaveLength(1)
  expect($notifications.get()[0].repeatCount).toBe(2)
  notify({ message: 'Sign in', action: { label: 'Open', onClick: () => undefined } })
  notify({ message: 'Sign in', action: { label: 'Open', onClick: () => undefined } })
  expect($notifications.get()).toHaveLength(3)
})

test('a sticky detail reader also pauses a later expiring update', () => {
  const id = notify({ id: 'status', message: 'Working', durationMs: 0 })
  pauseNotification(id, 'panel')
  notify({ id, message: 'Completed', durationMs: 5000 })
  vi.advanceTimersByTime(30_000)
  expect($notifications.get()).toHaveLength(1)
  resumeNotification(id, 'panel')
  vi.advanceTimersByTime(5000)
  expect($notifications.get()).toHaveLength(0)
})

test('same-identity updates retain the single recovery in progress and its failure', async () => {
  let reject!: (error: Error) => void

  const recover = vi.fn(
    () =>
      new Promise<void>((_, no) => {
        reject = no
      })
  )

  const input = { id: 'same-owner', message: 'Offline', action: { label: 'Reconnect', onClick: recover } }
  notify(input)
  const first = runNotificationAction(input.id, 'action')
  notify({ ...input, message: 'Still connecting' })
  expect($notifications.get()[0].pendingAction).toBe('action')
  await runNotificationAction(input.id, 'action')
  expect(recover).toHaveBeenCalledTimes(1)
  reject(new Error('Connection failed'))
  await first
  expect($notifications.get()[0].actionError).toBe('Connection failed')
  expect($notifications.get()[0].pendingAction).toBeUndefined()
})

test('continuous status updates retain identity, arrival time, repeat count and a reader expiry pause', () => {
  const id = notify({ id: 'sync', message: '3 items waiting', source: 'Cloud history', durationMs: 5000 })
  const original = $notifications.get()[0]

  expect(updateNotification(id, { source: original.source })).toBe(true)
  expect($notifications.get()[0]).toBe(original)
  pauseNotification(id, 'panel')
  vi.advanceTimersByTime(1000)
  expect(updateNotification(id, { message: '2 items waiting', facts: [{ label: 'Pending', value: '2' }] })).toBe(true)
  const updated = $notifications.get()[0]
  expect(updated).toMatchObject({
    instance: original.instance,
    createdAt: original.createdAt,
    repeatCount: original.repeatCount
  })
  expect(updated.message).toBe('2 items waiting')
  vi.advanceTimersByTime(8000)
  expect($notifications.get()).toHaveLength(1)
  resumeNotification(id, 'panel')
  vi.advanceTimersByTime(5000)
  expect($notifications.get()).toHaveLength(0)
  expect(updateNotification(id, { message: 'Late status' })).toBe(false)
  expect($notifications.get()).toHaveLength(0)
})

test('an event-owned recovery stays present until the actual state owner clears it', async () => {
  const id = notify({
    message: 'Sync offline',
    action: { label: 'Retry', onClick: async () => undefined, retainOnSuccess: true }
  })

  await runNotificationAction(id, 'action')
  expect($notifications.get()).toHaveLength(1)
  expect($notifications.get()[0].pendingAction).toBeUndefined()
})

test('passive feedback from different named sources never coalesces', () => {
  notify({ message: 'Saved', source: 'Workspace one' })
  notify({ message: 'Saved', source: 'Workspace two' })
  expect($notifications.get()).toHaveLength(2)
})
