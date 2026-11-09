import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setModelAssignment } from '@/hermes'
import { setRuntimeI18nLocale } from '@/i18n'
import { $confirmRequest, runConfirm, settleConfirm } from '@/store/confirm'
import { setMainModelAssignment } from '@/store/model-assignment'

vi.mock('@/hermes', () => ({ setModelAssignment: vi.fn() }))

const assign = vi.mocked(setModelAssignment)

beforeEach(() => {
  assign.mockReset()
  setRuntimeI18nLocale('en')
})
afterEach(() => settleConfirm(false))

describe('default model assignment confirmation', () => {
  it('uses the shared confirmation and only acknowledges the same scoped assignment after acceptance', async () => {
    assign
      .mockResolvedValueOnce({
        ok: false,
        confirm_required: true,
        confirm_message: 'This model may use your data for training.'
      })
      .mockResolvedValueOnce({ ok: true })
    const request = { model: 'guarded-model', provider: 'custom' }
    const scope = { connectionId: 'remote-one', profile: 'research' }
    const pending = setMainModelAssignment(request, scope)

    await vi.waitFor(() => expect($confirmRequest.get()).not.toBeNull())
    const prompt = $confirmRequest.get()!
    expect(prompt.description).toBe('This model may use your data for training.')
    expect(prompt.confirmLabel).toBeTruthy()
    expect(assign).toHaveBeenCalledExactlyOnceWith({ ...request, scope: 'main' }, scope)
    await runConfirm(prompt)

    await expect(pending).resolves.toEqual({ ok: true })
    expect(assign).toHaveBeenLastCalledWith({ ...request, scope: 'main', confirm_expensive_model: true }, scope)
    expect(assign).toHaveBeenCalledTimes(2)
  })

  it('declining the shared confirmation preserves the existing default without resubmitting', async () => {
    assign.mockResolvedValueOnce({ ok: false, confirm_required: true, confirm_message: 'Confirm this model.' })
    const pending = setMainModelAssignment({ model: 'guarded-model', provider: 'custom' })
    const declined = expect(pending).rejects.toThrow()

    await vi.waitFor(() => expect($confirmRequest.get()).not.toBeNull())
    settleConfirm(false)
    await declined
    expect(assign).toHaveBeenCalledTimes(1)
  })

  it('leaves successful unscoped assignments on the existing one-request path', async () => {
    assign.mockResolvedValueOnce({ ok: true })
    await expect(setMainModelAssignment({ model: 'ordinary-model', provider: 'custom' })).resolves.toEqual({ ok: true })
    expect(assign).toHaveBeenCalledExactlyOnceWith({ model: 'ordinary-model', provider: 'custom', scope: 'main' })
    expect($confirmRequest.get()).toBeNull()
  })

  it.each(['already acknowledged', 'headless onboarding'])('fails closed when a guard repeats for %s', async mode => {
    assign.mockResolvedValueOnce({ ok: false, confirm_required: true, confirm_message: 'Confirmation still required.' })
    await expect(
      setMainModelAssignment(
        {
          model: 'guarded-model',
          provider: 'custom',
          ...(mode === 'already acknowledged' ? { confirm_expensive_model: true } : {})
        },
        undefined,
        mode === 'headless onboarding' ? { skipConfirmPrompt: true } : undefined
      )
    ).rejects.toThrow('Confirmation still required.')
    expect(assign).toHaveBeenCalledTimes(1)
    expect($confirmRequest.get()).toBeNull()
  })

  it('never opens another confirmation if the acknowledged retry is refused', async () => {
    assign.mockResolvedValue({ ok: false, confirm_required: true, confirm_message: 'Confirmation still required.' })
    const pending = setMainModelAssignment({ model: 'guarded-model', provider: 'custom' })
    const failed = expect(pending).rejects.toThrow('Confirmation still required.')

    await vi.waitFor(() => expect($confirmRequest.get()).not.toBeNull())
    await runConfirm($confirmRequest.get()!)
    await failed
    expect(assign).toHaveBeenCalledTimes(2)
    expect($confirmRequest.get()).toBeNull()
  })
})
