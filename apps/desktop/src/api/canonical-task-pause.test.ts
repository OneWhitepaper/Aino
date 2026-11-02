import { beforeEach, expect, test } from 'vitest'

import { $taskPauses, claimTaskContinuation, clearTaskPause, taskPauseKey } from '@/store/task-pause'

import { CanonicalDesktopProtocol } from './canonical-protocol'

beforeEach(() => $taskPauses.set({}))

test('a turn that completed before Stop was sent never leaves a pausing offer', () => {
  const protocol = new CanonicalDesktopProtocol()
  const params = { session_id: 'done', profile: 'work' }
  protocol.event({
    type: 'message.complete',
    ...params,
    execution_generation: 3,
    payload: { status: 'complete', admission_id: 'done' }
  })
  const interrupt = protocol.prepare('session.interrupt', params)
  protocol.result('session.interrupt', interrupt, { execution_generation: 3, execution_state: 'idle' })
  expect($taskPauses.get()[protocol.taskPauseKey('done', 'work')]).toBeUndefined()
})

function paused(profile = 'work') {
  const protocol = new CanonicalDesktopProtocol()
  const params = { session_id: 'same', profile }
  protocol.event({ type: 'message.start', ...params, execution_generation: 3, payload: {} })
  const interrupt = protocol.prepare('session.interrupt', params)

  return { protocol, params, interrupt, key: taskPauseKey(protocol, 'same', profile) }
}

test('Continue waits for interrupt acknowledgement and both durable settlement events in either order', () => {
  const { protocol, params, interrupt, key } = paused()
  protocol.event({
    type: 'session.info',
    ...params,
    payload: { execution_generation: 3, revision: 9, running: false, pending: [] }
  })
  protocol.event({
    type: 'message.complete',
    ...params,
    execution_generation: 3,
    payload: { admission_id: 'original', status: 'interrupted' }
  })
  expect($taskPauses.get()[key].phase).toBe('stopping')
  expect(claimTaskContinuation(key)).toBeNull()
  protocol.result('session.interrupt', interrupt, {
    ref: { session_id: 'same' },
    execution_generation: 3,
    execution_state: 'idle',
    revision: 9
  })
  expect($taskPauses.get()[key].phase).toBe('paused')
  expect(claimTaskContinuation(key)).toEqual({ admission_id: 'original', execution_generation: 3, revision: 9 })
  expect(claimTaskContinuation(key)).toBeNull()
})

test.each(['submit', 'revision', 'generation', 'pending', 'normal_complete'])(
  'new %s invalidates Continue',
  changed => {
    const { protocol, params, interrupt, key } = paused()
    protocol.result('session.interrupt', interrupt, { ref: { session_id: 'same' }, execution_generation: 3 })
    protocol.event({
      type: 'message.complete',
      ...params,
      execution_generation: 3,
      payload: { admission_id: 'original', status: 'interrupted' }
    })
    protocol.event({
      type: 'session.info',
      ...params,
      payload: { execution_generation: 3, revision: 9, running: false, pending: [] }
    })
    expect($taskPauses.get()[key].phase).toBe('paused')

    if (changed === 'submit') {
      protocol.prepare('prompt.submit', { ...params, text: 'new task', submission_id: 'new' })
    } else if (changed === 'normal_complete') {
      protocol.event({
        type: 'message.complete',
        ...params,
        execution_generation: 3,
        payload: { admission_id: 'original', status: 'complete' }
      })
    } else {
      protocol.event({
        type: changed === 'revision' ? 'session.updated' : 'session.info',
        ...params,
        payload: {
          execution_generation: changed === 'generation' ? 4 : 3,
          revision: changed === 'revision' ? 10 : 9,
          running: false,
          pending: changed === 'pending' ? [{ admission_id: 'next', status: 'queued' }] : []
        }
      })
    }

    expect($taskPauses.get()[key]).toBeUndefined()
  }
)

test('equal session IDs on another socket or profile cannot settle this stop', () => {
  const { protocol, params, key } = paused()
  new CanonicalDesktopProtocol().event({
    type: 'message.complete',
    ...params,
    execution_generation: 3,
    payload: { admission_id: 'foreign', status: 'interrupted' }
  })
  protocol.event({
    type: 'message.complete',
    ...params,
    profile: 'other',
    execution_generation: 3,
    payload: { admission_id: 'foreign', status: 'interrupted' }
  })
  expect($taskPauses.get()[key].phase).toBe('stopping')
  expect($taskPauses.get()[key].admissionId).toBeUndefined()
})

