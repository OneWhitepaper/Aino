import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  $currentExecutionMode,
  $executionModeRequest,
  getDraftExecutionMode,
  rememberSessionExecutionMode,
  requestExecutionMode,
  setDraftExecutionMode
} from './execution-mode'
import { $activeGatewayProfile, $freshSessionRequest, $newChatProfile, $newChatRoute } from './profile'
import { $connection, $selectedStoredSessionId, $sessions } from './session'

describe('Work and Code selection', () => {
  let stop: () => void

  beforeEach(() => {
    $connection.set({ connectionId: 'mode-tests' } as never)
    $activeGatewayProfile.set('default')
    $newChatProfile.set(null)
    $newChatRoute.set(null)
    $selectedStoredSessionId.set(null)
    $sessions.set([])
    setDraftExecutionMode('work')
    stop = $currentExecutionMode.listen(() => undefined)
  })

  afterEach(() => stop())

  it('requests Code without retagging the Work surface before its workspace is activated', () => {
    $selectedStoredSessionId.set('work-chat')
    rememberSessionExecutionMode('work-chat', 'work')
    const before = $freshSessionRequest.get()

    requestExecutionMode('code')

    expect($freshSessionRequest.get()).toBe(before)
    expect($executionModeRequest.get()).toMatchObject({ mode: 'code' })
    expect($selectedStoredSessionId.get()).toBe('work-chat')
    expect($currentExecutionMode.get()).toBe('work')
    expect(getDraftExecutionMode()).toBe('work')
    $selectedStoredSessionId.set(null)
    expect($currentExecutionMode.get()).toBe('work')
  })

  it('reads a historical conversation mode and treats older rows as Work', () => {
    $sessions.set([{ id: 'code-history', execution_mode: 'code' }, { id: 'old-history' }] as never)
    $selectedStoredSessionId.set('code-history')
    expect($currentExecutionMode.get()).toBe('code')
    $selectedStoredSessionId.set('old-history')
    expect($currentExecutionMode.get()).toBe('work')
  })

  it('keeps fresh-draft choices within their connection and profile', () => {
    setDraftExecutionMode('code')
    $activeGatewayProfile.set('other')
    expect(getDraftExecutionMode()).toBe('work')
    $activeGatewayProfile.set('default')
    expect(getDraftExecutionMode()).toBe('code')
    $connection.set({ connectionId: 'other-service' } as never)
    expect(getDraftExecutionMode()).toBe('work')
  })

  it('does not create a new draft when selecting the current mode again', () => {
    const before = $freshSessionRequest.get()
    requestExecutionMode('work')
    expect($freshSessionRequest.get()).toBe(before)
  })
})
