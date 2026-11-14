import { afterEach, expect, it, vi } from 'vitest'

import { beginPreviewApproval } from './preview-approval'
import type { PreviewDriveGuest } from './preview-drive-channels'

const original = window.hermesDesktop
afterEach(() => {
  window.hermesDesktop = original
})

function fixture() {
  const native = {
    beginPreviewGuestActivity: vi.fn(async () => 42),
    endPreviewGuestActivity: vi.fn(async () => {}),
    executePreviewGuestScript: vi.fn(async () => {}),
    armPreviewApproval: vi.fn(async () => {}),
    validatePreviewApproval: vi.fn(async () => {}),
    sendPreviewApprovedInput: vi.fn(async () => {})
  }

  window.hermesDesktop = { ...original, ...native }
  const guest = Object.assign(document.createElement('div'), {
    getWebContentsId: () => 7,
    getZoomFactor: () => 1.25
  }) as PreviewDriveGuest

  return { guest, native }
}

it('uses one native request token for observation, validation, scaled input and release', async () => {
  const { guest, native } = fixture()
  const approval = await beginPreviewApproval(guest)
  await approval.validate()
  approval.input.send({ type: 'mouseDown', button: 'left', clickCount: 1, x: 40, y: 20 })
  await approval.input.settle?.()
  await approval.release()
  expect(native.armPreviewApproval).toHaveBeenCalledWith(42)
  expect(native.validatePreviewApproval).toHaveBeenCalledWith(42)
  expect(native.sendPreviewApprovedInput).toHaveBeenCalledWith(42, expect.objectContaining({ x: 50, y: 25 }))
  expect(native.endPreviewGuestActivity).toHaveBeenCalledExactlyOnceWith(42)
})

it('releases the request and refuses input when native observation cannot be established', async () => {
  const { guest, native } = fixture()
  native.armPreviewApproval.mockRejectedValue(new Error('Embedded frame unavailable'))
  await expect(beginPreviewApproval(guest)).rejects.toThrow('Embedded frame unavailable')
  expect(native.endPreviewGuestActivity).toHaveBeenCalledExactlyOnceWith(42)
  expect(native.sendPreviewApprovedInput).not.toHaveBeenCalled()
})

it('keeps a native input-boundary refusal observable instead of reporting a successful click', async () => {
  const { guest, native } = fixture()
  const approval = await beginPreviewApproval(guest)
  native.sendPreviewApprovedInput.mockRejectedValue(new Error('Target changed'))
  approval.input.send({ type: 'keyDown', keyCode: 'Enter' })
  approval.input.send({ type: 'keyUp', keyCode: 'Enter' })
  await expect(approval.input.settle?.()).rejects.toThrow('Target changed')
  expect(native.sendPreviewApprovedInput).toHaveBeenCalledTimes(1)
  await approval.release()
})

it('withdraws the exact request token on user takeover or cancellation', async () => {
  const { guest, native } = fixture()
  const cancelled = new AbortController()
  const approval = await beginPreviewApproval(guest, cancelled.signal)
  cancelled.abort()
  await expect(approval.validate()).rejects.toThrow()
  expect(() => approval.input.send({ type: 'keyDown', keyCode: 'Enter' })).toThrow()
  await approval.release()
  expect(native.endPreviewGuestActivity).toHaveBeenCalledExactlyOnceWith(42)
  expect(native.sendPreviewApprovedInput).not.toHaveBeenCalled()
})
