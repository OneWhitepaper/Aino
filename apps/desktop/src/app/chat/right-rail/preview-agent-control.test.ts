import { afterEach, describe, expect, it } from 'vitest'

import { $confirmRequest, confirm, settleConfirm } from '@/store/confirm'

import {
  $previewAgentActivity,
  beginPreviewOperation,
  confirmPreviewOperation,
  previewControlEpoch,
  resumePreview,
  takeOverPreview
} from './preview-agent-control'

afterEach(() => settleConfirm(false))

describe('browser operation ownership', () => {
  it('serializes each tab while allowing operations in other tabs', () => {
    const first = beginPreviewOperation('exclusive', 'observing')
    const other = beginPreviewOperation('independent', 'acting')
    expect(() => beginPreviewOperation('exclusive', 'acting')).toThrow(/busy/i)
    first.setPhase('confirmation')
    expect($previewAgentActivity.get().exclusive).toBe('confirmation')
    first.release()
    other.release()
    expect($previewAgentActivity.get().exclusive ?? 'idle').toBe('idle')
  })

  it('retains user control after the interrupted operation releases', () => {
    const operation = beginPreviewOperation('takeover', 'acting')
    const epoch = previewControlEpoch('takeover')
    takeOverPreview('takeover')
    expect(operation.signal.aborted).toBe(true)
    expect(operation.signal.reason).toBe('user_takeover')
    expect(previewControlEpoch('takeover')).toBeGreaterThan(epoch)
    operation.setPhase('observing')
    operation.release()
    expect($previewAgentActivity.get().takeover).toBe('human')
    expect(() => beginPreviewOperation('takeover', 'acting')).toThrow(/user/i)
    resumePreview('takeover')
  })

  it('invalidates previous permissions when returning control and isolates an old release', () => {
    const first = beginPreviewOperation('resume', 'acting')
    takeOverPreview('resume')
    const epoch = previewControlEpoch('resume')
    resumePreview('resume')
    expect(previewControlEpoch('resume')).toBeGreaterThan(epoch)
    const next = beginPreviewOperation('resume', 'observing')
    first.release()
    expect(next.signal.aborted).toBe(false)
    expect($previewAgentActivity.get().resume).toBe('observing')
    next.release()
  })
})

describe('browser operation confirmation', () => {
  it('cancels its pending prompt on takeover', async () => {
    const operation = beginPreviewOperation('confirm', 'acting')
    const answer = confirmPreviewOperation('confirm', { title: 'Submit order?' }, operation.signal)
    expect($confirmRequest.get()?.title).toBe('Submit order?')
    takeOverPreview('confirm')
    expect(await answer).toBe(false)
    expect($confirmRequest.get()).toBeNull()
    operation.release()
    resumePreview('confirm')
  })

  it('leaves a newer unrelated prompt open when an older operation aborts', async () => {
    const controller = new AbortController()
    const answer = confirmPreviewOperation('old-confirm', { title: 'Submit form?' }, controller.signal)
    const newer = confirm({ title: 'Delete local file?' })
    const pending = $confirmRequest.get()
    controller.abort()
    expect(await answer).toBe(false)
    expect($confirmRequest.get()).toBe(pending)
    settleConfirm(false)
    expect(await newer).toBe(false)
  })

  it('does not open a confirmation after its operation was already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await confirmPreviewOperation('cancelled', { title: 'Too late' }, controller.signal)).toBe(false)
    expect($confirmRequest.get()).toBeNull()
  })
})
