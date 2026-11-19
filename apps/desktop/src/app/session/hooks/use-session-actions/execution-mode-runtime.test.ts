import { beforeEach, expect, it } from 'vitest'

import { $currentExecutionMode, getDraftExecutionMode, setDraftExecutionMode } from '@/store/execution-mode'
import { $selectedStoredSessionId, $sessions } from '@/store/session'

import { buildOptimisticSession } from './optimistic-session'
import { applyRuntimeInfo, applyStoredSessionPreviewRuntimeInfo } from './runtime-info'

beforeEach(() => {
  $sessions.set([])
  $selectedStoredSessionId.set(null)
  setDraftExecutionMode('work')
})

it('restores Code from runtime and Work from a historical row with no mode', () => {
  $selectedStoredSessionId.set('code-session')
  applyRuntimeInfo({ stored_session_id: 'code-session', execution_mode: 'code' })
  expect($currentExecutionMode.get()).toBe('code')
  expect(getDraftExecutionMode()).toBe('code')

  $selectedStoredSessionId.set('old-work-session')
  applyStoredSessionPreviewRuntimeInfo({ model: 'old-model' }, 'old-work-session')
  expect($currentExecutionMode.get()).toBe('work')
  expect(getDraftExecutionMode()).toBe('work')
})

it('does not switch the foreground when a background Code session reports its runtime', () => {
  const patch = applyRuntimeInfo({ execution_mode: 'code' }, { foreground: false })
  expect(patch?.executionMode).toBe('code')
  expect($currentExecutionMode.get()).toBe('work')
  expect(getDraftExecutionMode()).toBe('work')
})

it('keeps the Code badge and history preview correct before the first list refresh', () => {
  const row = buildOptimisticSession(
    {
      session_id: 'new-code',
      info: { execution_mode: 'code' }
    },
    'new-code'
  )

  expect(row.execution_mode).toBe('code')
  $sessions.set([row])
  $selectedStoredSessionId.set(row.id)
  applyStoredSessionPreviewRuntimeInfo(row, row.id)
  expect($currentExecutionMode.get()).toBe('code')

  expect(buildOptimisticSession({ session_id: 'legacy' }, 'legacy').execution_mode).toBe('work')
})