test('a stale idle heartbeat cannot enable Continue before the settlement revision advances', () => {
  const protocol = new CanonicalDesktopProtocol()
  const params = { session_id: 's', profile: 'work' }
  protocol.result('session.resume', params, { session_id: 's', revision: 8, execution_generation: 3, running: true })
  const interrupt = protocol.prepare('session.interrupt', params)
  const key = protocol.taskPauseKey('s', 'work')
  protocol.result('session.interrupt', interrupt, { execution_generation: 3 })
  protocol.event({
    type: 'message.complete',
    ...params,
    execution_generation: 3,
    payload: { admission_id: 'original', status: 'interrupted' }
  })
  protocol.event({
    type: 'session.info',
    ...params,
    payload: { execution_generation: 3, revision: 8, running: false, pending: [] }
  })
  expect($taskPauses.get()[key].phase).toBe('stopping')
  protocol.event({
    type: 'session.info',
    ...params,
    payload: { execution_generation: 3, revision: 9, running: false, pending: [] }
  })
  expect($taskPauses.get()[key].phase).toBe('paused')
  protocol.event({ type: 'session.info', ...params, payload: { execution_generation: 3, model: 'same' } })
  expect($taskPauses.get()[key].phase).toBe('paused')
})

test.each(['ordinary', 'continuation'])('a delayed %s admission receipt preserves the next paused turn', kind => {
  const { protocol, params, interrupt, key } = paused()
  protocol.result('session.interrupt', interrupt, { execution_generation: 3 })
  protocol.event({
    type: 'message.complete',
    ...params,
    execution_generation: 3,
    payload: { admission_id: 'original', status: 'interrupted' }
  })
  protocol.event({
    type: 'session.info',
    ...params,
    payload: { execution_generation: 3, revision: 9, running: false, pending: [] }
  })
  const continuation = claimTaskContinuation(key)!

  const submitted = protocol.prepare('prompt.submit', {
    ...params,
    submission_id: 'old-submit',
    text: 'Continue',
    ...(kind === 'continuation' ? { continuation_of: continuation } : {})
  })

  protocol.event({ type: 'message.start', ...params, execution_generation: 4, payload: {} })
  const nextInterrupt = protocol.prepare('session.interrupt', params)
  protocol.result('session.interrupt', nextInterrupt, { execution_generation: 4 })
  protocol.event({
    type: 'message.complete',
    ...params,
    execution_generation: 4,
    payload: { admission_id: 'next', status: 'interrupted' }
  })
  protocol.event({
    type: 'session.info',
    ...params,
    payload: { execution_generation: 4, revision: 10, running: false, pending: [] }
  })
  const nextPause = $taskPauses.get()[key]
  expect(nextPause).toMatchObject({ phase: 'paused', admissionId: 'next', generation: 4 })
  protocol.result('prompt.submit', submitted, {
    ref: { session_id: 'same' },
    admission_id: 'old-admission',
    status: 'terminal'
  })
  expect($taskPauses.get()[key]).toBe(nextPause)
})

test.each(['session.resume', 'session.activate'])('an older %s snapshot cannot clear a settled pause', method => {
  const { protocol, params, interrupt, key } = paused()
  protocol.result('session.interrupt', interrupt, { execution_generation: 3 })
  protocol.event({
    type: 'message.complete',
    ...params,
    execution_generation: 3,
    payload: { admission_id: 'original', status: 'interrupted' }
  })
  protocol.event({
    type: 'session.info',
    ...params,
    payload: { execution_generation: 3, revision: 9, running: false, pending: [] }
  })
  const current = $taskPauses.get()[key]
  protocol.result(method, params, {
    session_id: 'same',
    execution_generation: 3,
    revision: 8,
    running: true,
    pending: [{ admission_id: 'original', status: 'started', execution_generation: 3 }]
  })
  expect($taskPauses.get()[key]).toBe(current)
})

test('a stale continuation refusal clears only its original pause', () => {
  const { protocol, params, interrupt, key } = paused()
  protocol.result('session.interrupt', interrupt, { execution_generation: 3 })
  protocol.event({
    type: 'message.complete',
    ...params,
    execution_generation: 3,
    payload: { admission_id: 'original', status: 'interrupted' }
  })
  protocol.event({
    type: 'session.info',
    ...params,
    payload: { execution_generation: 3, revision: 9, running: false, pending: [] }
  })
  const old = claimTaskContinuation(key)!
  protocol.event({ type: 'message.start', ...params, execution_generation: 4, payload: {} })
  const nextInterrupt = protocol.prepare('session.interrupt', params)
  protocol.result('session.interrupt', nextInterrupt, { execution_generation: 4 })
  protocol.event({
    type: 'message.complete',
    ...params,
    execution_generation: 4,
    payload: { admission_id: 'next', status: 'interrupted' }
  })
  protocol.event({
    type: 'session.info',
    ...params,
    payload: { execution_generation: 4, revision: 10, running: false, pending: [] }
  })
  const current = $taskPauses.get()[key]
  clearTaskPause(key, old)
  expect($taskPauses.get()[key]).toBe(current)
})
